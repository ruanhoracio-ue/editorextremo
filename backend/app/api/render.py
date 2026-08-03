from __future__ import annotations

from fastapi import APIRouter, HTTPException
from app.models.schemas import Job, JobStatus, StyleOptions
from app.queue.worker import get_job, update_job, enqueue
from app.pipeline.render_final import render_final_video
from app.storage.manager import get_path, get_url

router = APIRouter()


@router.post("/api/jobs/{job_id}/render")
async def render_video(job_id: str):
    """Start the final render (Etapa 2) with the saved style options."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")

    if job.status not in ("clean_ready", "done", "rendering"):
        raise HTTPException(400, f"O vídeo não está pronto para renderizar (status: {job.status}).")

    if not job.style_options:
        # Use default style if none set
        update_job(job_id, style_options=StyleOptions())
        job = get_job(job_id)

    # Re-enqueue for render
    update_job(job_id, status=JobStatus.RENDERING, progress=0)
    enqueue(job, run_render_pipeline)

    return {
        "message": "Renderização final iniciada!",
        "job_id": job_id,
    }


def run_render_pipeline(job: Job) -> None:
    """Run the final render pipeline (Etapa 2)."""
    try:
        update_job(job.id, progress=20)

        output_path = str(get_path(job.id, "final_video.mp4"))
        style = job.style_options if job.style_options else StyleOptions()

        update_job(job.id, progress=50)

        render_final_video(
            clean_video_path=job.clean_video,
            output_path=output_path,
            style_options=style,
            transcript=job.transcript,
            cuts=job.cuts,
        )

        update_job(
            job.id,
            status=JobStatus.DONE,
            final_video=output_path,
            progress=100,
        )

    except Exception as e:
        update_job(job.id, status=JobStatus.ERROR, error_message=str(e))
        raise
