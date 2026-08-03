"""Editu Backend — FastAPI Application Entry Point."""

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.upload import router as upload_router
from app.api.jobs import router as jobs_router
from app.api.render import router as render_router


app = FastAPI(
    title="Editu API",
    description="API para edição automática de vídeos curtos",
    version="1.0.0",
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(upload_router)
app.include_router(jobs_router)
app.include_router(render_router)

# Serve storage files statically
storage_dir = Path(__file__).resolve().parent.parent / "storage"
storage_dir.mkdir(parents=True, exist_ok=True)
app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")


@app.get("/")
async def root():
    return {
        "app": "Editu",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
