from __future__ import annotations

import json
import os
import threading
import traceback
from pathlib import Path
from typing import Callable, Dict, Optional, List

from app.models.schemas import Job, JobStatus


# In-memory job store, persisted to disk so state survives backend restarts.
_jobs: Dict[str, Job] = {}
_lock = threading.Lock()

_STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"
_JOBS_FILE = _STORAGE_ROOT / "_jobs.json"


def _persist() -> None:
    """Write the job store to disk (best-effort, non-fatal on failure)."""
    try:
        with _lock:
            data = [j.model_dump(mode="json") for j in _jobs.values()]
        tmp = _JOBS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_JOBS_FILE)
    except Exception as e:
        print(f"⚠️ Persist jobs warning: {e}")


def _load_from_disk() -> None:
    """Restore previously persisted jobs at startup."""
    try:
        if not _JOBS_FILE.exists():
            return
        data = json.loads(_JOBS_FILE.read_text(encoding="utf-8"))
        for item in data:
            try:
                job = Job(**item)
                _jobs[job.id] = job
            except Exception:
                continue
        print(f"📂 Restaurados {len(_jobs)} jobs do disco.")
    except Exception as e:
        print(f"⚠️ Load jobs warning: {e}")


def get_job(job_id: str) -> Job | None:
    """Retrieve a job by ID."""
    with _lock:
        return _jobs.get(job_id)


def save_job(job: Job) -> None:
    """Save/update a job in the store and persist to disk."""
    with _lock:
        _jobs[job.id] = job
    _persist()


def update_job(job_id: str, **kwargs) -> Job | None:
    """Update specific fields on a job and persist to disk."""
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        for key, value in kwargs.items():
            setattr(job, key, value)
        _jobs[job_id] = job
    _persist()
    return job


def list_jobs() -> list[Job]:
    """List all jobs."""
    with _lock:
        return list(_jobs.values())


def enqueue(job: Job, task_fn: Callable[..., None], *args, **kwargs) -> None:
    """
    Enqueue a job to be processed by task_fn in a background thread.

    FUTURE: Replace with celery.send_task() for production.
    """
    save_job(job)

    def _run():
        try:
            task_fn(job, *args, **kwargs)
        except Exception as e:
            traceback.print_exc()
            update_job(job.id, status=JobStatus.ERROR, error_message=str(e))

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()


_load_from_disk()
