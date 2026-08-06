"""Local storage manager with abstract interface ready for S3/R2 migration."""

import os
import shutil
from pathlib import Path

# Base storage directory
STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"


def ensure_job_dir(job_id: str) -> Path:
    """Create and return the storage directory for a specific job."""
    job_dir = STORAGE_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def get_path(job_id: str, filename: str) -> Path:
    """Get the full path for a file within a job's storage directory."""
    return ensure_job_dir(job_id) / filename


def save_file(job_id: str, filename: str, content: bytes) -> str:
    """Save bytes to a file in the job's storage directory. Returns the relative path."""
    path = get_path(job_id, filename)
    path.write_bytes(content)
    return str(path)


async def save_upload(job_id: str, filename: str, upload_file) -> str:
    """Save an uploaded file (from FastAPI UploadFile). Returns the full path."""
    path = get_path(job_id, filename)
    with open(path, "wb") as f:
        while chunk := await upload_file.read(1024 * 1024):  # 1MB chunks
            f.write(chunk)
    return str(path)


def get_url(job_id: str, filename: str) -> str:
    """
    Get a URL-safe path for serving files.
    For local storage, returns /storage/{job_id}/{filename}.
    FUTURE: For S3/R2, would return a signed URL.
    """
    return f"/storage/{job_id}/{filename}"


def delete_job(job_id: str) -> None:
    """Delete all files for a job."""
    job_dir = STORAGE_ROOT / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir)


def file_exists(job_id: str, filename: str) -> bool:
    """Check if a file exists in storage."""
    return get_path(job_id, filename).exists()
