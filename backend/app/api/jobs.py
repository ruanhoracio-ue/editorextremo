from __future__ import annotations

import glob
import os
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.models.schemas import (
    Job,
    JobStatus,
    StyleOptions,
    CutSegment,
    TranscriptSegment,
    ColorGradeOptions,
)
from app.queue.worker import get_job, update_job, enqueue
from app.pipeline.render_final import render_final_video
from app.storage.manager import get_path, get_url, save_upload
from app.pipeline.color_grade import apply_color_grade
from app.pipeline.broll import fetch_auto_broll_image, generate_broll_timeline_suggestions

router = APIRouter()


class StyleUpdateRequest(BaseModel):
    style_options: StyleOptions


class CutsUpdateRequest(BaseModel):
    cuts: List[CutSegment]
    # False = só salva os cortes (edição ao vivo no front); True = re-renderiza o vídeo limpo
    reprocess: bool = True


class TranscriptUpdateRequest(BaseModel):
    transcript: List[TranscriptSegment]


@router.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    clean_url = None
    if job.clean_video and os.path.exists(job.clean_video):
        clean_url = f"/storage/{job_id}/clean_video.mp4"

    final_url = None
    if job.final_video and os.path.exists(job.final_video):
        fname = os.path.basename(job.final_video)
        final_url = f"/storage/{job_id}/{fname}"

    split_url = None
    if job.style_options and job.style_options.split_screen_image:
        img_p = job.style_options.split_screen_image
        if os.path.exists(img_p):
            fname = os.path.basename(img_p)
            split_url = f"/storage/{job_id}/{fname}"

    split_urls = []
    if job.style_options and job.style_options.split_screen_images:
        for img_p in job.style_options.split_screen_images:
            if os.path.exists(img_p):
                fname = os.path.basename(img_p)
                split_urls.append(f"/storage/{job_id}/{fname}")

    original_url = None
    if job.original_file and os.path.exists(job.original_file):
        fname = os.path.basename(job.original_file)
        original_url = f"/storage/{job_id}/{fname}"

    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "original_filename": job.original_filename,
        "original_duration": job.original_duration,
        "clean_duration": job.clean_duration,
        "original_video_url": original_url,
        "clean_video_url": clean_url,
        "final_video_url": final_url,
        "split_image_url": split_url,
        "split_images_urls": split_urls,
        "transcript": job.transcript,
        "style_options": job.style_options,
        "cuts": job.cuts,
        "silences": job.silences,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "batch_videos": job.batch_videos,
        "batch_zip_url": job.batch_zip_url,
    }


@router.put("/api/jobs/{job_id}/style")
async def update_job_style(job_id: str, body: StyleUpdateRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    updated = update_job(job_id, style_options=body.style_options)
    return {"message": "Estilo atualizado com sucesso!", "style_options": updated.style_options}


@router.post("/api/jobs/{job_id}/retry")
async def retry_job(job_id: str):
    """Retoma um job que travou no meio do processamento.

    Se o app for fechado (ou o Docker parado) durante a transcrição/corte, a thread
    de processamento morre e o job fica preso no status em que estava, sem saída.
    Aqui recomeçamos do arquivo enviado originalmente — que é sempre `original.*`,
    e não o `original_file` do job, que a essa altura pode apontar para um
    intermediário corrompido pela interrupção.
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    candidates = sorted(glob.glob(str(get_path(job_id, "original.*"))))
    source = candidates[0] if candidates else None
    if not source or not os.path.exists(source):
        raise HTTPException(400, "O vídeo enviado não está mais disponível. Envie o arquivo de novo.")

    # Descarta intermediários possivelmente truncados pela interrupção
    for leftover in ("normalized.mp4", "cut_video.mp4", "clean_video.mp4", "audio.wav"):
        path = str(get_path(job_id, leftover))
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    from app.api.upload import run_cleanup_pipeline

    update_job(job_id, original_file=source, status=JobStatus.QUEUED, progress=0, error_message=None)
    enqueue(get_job(job_id), run_cleanup_pipeline)
    return {"message": "Processamento reiniciado!", "status": JobStatus.QUEUED}


@router.put("/api/jobs/{job_id}/cuts")
async def update_job_cuts(job_id: str, body: CutsUpdateRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    update_job(job_id, cuts=body.cuts)

    if not body.reprocess:
        # Edição ao vivo: o preview do front já pula os trechos removidos; o vídeo
        # limpo só é re-renderizado quando o usuário aprova os cortes.
        return {"message": "Cortes salvos", "status": job.status}

    # Marca como ocupado JÁ (antes do FFmpeg começar), senão o front vê "clean_ready"
    # velho durante o corte e acha que terminou — era isso que dessincronizava a legenda.
    update_job(job_id, status=JobStatus.CUTTING, progress=30)
    enqueue(job, _reprocess_cuts)

    return {"message": "Cortes atualizados! Reprocessando...", "status": "cutting"}


def _reprocess_cuts(job: Job):
    try:
        from app.pipeline.cut_detector import adjust_transcript_for_cuts, apply_cuts, get_video_duration
        cut_path = str(get_path(job.id, "cut_video.mp4"))
        apply_cuts(job.original_file, job.cuts, cut_path)

        clean_duration = get_video_duration(cut_path)
        base_tx = job.raw_transcript or job.transcript
        if base_tx:
            # Re-agrupa com as regras atuais (vírgula quebra; nunca termina em
            # preposição) — jobs antigos foram chunkados com regras antigas
            from app.pipeline.transcribe import rechunk_transcript
            synced_transcript = adjust_transcript_for_cuts(rechunk_transcript(base_tx), job.cuts)
            update_job(job.id, transcript=synced_transcript)

        update_job(job.id, status=JobStatus.GRADING, progress=60)

        clean_path = str(get_path(job.id, "clean_video.mp4"))
        grade_opts = job.style_options.color_grade if job.style_options else None
        apply_color_grade(cut_path, clean_path, grade=grade_opts)

        update_job(
            job.id,
            status=JobStatus.CLEAN_READY,
            clean_video=clean_path,
            clean_duration=clean_duration,
            progress=100,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        update_job(job.id, status=JobStatus.ERROR, error_message=str(e))


class GradeUpdateRequest(BaseModel):
    color_grade: ColorGradeOptions


@router.patch("/api/jobs/{job_id}/grade")
async def update_grade(job_id: str, body: GradeUpdateRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    opts = job.style_options.model_dump() if job.style_options else {}
    opts["color_grade"] = body.color_grade.model_dump()
    updated = update_job(job_id, style_options=StyleOptions(**opts))

    return {"message": "Color grade atualizado!", "color_grade": body.color_grade.model_dump()}


@router.post("/api/jobs/{job_id}/split-image")
async def upload_split_image(job_id: str, file: UploadFile = File(...)):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    ext = ".jpg"
    if file.filename:
        ext = os.path.splitext(file.filename)[1].lower() or ".jpg"

    filename = f"split_image{ext}"
    saved_path = await save_upload(job_id, filename, file)
    web_url = get_url(job_id, filename)
    opts = job.style_options.model_dump() if job.style_options else {}
    opts.update({
        "layout": "split_screen",
        "split_screen_image": web_url,
        "split_screen_images": [web_url],
    })

    update_job(job_id, style_options=StyleOptions(**opts))
    return {"message": "Mídia de referência salva!", "path": web_url}


@router.post("/api/jobs/{job_id}/split-images")
async def upload_split_images(job_id: str, files: List[UploadFile] = File(...)):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    saved_urls = []
    for idx, f in enumerate(files):
        ext = os.path.splitext(f.filename or ".jpg")[1].lower() or ".jpg"
        fn = f"split_image_{idx}{ext}"
        await save_upload(job_id, fn, f)
        saved_urls.append(get_url(job_id, fn))

    opts = job.style_options.model_dump() if job.style_options else {}
    opts.update({
        "layout": "split_screen",
        "split_screen_image": saved_urls[0] if saved_urls else None,
        "split_screen_images": saved_urls,
    })

    update_job(job_id, style_options=StyleOptions(**opts))
    return {"message": "Múltiplas mídias de split salvas!", "paths": saved_urls}


@router.post("/api/jobs/{job_id}/auto-broll")
async def trigger_auto_broll(job_id: str):
    job = get_job(job_id)
    if not job or not job.transcript:
        raise HTTPException(400, "Transcrição necessária para gerar Auto B-Roll.")

    output_dir = Path(get_path(job_id, "")).parent
    img_path = fetch_auto_broll_image(job.transcript, output_dir)

    if not img_path:
        raise HTTPException(500, "Não foi possível buscar imagem de B-Roll automática.")

    filename = os.path.basename(img_path)
    web_url = get_url(job_id, filename)

    opts = job.style_options.model_dump() if job.style_options else {}
    opts.update({
        "layout": "split_screen",
        "split_screen_image": web_url,
        "split_screen_images": [web_url],
        "auto_broll_enabled": True,
    })

@router.get("/api/jobs/{job_id}/broll-suggestions")
async def get_broll_suggestions(job_id: str):
    job = get_job(job_id)
    if not job or not job.transcript:
        raise HTTPException(400, "Transcrição necessária para sugerir B-Rolls.")

    output_dir = Path(get_path(job_id, "")).parent
    suggestions = generate_broll_timeline_suggestions(job.transcript, output_dir)
    return {"suggestions": suggestions}


class BRollActionRequest(BaseModel):
    suggestion_id: str
    media_url: str
    action: str = "accept"  # accept or reject


@router.post("/api/jobs/{job_id}/broll-suggestions/action")
async def apply_broll_suggestion_action(job_id: str, body: BRollActionRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    opts = job.style_options.model_dump() if job.style_options else {}
    if body.action == "accept" and body.media_url:
        opts.update({
            "layout": "split_screen",
            "split_screen_image": body.media_url,
            "split_screen_images": [body.media_url],
            "auto_broll_enabled": True,
        })
        update_job(job_id, style_options=StyleOptions(**opts))
        return {"message": "B-Roll aceito e aplicado à timeline!", "media_url": body.media_url}
    
    return {"message": "Sugestão ignorada."}


@router.put("/api/jobs/{job_id}/transcript")
async def update_job_transcript(job_id: str, body: TranscriptUpdateRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    updated = update_job(job_id, transcript=body.transcript)
    return {"message": "Transcrição atualizada com sucesso!", "transcript": updated.transcript}


@router.post("/api/jobs/{job_id}/render")
async def trigger_render(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    if job.status not in (JobStatus.CLEAN_READY, JobStatus.DONE, JobStatus.RENDERING, JobStatus.ERROR):
        raise HTTPException(400, f"Job não está pronto para renderização (status: {job.status})")

    enqueue(job, _run_render_pipeline)
    return {"message": "Renderização iniciada!", "status": job.status}


def _synced_transcript_for_render(job: Job):
    """Garante que a legenda esteja no tempo do vídeo CORTADO antes de queimar.

    Se as marcações passarem da duração do vídeo limpo, elas ainda estão no tempo
    do vídeo original — recalcula a partir do áudio bruto em vez de queimar a
    legenda fora de sincronia (e conserta jobs salvos errados por versões antigas).
    """
    tx = job.transcript
    if not tx or not job.cuts or not job.clean_duration:
        return tx
    if tx[-1].end <= job.clean_duration + 0.5:
        return tx

    base = job.raw_transcript
    if not base:
        return tx
    from app.pipeline.cut_detector import adjust_transcript_for_cuts
    from app.pipeline.transcribe import rechunk_transcript
    fixed = adjust_transcript_for_cuts(rechunk_transcript(base), job.cuts)
    print(
        f"🔧 Legenda fora de sincronia ({tx[-1].end:.2f}s > vídeo de "
        f"{job.clean_duration:.2f}s) — recalculada para {fixed[-1].end:.2f}s"
    )
    update_job(job.id, transcript=fixed)
    return fixed


def _run_render_pipeline(job: Job):
    try:
        update_job(job.id, status=JobStatus.RENDERING, progress=5)
        clean_path = str(get_path(job.id, "clean_video.mp4"))
        final_path = str(get_path(job.id, "final_video.mp4"))

        render_final_video(
            clean_video_path=clean_path,
            output_path=final_path,
            style_options=job.style_options,
            transcript=_synced_transcript_for_render(job),
            cuts=job.cuts,
        )

        update_job(
            job.id,
            status=JobStatus.DONE,
            final_video=final_path,
            progress=100,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        update_job(job.id, status=JobStatus.ERROR, error_message=str(e))


class BatchRenderPayload(BaseModel):
    formats: List[str] = Field(default_factory=lambda: ["9:16", "4:5", "1:1", "16:9"])


@router.post("/api/jobs/{job_id}/batch_render")
async def trigger_batch_render(job_id: str, payload: Optional[BatchRenderPayload] = None):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    formats = payload.formats if (payload and payload.formats) else ["9:16", "4:5", "1:1"]

    update_job(job_id, status=JobStatus.RENDERING, progress=10)
    enqueue(job, _run_batch_render_pipeline, formats)
    return {"message": f"Renderização em lote de {len(formats)} formatos iniciada!", "status": job.status, "formats": formats}


def _run_batch_render_pipeline(job: Job, formats: List[str]):
    try:
        clean_path = str(get_path(job.id, "clean_video.mp4"))
        transcript = _synced_transcript_for_render(job)
        batch_videos = {}
        rendered_files = []

        total_fmt = len(formats)
        for i, fmt in enumerate(formats):
            slug = fmt.replace(":", "_")
            out_filename = f"final_{slug}.mp4"
            out_path = str(get_path(job.id, out_filename))

            current_style = job.style_options.copy() if job.style_options else StyleOptions()
            current_style.aspect_ratio = fmt

            render_final_video(
                clean_video_path=clean_path,
                output_path=out_path,
                style_options=current_style,
                transcript=transcript,
                cuts=job.cuts,
            )

            v_url = get_url(job.id, out_filename)
            batch_videos[fmt] = v_url
            rendered_files.append((out_filename, out_path))

            progress_pct = int(10 + ((i + 1) / total_fmt) * 80)
            update_job(job.id, progress=progress_pct, batch_videos=batch_videos)

        import zipfile
        zip_filename = "export_batch.zip"
        zip_path = str(get_path(job.id, zip_filename))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for fname, fpath in rendered_files:
                if os.path.exists(fpath):
                    zipf.write(fpath, arcname=f"editu_video_{fname}")

        batch_zip_url = get_url(job.id, zip_filename)
        first_video_path = rendered_files[0][1] if rendered_files else None

        update_job(
            job.id,
            status=JobStatus.DONE,
            final_video=first_video_path,
            batch_videos=batch_videos,
            batch_zip_url=batch_zip_url,
            progress=100,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        update_job(job.id, status=JobStatus.ERROR, error_message=str(e))


@router.get("/api/jobs/{job_id}/download/{filename}")
async def download_job_file(job_id: str, filename: str):
    """Download a rendered file with Content-Disposition: attachment (forces native save dialog)."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    safe = os.path.basename(filename)
    file_path = get_path(job_id, safe)
    if not os.path.exists(file_path):
        raise HTTPException(404, "Arquivo não encontrado")

    return FileResponse(
        path=str(file_path),
        filename=safe,
        media_type="application/octet-stream",
    )
