# EditorExtremo — Backend (FastAPI + faster-whisper + FFmpeg)
FROM python:3.11-slim

# FFmpeg (inclui ffprobe) para corte/render e detecção de duração
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências primeiro (cache de build)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Código da aplicação
COPY app ./app

# Pasta de armazenamento (vídeos/jobs) — montada como volume no compose
RUN mkdir -p /app/storage

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
