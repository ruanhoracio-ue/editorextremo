from __future__ import annotations

import os
import subprocess
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.models.schemas import Job, JobStatus
from app.storage.manager import save_upload
from app.queue.worker import enqueue, update_job
from app.pipeline.transcribe import transcribe_audio
from app.pipeline.cut_detector import (
    compute_keep_segments,
    apply_cuts,
    get_video_duration,
    adjust_transcript_for_cuts,
    get_ffmpeg_binary,
)
from app.pipeline.color_grade import apply_color_grade
from app.storage.manager import get_path

router = APIRouter()

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB


@router.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video and start automatic cleanup pipeline (Etapa 1)."""
    ext = os.path.splitext(file.filename or "video.mp4")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Formato não suportado: {ext}. Use: {', '.join(ALLOWED_EXTENSIONS)}")

    job = Job(original_filename=file.filename)
    saved_path = await save_upload(job.id, f"original{ext}", file)
    job.original_file = saved_path

    enqueue(job, run_cleanup_pipeline)

    return {
        "job_id": job.id,
        "status": job.status,
        "message": "Upload realizado! Processamento iniciado.",
    }


def normalize_video_orientation(input_path: str, output_path: str) -> str:
    """
    Etapa 0: Fast physical orientation normalization right after upload.
    Forces strict CFR 30.00 FPS and aligned AAC audio to eliminate VFR drift.
    """
    ffmpeg_exe = get_ffmpeg_binary()
    cmd = [
        ffmpeg_exe, "-y",
        "-autorotate",
        "-i", input_path,
        "-r", "30", "-vsync", "cfr",
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
        "-c:a", "aac", "-b:a", "128k", "-af", "aresample=async=1",
        output_path
    ]
    try:
        print(f"🔄 Etapa 0 — Normalizando orientação física e CFR 30.0 FPS: {input_path}")
        subprocess.run(cmd, capture_output=True, text=True, timeout=900, check=True)
        return output_path
    except Exception as e:
        print(f"⚠️ Orientation normalization skipped ({e}). Using raw upload for instant preview.")
        return input_path


def extract_clean_audio_wav(video_path: str, wav_path: str) -> str:
    """Extract 100% linear 16kHz uncompressed mono PCM WAV for absolute zero-drift Whisper transcription."""
    ffmpeg_exe = get_ffmpeg_binary()
    cmd = [
        ffmpeg_exe, "-y",
        "-i", video_path,
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        wav_path
    ]
    try:
        print(f"🎙️ Extraindo áudio linear 16kHz PCM para transcrição exata: {wav_path}")
        subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=True)
        return wav_path
    except Exception as e:
        print(f"⚠️ Audio extraction warning: {e}. Using video path.")
        return video_path


def run_cleanup_pipeline(job: Job) -> None:
    """
    Full cleanup pipeline:
    0. Normalize video orientation physically to 1080x1920 (CFR 30 FPS)
    1. Extract linear 16kHz PCM WAV & transcribe audio with absolute sync
    2. Detect and compute cuts in breath gaps
    3. Apply 100% sample-accurate cuts & adjust transcript timestamps
    4. Apply color grade
    5. Save clean video
    """
    try:
        # Step 0: Set status to TRANSCRIBING & normalize CFR 30 FPS
        update_job(job.id, status=JobStatus.TRANSCRIBING, progress=10)
        normalized_path = str(get_path(job.id, "normalized.mp4"))
        working_file = normalize_video_orientation(job.original_file, normalized_path)
        update_job(job.id, original_file=working_file, progress=25)

        # Step 1: Extract linear PCM WAV & Transcribe
        wav_path = str(get_path(job.id, "audio.wav"))
        clean_audio = extract_clean_audio_wav(working_file, wav_path)
        raw_transcript = transcribe_audio(clean_audio)
        update_job(job.id, raw_transcript=raw_transcript, transcript=raw_transcript, progress=45)

        # Step 2: Detect cuts in breath gaps
        update_job(job.id, status=JobStatus.CUTTING, progress=55)
        original_duration = get_video_duration(working_file)
        keep_segments, silences = compute_keep_segments(working_file, raw_transcript)

        # Step 3: Apply sample-accurate cuts & re-sync transcript
        cut_path = str(get_path(job.id, "cut_video.mp4"))
        apply_cuts(working_file, keep_segments, cut_path)
        clean_duration = get_video_duration(cut_path)

        synced_transcript = adjust_transcript_for_cuts(raw_transcript, keep_segments)

        update_job(
            job.id,
            cuts=keep_segments,
            silences=silences,
            transcript=synced_transcript,
            original_duration=original_duration,
            clean_duration=clean_duration,
            progress=75,
        )

        # Step 4: Color grade
        update_job(job.id, status=JobStatus.GRADING, progress=88)
        clean_path = str(get_path(job.id, "clean_video.mp4"))
        grade_opts = job.style_options.color_grade if job.style_options else None
        apply_color_grade(cut_path, clean_path, grade=grade_opts)

        # Step 5: Done
        update_job(
            job.id,
            status=JobStatus.CLEAN_READY,
            clean_video=clean_path,
            progress=100,
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        update_job(job.id, status=JobStatus.ERROR, error_message=str(e))
        raise
