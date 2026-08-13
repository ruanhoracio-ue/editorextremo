import { Job, StyleOptions, CutSegment, TranscriptSegment, ColorGradeOptions } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function extractDetail(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const detail = (err as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "string" ? d : typeof d === "object" && d !== null ? (d as { msg?: unknown }).msg ?? JSON.stringify(d) : JSON.stringify(d)))
      .filter(Boolean)
      .join("; ");
  }
  return null;
}

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
    throw new Error(extractDetail(err) || "Erro ao salvar estilo");
  }
}

export async function startRender(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/render`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Erro ao iniciar renderização");
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
    throw new Error(extractDetail(err) || "Erro ao iniciar renderização em lote");
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
    throw new Error(extractDetail(err) || "Erro ao atualizar transcrição");
  }
}

export async function updateCuts(
  jobId: string,
  cuts: CutSegment[],
  reprocess: boolean = true
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/cuts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cuts, reprocess }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Erro ao atualizar cortes");
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
    throw new Error(extractDetail(err) || "Erro ao atualizar color grade");
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
    throw new Error(extractDetail(err) || "Erro ao enviar mídia de referência");
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
    throw new Error(extractDetail(err) || "Erro ao enviar mídias de referência");
  }
  return res.json();
}

export async function triggerAutoBroll(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/auto-broll`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Erro ao gerar Auto B-Roll");
  }
}

export async function fetchBRollSuggestions(jobId: string): Promise<import("./types").BRollSuggestion[]> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/broll-suggestions`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Erro ao carregar sugestões de B-Roll");
  }
  const data = await res.json();
  return data.suggestions || [];
}

export async function actionBRollSuggestion(
  jobId: string,
  suggestionId: string,
  mediaUrl: string,
  action: "accept" | "reject" = "accept"
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/broll-suggestions/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_id: suggestionId, media_url: mediaUrl, action }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Erro ao aplicar sugestão de B-Roll");
  }
}

export function getVideoUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const storageIndex = path.indexOf("/storage/");
  if (storageIndex !== -1) {
    const relPath = path.substring(storageIndex);
    return `${API_BASE}${relPath}`;
  }

  if (path.startsWith("storage/")) {
    return `${API_BASE}/${path}`;
  }

  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}

export function getDownloadUrl(jobId: string, filename: string): string {
  return `${API_BASE}/api/jobs/${jobId}/download/${encodeURIComponent(filename)}`;
}

/** Envia um anexo (imagem/PNG) e devolve a URL para usar em style.overlays. */
export async function uploadOverlay(jobId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/overlay`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Erro ao enviar o anexo");
  }
  const data = await res.json();
  return data.src as string;
}

/** Recomeça o processamento de um vídeo que travou (app fechado no meio, por exemplo). */
export async function retryJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/retry`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(extractDetail(err) || "Não foi possível recomeçar o processamento");
  }
}
