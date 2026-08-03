import { Job, StyleOptions, CutSegment, TranscriptSegment, ColorGradeOptions } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function uploadVideo(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ job_id: string; status: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Resposta inválida do servidor"));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || "Erro ao fazer upload do vídeo"));
        } catch {
          reject(new Error(`Erro ${xhr.status} no upload`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Falha na conexão ao enviar o vídeo. Verifique sua conexão."));
    xhr.ontimeout = () => reject(new Error("Tempo limite excedido ao enviar o vídeo."));

    xhr.open("POST", `${API_BASE}/api/upload`);
    xhr.send(formData);
  });
}

export async function fetchJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Job não encontrado");
    }
    throw new Error("Erro ao buscar status do job");
  }

  return res.json();
}

export const getJobStatus = fetchJob;

export async function setStyleOptions(
  jobId: string,
  styleOptions: StyleOptions
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/style`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style_options: styleOptions }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao salvar estilo");
  }
}

export async function startRender(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/render`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao iniciar renderização");
  }
}

export async function startBatchRender(jobId: string, formats: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/batch_render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formats }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao iniciar renderização em lote");
  }
}

export async function updateTranscript(
  jobId: string,
  transcript: TranscriptSegment[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/transcript`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao atualizar transcrição");
  }
}

export async function updateCuts(
  jobId: string,
  cuts: CutSegment[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/cuts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cuts }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao atualizar cortes");
  }
}

export async function updateColorGrade(
  jobId: string,
  colorGrade: ColorGradeOptions
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/grade`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color_grade: colorGrade }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao atualizar color grade");
  }
}

export async function uploadSplitImage(
  jobId: string,
  file: File
): Promise<{ message: string; path: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/split-image`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao enviar mídia de referência");
  }
  return res.json();
}

export async function uploadSplitImages(
  jobId: string,
  files: FileList | File[]
): Promise<{ message: string; paths: string[] }> {
  const formData = new FormData();
  Array.from(files).forEach((f) => formData.append("files", f));

  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/split-images`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao enviar mídias de referência");
  }
  return res.json();
}

export async function triggerAutoBroll(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/auto-broll`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erro ao gerar Auto B-Roll");
  }
}

export function getVideoUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}
