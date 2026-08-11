"""Editu Backend — FastAPI Application Entry Point."""

import mimetypes
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(upload_router)
app.include_router(jobs_router)
app.include_router(render_router)

# Serve storage files com suporte a HTTP Range (necessário pro <video> conseguir
# dar seek/scrub — o StaticFiles/FileResponse desta versão do Starlette não trata Range,
# então respondemos 206 Partial Content na mão).
storage_dir = Path(__file__).resolve().parent.parent / "storage"
storage_dir.mkdir(parents=True, exist_ok=True)

_RANGE_CHUNK = 1024 * 1024  # 1 MiB por bloco no streaming


def _resolve_storage_file(file_path: str) -> Path:
    """Resolve o caminho dentro de storage/ barrando path traversal."""
    root = storage_dir.resolve()
    target = (storage_dir / file_path).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return target


@app.api_route("/storage/{file_path:path}", methods=["GET", "HEAD"])
async def serve_storage(file_path: str, request: Request):
    target = _resolve_storage_file(unquote(file_path))
    file_size = target.stat().st_size
    content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    range_header = request.headers.get("range")

    # Sem Range: arquivo inteiro, mas anunciando suporte a Range pro browser voltar pedindo faixas.
    if not range_header or not range_header.startswith("bytes="):
        if request.method == "HEAD":
            return Response(
                status_code=200,
                headers={
                    "accept-ranges": "bytes",
                    "content-length": str(file_size),
                    "content-type": content_type,
                },
            )
        return FileResponse(
            str(target),
            media_type=content_type,
            headers={"accept-ranges": "bytes"},
        )

    # Com Range: 206 Partial Content
    try:
        spec = range_header.split("=", 1)[1].split(",", 1)[0].strip()
        start_s, _, end_s = spec.partition("-")
        if start_s == "":
            # Range de sufixo ("bytes=-N"): últimos N bytes (Safari usa isso)
            n = int(end_s)
            start = max(0, file_size - n)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
    except ValueError:
        raise HTTPException(status_code=416, detail="Range inválido")

    if start > end or start >= file_size:
        return Response(status_code=416, headers={"content-range": f"bytes */{file_size}"})

    end = min(end, file_size - 1)
    length = end - start + 1

    headers = {
        "accept-ranges": "bytes",
        "content-range": f"bytes {start}-{end}/{file_size}",
        "content-length": str(length),
        "content-type": content_type,
    }

    if request.method == "HEAD":
        return Response(status_code=206, headers=headers)

    def iter_range():
        with open(target, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(_RANGE_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(iter_range(), status_code=206, headers=headers)


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
