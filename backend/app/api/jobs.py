from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from pydantic import BaseModel

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
from app.storage.manager import get_path, save_upload
from app.pipeline.color_grade import apply_color_grade
from app.pipeline.broll import fetch_auto_broll_image

router = APIRouter()


class StyleUpdateRequest(BaseModel):
    style_options: StyleOptions


class CutsUpdateRequest(BaseModel):
    cuts: List[CutSegment]


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
        final_url = f"/storage/{job_id}/final_video.mp4"

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
    }


@router.put("/api/jobs/{job_id}/style")
async def update_job_style(job_id: str, body: StyleUpdateRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    updated = update_job(job_id, style_options=body.style_options)
    return {"message": "Estilo atualizado com sucesso!", "style_options": updated.style_options}


@router.put("/api/jobs/{job_id}/cuts")
async def update_job_cuts(job_id: str, body: CutsUpdateRequest):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    update_job(job_id, cuts=body.cuts)
    enqueue(job, _reprocess_cuts)

    return {"message": "Cortes atualizados! Reprocessando...", "status": job.status}


def _reprocess_cuts(job: Job):
    try:
        from app.pipeline.cut_detector import adjust_transcript_for_cuts, apply_cuts, get_video_duration
        cut_path = str(get_path(job.id, "cut_video.mp4"))
        apply_cuts(job.original_file, job.cuts, cut_path)

        clean_duration = get_video_duration(cut_path)
        base_tx = job.raw_transcript or job.transcript
        if base_tx:
            synced_transcript = adjust_transcript_for_cuts(base_tx, job.cuts)
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

    saved_path = await save_upload(job_id, f"split_image{ext}", file)
    opts = job.style_options.model_dump() if job.style_options else {}
    opts.update({
        "layout": "split_screen",
        "split_screen_image": saved_path,
        "split_screen_images": [saved_path],
    })

    update_job(job_id, style_options=StyleOptions(**opts))
    return {"message": "Mídia de referência salva!", "path": saved_path}


@router.post("/api/jobs/{job_id}/split-images")
async def upload_split_images(job_id: str, files: List[UploadFile] = File(...)):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    saved_paths = []
    for idx, f in enumerate(files):
        ext = os.path.splitext(f.filename or ".jpg")[1].lower() or ".jpg"
        p = await save_upload(job_id, f"split_image_{idx}{ext}", f)
        saved_paths.append(p)

    opts = job.style_options.model_dump() if job.style_options else {}
    opts.update({
        "layout": "split_screen",
        "split_screen_image": saved_paths[0] if saved_paths else None,
        "split_screen_images": saved_paths,
    })

    update_job(job_id, style_options=StyleOptions(**opts))
    return {"message": "Múltiplas mídias de split salvas!", "paths": saved_paths}


@router.post("/api/jobs/{job_id}/auto-broll")
async def trigger_auto_broll(job_id: str):
    job = get_job(job_id)
    if not job or not job.transcript:
        raise HTTPException(400, "Transcrição necessária para gerar Auto B-Roll.")

    output_dir = Path(get_path(job_id, "")).parent
    img_path = fetch_auto_broll_image(job.transcript, output_dir)

    if not img_path:
        raise HTTPException(500, "Não foi possível buscar imagem de B-Roll automática.")

    opts = job.style_options.model_dump() if job.style_options else {}
    opts.update({
        "layout": "split_screen",
        "split_screen_image": img_path,
        "split_screen_images": [img_path],
        "auto_broll_enabled": True,
    })

    update_job(job_id, style_options=StyleOptions(**opts))
    return {"message": "Auto B-Roll aplicado com sucesso!", "image_path": img_path}


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

    if job.status not in (JobStatus.CLEAN_READY, JobStatus.DONE, JobStatus.ERROR):
        raise HTTPException(400, f"Job não está pronto para renderização (status: {job.status})")

    enqueue(job, _run_render_pipeline)
    return {"message": "Renderização iniciada!", "status": job.status}


def _run_render_pipeline(job: Job):
    try:
        update_job(job.id, status=JobStatus.RENDERING, progress=5)
        clean_path = str(get_path(job.id, "clean_video.mp4"))
        final_path = str(get_path(job.id, "final_video.mp4"))

        render_final_video(
            clean_video_path=clean_path,
            output_path=final_path,
            style_options=job.style_options,
            transcript=job.transcript,
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
