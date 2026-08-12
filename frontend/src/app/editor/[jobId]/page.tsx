"use client";

import { useState, useEffect, useRef, useCallback, use } from "react";
import { useJobStatus } from "@/hooks/useJobStatus";
import {
  setStyleOptions,
  startRender,
  startBatchRender,
  getVideoUrl,
  getDownloadUrl,
  updateCuts,
  retryJob,
  updateColorGrade,
  uploadSplitImage,
  uploadSplitImages,
  updateTranscript,
  triggerAutoBroll,
  fetchBRollSuggestions,
  actionBRollSuggestion,
} from "@/lib/api";
import {
  DEFAULT_STYLE_OPTIONS,
  type StyleOptions,
  type CutSegment,
  type TranscriptSegment,
  type SubtitleTheme,
  type ColorGradeOptions,
} from "@/lib/types";

type TabPhase = "corte" | "estilo" | "visual";

export default function EditorPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const { job, error, refetch } = useJobStatus(jobId);
  const [activeTab, setActiveTab] = useState<TabPhase>("corte");
  const [style, setStyle] = useState<StyleOptions>(DEFAULT_STYLE_OPTIONS);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [localCuts, setLocalCuts] = useState<CutSegment[]>([]);
  const [localTranscript, setLocalTranscript] = useState<TranscriptSegment[]>([]);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isAutoBrolling, setIsAutoBrolling] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [highlightColor, setHighlightColor] = useState("#10b981");
  const [selectedExportFormats, setSelectedExportFormats] = useState<string[]>(["9:16", "4:5", "1:1"]);

  // Trim (in/out points) — sobre a linha do tempo ORIGINAL. Deriva os cuts enviados ao backend.
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [dragKind, setDragKind] = useState<null | "start" | "end" | "playhead" | "remove">(null);
  // Modo "remover trecho do meio": arrastar na linha do tempo marca a faixa errada e remove
  const [removeMode, setRemoveMode] = useState(false);
  const [removeSel, setRemoveSel] = useState<{ a: number; b: number } | null>(null);
  // Bump a cada reprocessamento concluído — força o <video> a recarregar o clean_video
  // novo do disco (sem isso o navegador toca o vídeo antigo em cache e a legenda "sai fora")
  const [cleanVersion, setCleanVersion] = useState(0);

  const [isDraggingSub, setIsDraggingSub] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  // Dimensões reais do vídeo (pro preview cortar igual ao render final)
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const topVideoRef = useRef<HTMLVideoElement>(null);
  // Cópia muda do vídeo usada como fundo desfocado quando o formato não bate
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const gradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitInputRef = useRef<HTMLInputElement>(null);
  // Scrub por arraste no preview (clique = play/pause, arraste horizontal = navegar)
  const scrubRef = useRef<{ active: boolean; startX: number; startT: number; moved: boolean; wasPlaying: boolean }>({
    active: false, startX: 0, startT: 0, moved: false, wasPlaying: false,
  });
  // Refs espelhando o estado, pra os listeners de drag lerem sempre o valor mais recente
  const localCutsRef = useRef<CutSegment[]>([]);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);
  const corteDurationRef = useRef(1);
  const timelineRef = useRef<HTMLDivElement>(null);
  // Seleção do modo "remover trecho" (ref pro pointerup ler o valor mais recente)
  const removeSelRef = useRef<{ a: number; b: number } | null>(null);
  const removeAnchorRef = useRef(0);
  // Há edições de corte ainda não aplicadas no vídeo limpo (aplica ao sair da aba Corte)
  const cutsDirtyRef = useRef(false);
  // O usuário editou o texto da transcrição? Só nesse caso a tela pode devolver o
  // transcript ao backend — senão ela sobrescreve o que o servidor sincronizou.
  const transcriptDirtyRef = useRef(false);
  const transcriptSigRef = useRef("");
  // Só considera o reprocessamento concluído depois de ver o job OCUPADO ao menos uma
  // vez — ignora respostas de poll atrasadas que ainda dizem "clean_ready" antigo
  const sawBusyRef = useRef(true);
  const userTouchedStyle = useRef(false);

  // Track when we've done our initial data sync from a finished job
  const hasInitialSyncedFinishedJob = useRef(false);

  // Sync from job on initial load and when processing finishes
  useEffect(() => {
    if (!job) return;
    if (job.style_options && !userTouchedStyle.current) {
      setStyle(job.style_options);
    }

    const isJobFinished = job.status === "clean_ready" || job.status === "done";

    // Carrega os segmentos-base UMA vez (quando os cortes chegam da IA) e inicializa o trim
    // a partir dos limites habilitados. Depois disso NÃO sobrescrevemos os segmentos-base:
    // eles são a fonte da verdade da edição, e o que enviamos ao backend é derivado (trim + toggles).
    if (job.cuts && job.cuts.length > 0 && localCuts.length === 0) {
      setLocalCuts(job.cuts);
      localCutsRef.current = job.cuts;
      const en = job.cuts.filter((c) => c.enabled);
      const a = en.length ? en[0].start : job.cuts[0].start;
      const b = en.length ? en[en.length - 1].end : job.cuts[job.cuts.length - 1].end;
      setTrimStart(a);
      setTrimEnd(b);
      trimStartRef.current = a;
      trimEndRef.current = b;
    }
    // Recarrega a transcrição sempre que o servidor publicar uma versão diferente
    // (ex.: depois de um reprocessamento de cortes). Só não sobrescreve se o usuário
    // estiver editando o texto. O guarda antigo ("carrega só se estiver vazia")
    // travava a tela na primeira versão recebida, que podia ser a não-sincronizada.
    if (job.transcript && job.transcript.length > 0 && !transcriptDirtyRef.current) {
      const last = job.transcript[job.transcript.length - 1];
      const sig = `${job.transcript.length}:${job.transcript[0].start}:${last.end}`;
      if (sig !== transcriptSigRef.current) {
        transcriptSigRef.current = sig;
        setLocalTranscript(job.transcript);
      }
    }

    if (!isJobFinished) sawBusyRef.current = true;

    if (isJobFinished) {
      hasInitialSyncedFinishedJob.current = true;
      // Ao concluir um reprocessamento, o backend recalcula as marcações da transcrição
      // (adjust_transcript_for_cuts) — atualizamos a transcrição, liberamos o estado e
      // versionamos a URL do clean_video pro navegador recarregar o arquivo novo
      // (sem isso ele toca o vídeo antigo em cache e a legenda dessincroniza).
      if (isReprocessing && sawBusyRef.current) {
        // O backend regenerou a transcrição a partir do áudio original, então
        // qualquer edição de texto pendente já foi substituída de qualquer forma.
        if (job.transcript) {
          transcriptDirtyRef.current = false;
          setLocalTranscript(job.transcript);
        }
        setIsReprocessing(false);
        setCleanVersion((v) => v + 1);
      }
    }
  }, [job, isReprocessing, localCuts.length]);

  const updateStyleAndPersist = useCallback(
    async (updater: (prev: StyleOptions) => StyleOptions) => {
      userTouchedStyle.current = true;
      setStyle((prev) => {
        const next = updater(prev);
        setStyleOptions(jobId, next).catch(console.error);
        return next;
      });
    },
    [jobId]
  );

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      // Corrige deriva do fundo desfocado (ele é uma cópia independente do vídeo)
      const bg = bgVideoRef.current;
      if (bg && Math.abs(bg.currentTime - videoRef.current.currentTime) > 0.25) {
        bg.currentTime = videoRef.current.currentTime;
      }
    }
  };

  const handlePlay = () => {
    if (topVideoRef.current) topVideoRef.current.play().catch(() => {});
    if (bgVideoRef.current && videoRef.current) {
      bgVideoRef.current.currentTime = videoRef.current.currentTime;
      bgVideoRef.current.play().catch(() => {});
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    if (topVideoRef.current) topVideoRef.current.pause();
    if (bgVideoRef.current) bgVideoRef.current.pause();
    setIsPlaying(false);
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.videoWidth && v.videoHeight) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
  };

  const targetBoxAR = (() => {
    const ar = style.aspect_ratio || "9:16";
    const [bw, bh] = ar === "4:5" ? [4, 5] : ar === "1:1" ? [1, 1] : ar === "16:9" ? [16, 9] : [9, 16];
    return bw / bh;
  })();

  // Espelha o BLUR_BG_MIN_VISIBLE do backend: formato muito diferente do original
  // ⇒ vídeo inteiro centralizado sobre fundo desfocado, em vez de recortar.
  const useBlurBg = (() => {
    if (!videoDims) return false;
    const vidAR = videoDims.w / videoDims.h;
    if (targetBoxAR <= vidAR) return false; // horizontal → 9:16 continua recortando no rosto
    return vidAR / targetBoxAR < 0.5;
  })();

  // Espelha o corte inteligente do render: quando o preview precisa cortar a ALTURA
  // do vídeo (object-cover), a janela fica ancorada em 35% do frame (linha do rosto
  // em vídeo falado) — mesma conta do SMART_CROP_Y do backend.
  const smartObjectPosition = (() => {
    if (!videoDims) return "center center";
    const boxAR = targetBoxAR;
    const vidAR = videoDims.w / videoDims.h;
    if (vidAR >= boxAR) return "center center"; // corta largura: mantém centro
    // corta altura: escala cover, janela centrada em 35% da altura escalada
    const scaledH = 1 / vidAR * boxAR; // altura do vídeo em unidades de "altura da caixa"
    const overflow = scaledH - 1;
    if (overflow <= 0.001) return "center center";
    const y = Math.max(0, Math.min(overflow, scaledH * 0.35 - 0.5));
    return `center ${((y / overflow) * 100).toFixed(1)}%`;
  })();

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const target = e.currentTarget;
    setVideoError(`Não foi possível carregar o vídeo (${target.src || "sem fonte"}). O arquivo pode ter sido removido ou corrompido.`);
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (topVideoRef.current) topVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      if (topVideoRef.current) topVideoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
    if (topVideoRef.current) {
      topVideoRef.current.currentTime = newTime;
    }
    if (bgVideoRef.current) {
      bgVideoRef.current.currentTime = newTime;
    }
  };

  // Na aba de corte o preview toca o vídeo ORIGINAL, mas o transcript está em tempo
  // do vídeo LIMPO (pós-corte). Mapeia original → limpo pra legenda não "sair fora"
  // quando o usuário corta o início/fim.
  const subtitleTime = (() => {
    if (activeTab !== "corte" || !job?.original_video_url) return currentTime;
    const ts = trimStart;
    const te = trimEnd || job?.original_duration || Infinity;
    let clean = 0;
    for (const c of localCuts) {
      if (!c.enabled) continue;
      const s = Math.max(c.start, ts);
      const e = Math.min(c.end, te);
      if (e - s <= 0.05) continue;
      if (currentTime >= e) {
        clean += e - s;
        continue;
      }
      if (currentTime > s) clean += currentTime - s;
      break;
    }
    return clean;
  })();

  // PRECISE SUBTITLE SYNC — find the segment whose word-level time range
  // best covers subtitleTime. No artificial tolerances that cause overlapping matches.
  const activeSubIndex = (() => {
    let bestIdx = -1;
    let bestOverlap = -Infinity;
    for (let i = 0; i < localTranscript.length; i++) {
      const s = localTranscript[i];
      // Exact match: subtitleTime falls within the segment's word boundaries
      if (subtitleTime >= s.start && subtitleTime <= s.end) {
        // Prefer the tightest match (smallest segment duration)
        const overlap = s.end - s.start;
        if (bestIdx === -1 || overlap < bestOverlap) {
          bestIdx = i;
          bestOverlap = overlap;
        }
      }
    }
    // Small grace window (50ms after end) only if no exact match found,
    // to handle tiny gaps between consecutive segments
    if (bestIdx === -1) {
      for (let i = 0; i < localTranscript.length; i++) {
        const s = localTranscript[i];
        if (subtitleTime > s.end && subtitleTime <= s.end + 0.05) {
          bestIdx = i;
          break;
        }
      }
    }
    return bestIdx;
  })();
  const activeSub = activeSubIndex !== -1 ? localTranscript[activeSubIndex] : null;

  // Multi-File Split Carousel
  const splitUrls =
    style.split_screen_images && style.split_screen_images.length > 0
      ? style.split_screen_images
      : style.split_screen_image
      ? [style.split_screen_image]
      : job?.split_images_urls || (job?.split_image_url ? [job.split_image_url] : []);
  const currentSplitIdx = splitUrls.length > 0 ? Math.floor(currentTime / 4) % splitUrls.length : 0;
  const activeSplitUrl = splitUrls.length > 0 ? splitUrls[currentSplitIdx] : null;

  const isTopMediaVideo = activeSplitUrl && (
    activeSplitUrl.endsWith(".mp4") ||
    activeSplitUrl.endsWith(".mov") ||
    activeSplitUrl.endsWith(".webm") ||
    activeSplitUrl.endsWith(".mkv") ||
    activeSplitUrl.endsWith(".avi")
  );

  // Dynamic Zoom Scale — Alternates punch zoom on EVERY cut segment change!
  const enabledCuts = localCuts.filter((c) => c.enabled);
  const activeCutIdx = enabledCuts.findIndex((c) => currentTime >= c.start && currentTime <= c.end);
  const zoomIndex = activeCutIdx !== -1 ? activeCutIdx : activeSubIndex;
  // Sem zoom no 16:9 (YouTube) e no modo fundo desfocado — igual ao render final
  const isSegmentZoomed =
    style.zoom_enabled &&
    style.aspect_ratio !== "16:9" &&
    !useBlurBg &&
    zoomIndex !== -1 &&
    zoomIndex % 2 === 1;
  const currentZoomScale = isSegmentZoomed ? 1.18 : 1.0;

  // Subtitle Drag & Drop
  const handleSubMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSub(true);
    userTouchedStyle.current = true;
  };

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingSub || !videoContainerRef.current) return;
      const rect = videoContainerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      const clampedX = Math.max(5, Math.min(95, x));
      const clampedY = Math.max(5, Math.min(95, y));

      updateStyleAndPersist((s) => ({
        ...s,
        subtitle_position: "custom" as const,
        subtitle_x_percent: Math.round(clampedX * 10) / 10,
        subtitle_y_percent: Math.round(clampedY * 10) / 10,
      }));
    },
    [isDraggingSub, updateStyleAndPersist]
  );

  const handleMouseUp = () => {
    if (isDraggingSub) {
      setIsDraggingSub(false);
    }
  };

  // ── Scrub por arraste no preview: clique = play/pause, arraste horizontal = navegar
  const handleScrubDown = (e: React.PointerEvent) => {
    if (!videoRef.current) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture é só conveniência — segue sem */
    }
    scrubRef.current = {
      active: true,
      startX: e.clientX,
      startT: videoRef.current.currentTime,
      moved: false,
      wasPlaying: !videoRef.current.paused,
    };
  };

  const handleScrubMove = (e: React.PointerEvent) => {
    const s = scrubRef.current;
    if (!s.active || !videoRef.current || !videoContainerRef.current) return;
    const dx = e.clientX - s.startX;
    if (!s.moved && Math.abs(dx) < 5) return;
    const dur = videoRef.current.duration;
    if (!dur || !isFinite(dur)) return;
    if (!s.moved) {
      s.moved = true;
      videoRef.current.pause();
      setIsPlaying(false);
    }
    // Arrastar a largura toda do preview = percorrer o vídeo inteiro
    const width = videoContainerRef.current.getBoundingClientRect().width;
    const nt = Math.max(0, Math.min(dur, s.startT + (dx / width) * dur));
    videoRef.current.currentTime = nt;
    if (topVideoRef.current) topVideoRef.current.currentTime = nt;
    setCurrentTime(nt);
  };

  const handleScrubEnd = () => {
    const s = scrubRef.current;
    if (!s.active) return;
    s.active = false;
    if (!s.moved) {
      togglePlayPause();
    } else if (s.wasPlaying && videoRef.current) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // Recomeça o processamento quando ele trava (app/Docker fechado no meio, por
  // exemplo): a thread do backend morre e o job fica parado no status em que estava.
  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await retryJob(jobId);
      setTimeout(() => refetch(), 800);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Não foi possível recomeçar");
    }
    setIsRetrying(false);
  };

  const handleRender = async () => {
    setRenderError(null);
    setIsRendering(true);
    try {
      // Só envia a transcrição se o usuário tiver editado o texto. Enviar sempre
      // sobrescrevia no servidor a versão sincronizada com os cortes pela versão
      // que a tela tinha carregado — era isso que dessincronizava a legenda no export.
      if (transcriptDirtyRef.current && localTranscript.length > 0) {
        await updateTranscript(jobId, localTranscript);
      }
      await setStyleOptions(jobId, style);
      await startRender(jobId);
      setTimeout(() => refetch(), 1000);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "Erro ao renderizar");
    }
    setIsRendering(false);
  };

  // Deriva os cuts enviados ao backend: cada segmento-base é recortado pela janela de trim
  // [ts, te]; segmentos totalmente fora do trim ficam enabled=false (removidos), os das pontas
  // são aparados. Segmentos desligados manualmente (silêncios) continuam desligados.
  const computeEffectiveCuts = (base: CutSegment[], ts: number, te: number): CutSegment[] =>
    base.map((seg) => {
      const start = Math.max(seg.start, ts);
      const end = Math.min(seg.end, te);
      const overlaps = end - start > 0.05;
      return overlaps
        ? { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, enabled: seg.enabled }
        : { start: seg.start, end: seg.end, enabled: false };
    });

  // Durante a edição só SALVA os cortes (reprocess=false, sem FFmpeg). O preview já
  // mostra o resultado na hora pulando os trechos removidos; o vídeo limpo só é
  // re-renderizado uma única vez, quando o usuário clica em "Aprovar & ir para Estilo".
  const persistCuts = useCallback(
    (base: CutSegment[], ts: number, te: number) => {
      cutsDirtyRef.current = true;
      if (cutTimer.current) clearTimeout(cutTimer.current);
      cutTimer.current = setTimeout(async () => {
        try {
          await updateCuts(jobId, computeEffectiveCuts(base, ts, te), false);
        } catch (err) {
          console.error(err);
        }
      }, 700);
    },
    [jobId]
  );

  // Sair da aba Corte com edições pendentes = dispara o ÚNICO reprocessamento real.
  // Quando o backend termina, o useEffect acima recarrega a transcrição já
  // sincronizada com o vídeo cortado — a legenda entra certinha na aba Estilo.
  const leaveCorteTab = useCallback(
    (target: "estilo" | "visual") => {
      setActiveTab(target);
      if (!cutsDirtyRef.current) return;
      cutsDirtyRef.current = false;
      if (cutTimer.current) clearTimeout(cutTimer.current);
      sawBusyRef.current = false;
      setIsReprocessing(true);
      const te = trimEndRef.current || corteDurationRef.current;
      updateCuts(jobId, computeEffectiveCuts(localCutsRef.current, trimStartRef.current, te), true).catch((err) => {
        console.error(err);
        cutsDirtyRef.current = true;
        setIsReprocessing(false);
      });
    },
    [jobId]
  );

  const handleUpdateCutSegment = useCallback(
    (updatedBase: CutSegment[]) => {
      setLocalCuts(updatedBase);
      localCutsRef.current = updatedBase;
      persistCuts(updatedBase, trimStartRef.current, trimEndRef.current);
    },
    [persistCuts]
  );

  const handleToggleCut = useCallback(
    (index: number) => {
      const updated = localCuts.map((c, i) =>
        i === index ? { ...c, enabled: !c.enabled } : c
      );
      handleUpdateCutSegment(updated);
    },
    [localCuts, handleUpdateCutSegment]
  );

  // Define a janela de trim (in/out). persist=false enquanto arrasta; salva ao soltar.
  const commitTrim = useCallback(
    (a: number, b: number, opts: { persist?: boolean } = {}) => {
      const na = Math.round(a * 100) / 100;
      const nb = Math.round(b * 100) / 100;
      trimStartRef.current = na;
      trimEndRef.current = nb;
      setTrimStart(na);
      setTrimEnd(nb);
      if (opts.persist !== false) persistCuts(localCutsRef.current, na, nb);
    },
    [persistCuts]
  );

  const setTrimStartValue = useCallback(
    (v: number, opts?: { persist?: boolean }) => {
      const b = trimEndRef.current || corteDurationRef.current;
      const a = Math.max(0, Math.min(v, b - 0.2));
      commitTrim(a, b, opts);
    },
    [commitTrim]
  );
  const setTrimEndValue = useCallback(
    (v: number, opts?: { persist?: boolean }) => {
      const dur = corteDurationRef.current;
      const a = trimStartRef.current;
      const b = Math.min(dur, Math.max(v, a + 0.2));
      commitTrim(a, b, opts);
    },
    [commitTrim]
  );

  const setStartAtCurrentTime = () => setTrimStartValue(currentTime);
  const setEndAtCurrentTime = () => setTrimEndValue(currentTime);

  const handleAddManualCut = () => {
    const maxDur = job?.original_duration || job?.clean_duration || 1;
    if (localCuts.length === 0) {
      handleUpdateCutSegment([{ start: 0, end: maxDur, enabled: true }]);
      return;
    }
    const targetIdx = localCuts.findIndex((c) => currentTime >= c.start && currentTime <= c.end);
    if (targetIdx !== -1) {
      const seg = localCuts[targetIdx];
      if (currentTime > seg.start + 0.2 && currentTime < seg.end - 0.2) {
        const seg1: CutSegment = { start: seg.start, end: Math.round(currentTime * 100) / 100, enabled: true };
        const seg2: CutSegment = { start: Math.round(currentTime * 100) / 100, end: seg.end, enabled: true };
        const updated = [
          ...localCuts.slice(0, targetIdx),
          seg1,
          seg2,
          ...localCuts.slice(targetIdx + 1),
        ];
        handleUpdateCutSegment(updated);
      }
    }
  };

  // Remove uma faixa [a,b] do meio do vídeo: fatia os blocos que ela atravessa e
  // desliga só o pedaço marcado (vira bloco vermelho, clicável pra desfazer).
  const handleRemoveRange = useCallback(
    (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (hi - lo < 0.15) return; // arrasto muito curto = clique acidental
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const result: CutSegment[] = [];
      for (const seg of localCutsRef.current) {
        const s = Math.max(seg.start, lo);
        const e = Math.min(seg.end, hi);
        if (!seg.enabled || e - s <= 0.05) {
          result.push(seg);
          continue;
        }
        if (s - seg.start > 0.05) result.push({ start: seg.start, end: r2(s), enabled: true });
        result.push({ start: r2(s), end: r2(e), enabled: false });
        if (seg.end - e > 0.05) result.push({ start: r2(e), end: seg.end, enabled: true });
      }
      handleUpdateCutSegment(result);
    },
    [handleUpdateCutSegment]
  );

  const handleRemoveCutSegment = (index: number) => {
    if (localCuts.length <= 1) return;
    const updated = localCuts.filter((_, i) => i !== index);
    handleUpdateCutSegment(updated);
  };

  // Converte a posição X do mouse na trilha em tempo (na duração ORIGINAL)
  const timeFromClientX = useCallback((clientX: number) => {
    const el = timelineRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const pct = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, pct)) * corteDurationRef.current;
  }, []);

  // Arraste das alças de início/fim e do playhead
  useEffect(() => {
    if (!dragKind) return;
    // Pausa o preview ao começar a arrastar uma alça, pra o scrub ficar limpo
    if (dragKind === "start" || dragKind === "end") videoRef.current?.pause();
    const onMove = (e: PointerEvent) => {
      const t = timeFromClientX(e.clientX);
      if (dragKind === "start") {
        setTrimStartValue(t, { persist: false });
        handleSeek(Math.min(t, trimEndRef.current - 0.2));
      } else if (dragKind === "end") {
        setTrimEndValue(t, { persist: false });
        handleSeek(Math.max(t, trimStartRef.current + 0.2));
      } else if (dragKind === "remove") {
        removeSelRef.current = { a: removeAnchorRef.current, b: t };
        setRemoveSel(removeSelRef.current);
      } else {
        handleSeek(t);
      }
    };
    const onUp = () => {
      if (dragKind === "start" || dragKind === "end") {
        persistCuts(localCutsRef.current, trimStartRef.current, trimEndRef.current);
      } else if (dragKind === "remove") {
        const sel = removeSelRef.current;
        if (sel) handleRemoveRange(sel.a, sel.b);
        removeSelRef.current = null;
        setRemoveSel(null);
        setRemoveMode(false);
      }
      setDragKind(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // handleSeek é estável o suficiente (usa refs); evitamos re-subscrever a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKind, timeFromClientX, setTrimStartValue, setTrimEndValue, persistCuts, handleRemoveRange]);

  // CORTE INSTANTÂNEO NO PREVIEW: enquanto toca na aba Corte, pula na hora os
  // trechos removidos (vermelhos) e as pontas fora do trim — o usuário vê o vídeo
  // "já cortado" sem esperar nenhum processamento.
  useEffect(() => {
    if (!isPlaying || activeTab !== "corte") return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.seeking) {
        const t = v.currentTime;
        const ts = trimStartRef.current;
        const te = trimEndRef.current || corteDurationRef.current;
        const raw = localCutsRef.current
          .filter((c) => c.enabled)
          .map((c) => ({ s: Math.max(c.start, ts), e: Math.min(c.end, te) }))
          .filter((r) => r.e - r.s > 0.05);
        // Emenda só blocos praticamente colados (< 0.12s): seek ali não vale a pena.
        // Todos os outros vãos (respiros e trechos removidos) são pulados — o preview
        // toca igual ao vídeo final. O seek é rápido porque o normalized.mp4 tem
        // keyframe a cada 1s (ver upload.py).
        const ranges: { s: number; e: number }[] = [];
        for (const r of raw) {
          const last = ranges[ranges.length - 1];
          if (last && r.s - last.e < 0.12) last.e = r.e;
          else ranges.push({ ...r });
        }
        if (ranges.length) {
          const inside = ranges.some((r) => t >= r.s - 0.04 && t < r.e);
          if (!inside) {
            const next = ranges.find((r) => r.s > t);
            if (next) {
              v.currentTime = next.s + 0.01;
            } else {
              // passou do último trecho mantido: pausa e volta pro começo
              v.pause();
              v.currentTime = ranges[0].s;
              setIsPlaying(false);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeTab]);

  const handleGradeChange = useCallback(
    (key: keyof ColorGradeOptions, value: number) => {
      const updatedGrade = { ...style.color_grade, [key]: value };
      updateStyleAndPersist((s) => ({ ...s, color_grade: updatedGrade }));

      if (gradeTimer.current) clearTimeout(gradeTimer.current);
      gradeTimer.current = setTimeout(async () => {
        try {
          await updateColorGrade(jobId, updatedGrade);
        } catch (err) {
          console.error(err);
        }
      }, 600);
    },
    [jobId, style.color_grade, updateStyleAndPersist]
  );

  const handleTranscriptTextChange = (index: number, newText: string) => {
    const updated = [...localTranscript];
    const seg = updated[index];
    // Update text AND redistribute word timings so animated preview reflects edits
    const newWords = newText.split(/\s+/).filter(Boolean);
    const oldWords = seg.words || [];
    const segDuration = seg.end - seg.start;
    const wordDuration = newWords.length > 0 ? segDuration / newWords.length : segDuration;
    const redistributedWords = newWords.map((word, wi) => ({
      word,
      start: seg.start + wi * wordDuration,
      end: seg.start + (wi + 1) * wordDuration,
      confidence: oldWords[wi]?.confidence ?? 1.0,
    }));
    updated[index] = { ...seg, text: newText, words: redistributedWords };
    transcriptDirtyRef.current = true;
    setLocalTranscript(updated);

    // Auto-save transcript with debounce (1.5s)
    if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
    transcriptTimer.current = setTimeout(async () => {
      try {
        await updateTranscript(jobId, updated);
      } catch (err) {
        console.error("Auto-save transcript error:", err);
      }
    }, 1500);
  };

  const copyTranscriptText = () => {
    const fullText = localTranscript.map((t) => t.text).join(" ");
    navigator.clipboard.writeText(fullText);
    setCopiedTx(true);
    setTimeout(() => setCopiedTx(false), 2000);
  };

  const downloadTranscriptTxt = () => {
    const fullText = localTranscript
      .map((t) => `[${formatTime(t.start)} - ${formatTime(t.end)}] ${t.text}`)
      .join("\n");
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcricao_${jobId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSplitImagesUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      try {
        if (files.length === 1) {
          const res = await uploadSplitImage(jobId, files[0]);
          if (res?.path) {
            updateStyleAndPersist((s) => ({
              ...s,
              layout: "split_screen",
              split_screen_image: res.path,
              split_screen_images: [res.path],
            }));
          }
        } else {
          const res = await uploadSplitImages(jobId, files);
          if (res?.paths && res.paths.length > 0) {
            updateStyleAndPersist((s) => ({
              ...s,
              layout: "split_screen",
              split_screen_image: res.paths[0],
              split_screen_images: res.paths,
            }));
          }
        }
        refetch();
      } catch (err) {
        console.error(err);
      }
    },
    [jobId, refetch, updateStyleAndPersist]
  );

  const handleAutoBroll = async () => {
    setIsAutoBrolling(true);
    try {
      await triggerAutoBroll(jobId);
      updateStyleAndPersist((s) => ({ ...s, layout: "split_screen" }));
      refetch();
    } catch (err) {
      console.error(err);
    }
    setIsAutoBrolling(false);
  };

  const [brollSuggestions, setBrollSuggestions] = useState<import("@/lib/types").BRollSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const handleFetchSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const suggs = await fetchBRollSuggestions(jobId);
      setBrollSuggestions(suggs);
    } catch (err) {
      console.error(err);
    }
    setLoadingSuggestions(false);
  };

  const handleActionSuggestion = async (suggId: string, mediaUrl: string, action: "accept" | "reject") => {
    try {
      await actionBRollSuggestion(jobId, suggId, mediaUrl, action);
      setBrollSuggestions((prev) =>
        prev.map((s) => (s.id === suggId ? { ...s, accepted_url: action === "accept" ? mediaUrl : null, status: action === "accept" ? "accepted" : "rejected" } : s))
      );
      if (action === "accept") {
        updateStyleAndPersist((s) => ({
          ...s,
          layout: "split_screen",
          split_screen_image: mediaUrl,
          split_screen_images: [mediaUrl],
        }));
        refetch();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const applyPresetTheme = (theme: SubtitleTheme) => {
    const presets: Record<SubtitleTheme, Partial<StyleOptions>> = {
      andromeda: { subtitle_color: "#FFFFFF", subtitle_outline_color: "#000000", subtitle_bg_color: "#000000", subtitle_outline_enabled: false, subtitle_shadow_enabled: false },
      energy: { subtitle_color: "#000000", subtitle_outline_color: "#000000", subtitle_bg_color: "#FFFFFF", subtitle_outline_enabled: false, subtitle_shadow_enabled: false },
      million: { subtitle_color: "#FFFFFF", subtitle_outline_color: "#000000", subtitle_bg_color: "transparent", subtitle_outline_enabled: false, subtitle_shadow_enabled: true },
      minimal_white: { subtitle_color: "#FFFFFF", subtitle_outline_color: "#000000", subtitle_bg_color: "transparent", subtitle_outline_enabled: false, subtitle_shadow_enabled: false },
    };
    updateStyleAndPersist((s) => ({ ...s, subtitle_theme: theme, ...presets[theme] }));
  };

  // STRICT LINE WRAPPING — Groups words into lines based on maxChars, then window-selects
  // 1 or 2 lines containing the currently spoken word.
  const getDisplayLines = (sub: TranscriptSegment, maxChars: number, maxLines: number) => {
    const isUpper = ["andromeda", "million"].includes(style.subtitle_theme);
    const words = (sub.words && sub.words.length > 0 ? sub.words : []).map(w => ({
      ...w,
      word: isUpper ? w.word.toUpperCase() : w.word,
    }));

    if (words.length === 0) {
      const rawText = isUpper ? sub.text.toUpperCase() : sub.text;
      const rawWords = rawText.split(/\s+/).filter(Boolean);
      const lines: string[][] = [];
      let currentLine: string[] = [];
      let currentLen = 0;
      for (const w of rawWords) {
        if (currentLen + (currentLine.length > 0 ? 1 : 0) + w.length <= maxChars || currentLine.length === 0) {
          currentLine.push(w);
          currentLen += (currentLine.length > 1 ? 1 : 0) + w.length;
        } else {
          lines.push(currentLine);
          currentLine = [w];
          currentLen = w.length;
        }
      }
      if (currentLine.length > 0) lines.push(currentLine);
      return maxLines === 1 ? [lines[0] || []] : lines.slice(0, 2);
    }

    // Group words into lines of at most maxChars
    const linesOfWords: (typeof words)[] = [];
    let currentLine: typeof words = [];
    let currentLen = 0;

    for (const w of words) {
      const newLen = currentLen + (currentLine.length > 0 ? 1 : 0) + w.word.length;
      if (newLen <= maxChars || currentLine.length === 0) {
        currentLine.push(w);
        currentLen = newLen;
      } else {
        linesOfWords.push(currentLine);
        currentLine = [w];
        currentLen = w.word.length;
      }
    }
    if (currentLine.length > 0) linesOfWords.push(currentLine);

    // Find which line index contains the currently active word
    let activeLineIdx = 0;
    for (let lIdx = 0; lIdx < linesOfWords.length; lIdx++) {
      const lineWords = linesOfWords[lIdx];
      if (lineWords.some(w => subtitleTime >= w.start && subtitleTime <= w.end)) {
        activeLineIdx = lIdx;
        break;
      }
    }

    if (maxLines === 1) {
      // STRICT 1 LINE: Return ONLY the line corresponding to current active word
      return [linesOfWords[activeLineIdx] || linesOfWords[0] || []];
    } else {
      // STRICT 2 LINES: Return the pair of lines containing active word
      const startLineIdx = Math.floor(activeLineIdx / 2) * 2;
      return linesOfWords.slice(startLineIdx, startLineIdx + 2);
    }
  };

  // Render Subtitle Content in Preview — 100% strict 1 or 2 line display
  const renderPreviewSubContent = (sub: TranscriptSegment) => {
    const maxChars = style.subtitle_max_chars_per_line || 25;
    const maxLines = style.subtitle_max_lines || 1;
    const isAnimated = style.subtitle_animated && sub.words && sub.words.length > 0;
    const animStyle = style.subtitle_animation_style || "bounce_yellow";

    const activeColorClass =
      animStyle === "pop_flash"
        ? "text-[#10b981] scale-125 animate-pulse drop-shadow-[0_0_15px_rgba(16,185,129,1)] font-extrabold"
        : animStyle === "typewriter"
        ? "font-extrabold"
        : animStyle === "spotlight"
        ? "text-white scale-110 drop-shadow-[0_0_14px_rgba(255,255,255,0.95)] font-black"
        : "text-yellow-300 drop-shadow-[0_2px_10px_rgba(250,204,21,0.9)] scale-110 font-black";

    const displayLines = getDisplayLines(sub, maxChars, maxLines);
    const spacingPx = style.subtitle_letter_spacing || 0;

    return displayLines.map((lineWords, lineIdx) => {
      const lineText = typeof lineWords[0] === "string"
        ? (lineWords as string[]).join(" ")
        : (lineWords as { word: string }[]).map(w => w.word).join(" ");

      if (!isAnimated) {
        return (
          <span key={`line-${lineIdx}`} className="block leading-snug">
            {lineText}
          </span>
        );
      }

      return (
        <span key={`line-${lineIdx}`} className="block leading-snug">
          {(lineWords as { word: string; start: number; end: number }[]).map((wObj, wIdx) => {
            const isWordActive = subtitleTime >= wObj.start && subtitleTime <= wObj.end;
            const isFuture = subtitleTime < wObj.start;
            // Estados por estilo: máquina de escrever esconde o futuro; foco deixa apagado
            const inactiveClass =
              animStyle === "typewriter"
                ? isFuture
                  ? "opacity-0"
                  : "opacity-100"
                : animStyle === "spotlight"
                ? isFuture
                  ? "opacity-30"
                  : "opacity-90"
                : "opacity-80";
            return (
              <span
                key={wIdx}
                className={`inline-block transition-all duration-150 ${
                  isWordActive ? activeColorClass : inactiveClass
                }`}
                style={{
                  marginRight: `calc(0.3em + ${spacingPx * 0.4}px)`
                }}
              >
                {wObj.word}
              </span>
            );
          })}
        </span>
      );
    });
  };

  if (error) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="glass-card max-w-md p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-white font-jakarta">Erro</h2>
          <p className="mt-2 text-sm text-slate-400 font-geist">{error}</p>
          <a href="/" className="btn-primary btn-pill mt-6 inline-flex">Voltar ao início</a>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto h-10 w-10 animate-spin text-emerald-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-4 text-sm text-[#a8a8a8]">Carregando Editor...</p>
        </div>
      </main>
    );
  }

  const isCleanReady = job.status === "clean_ready" || job.status === "done";
  const totalDuration = job.clean_duration || job.original_duration || 1;
  // Na aba de corte trabalhamos no tempo ORIGINAL (trim mapeia 1:1 com o material bruto).
  const corteDuration = job.original_duration || totalDuration;
  corteDurationRef.current = corteDuration;
  const dispTrimStart = trimStart;
  const dispTrimEnd = trimEnd || corteDuration;
  const cleanVideoUrl = job.clean_video_url
    ? job.clean_video_url + (cleanVersion > 0 ? `?v=${cleanVersion}` : "")
    : "";
  const currentVideoPath =
    (activeTab === "corte" ? job.original_video_url : "") ||
    cleanVideoUrl ||
    job.final_video_url ||
    "";

  const cg = style.color_grade || DEFAULT_STYLE_OPTIONS.color_grade;
  const cssGradeFilter = `contrast(${Math.round((cg.contrast ?? 1.0) * 100)}%) saturate(${Math.round((cg.saturation ?? 1.0) * 100)}%) brightness(${Math.round((cg.brightness ?? 1.0) * 100)}%) sepia(${Math.max(0, Math.round((cg.warmth ?? 0) * 50))}%)`;
  const framingYPercent = style.split_screen_framing_y ?? 50.0;
  const framingYBottomPercent = style.split_screen_framing_y_bottom ?? 50.0;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#fafafa] font-sans" onMouseUp={handleMouseUp}>
      {/* ═══════════ HEADER COM FASES E STATUS ═══════════ */}
      <header className="sticky top-0 z-40 border-b border-[#242424] bg-[#0a0a0a]/90 backdrop-blur-md px-6 py-3.5">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-sm font-bold text-white font-sans truncate max-w-[320px]">
                {job.original_filename || "Vídeo sem nome"}
              </h1>
              <p className="text-[11px] text-emerald-400 font-medium">
                {job.status === "done"
                  ? "✨ Vídeo finalizado pronto para baixar!"
                  : job.status === "error"
                  ? "❌ Ocorreu um erro no processamento"
                  : isCleanReady
                  ? `Fase 1 — Corte orgânico pronto (${formatDuration(totalDuration)}). Aprova?`
                  : `${STATUS_LABEL[job.status] || job.status}${job.progress ? ` — ${job.progress}%` : ""}...`}
              </p>
            </div>
          </div>

          {/* PROCESS STEPPER TABS */}
          <div className="flex items-center rounded-full bg-[#141414] p-1 border border-[#242424]">
            <button
              onClick={() => setActiveTab("corte")}
              className={`flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "corte"
                  ? "bg-brand-gradient text-[#0a0a0a] shadow-lg shadow-emerald-500/20 scale-[1.02]"
                  : "text-[#a8a8a8] hover:text-white hover:bg-white/5"
              }`}
            >
              <span>✂️</span> FASE 1 Corte
            </button>
            <button
              onClick={() => leaveCorteTab("estilo")}
              className={`flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "estilo"
                  ? "bg-brand-gradient text-[#0a0a0a] shadow-lg shadow-emerald-500/20 scale-[1.02]"
                  : "text-[#a8a8a8] hover:text-white hover:bg-white/5"
              }`}
            >
              <span>🎨</span> Estilo
            </button>
            <button
              onClick={() => leaveCorteTab("visual")}
              className={`flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "visual"
                  ? "bg-brand-gradient text-[#0a0a0a] shadow-lg shadow-emerald-500/20 scale-[1.02]"
                  : "text-[#a8a8a8] hover:text-white hover:bg-white/5"
              }`}
            >
              <span>🎬</span> FASE 2 Visual / Exportar
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════ MAIN CONTENT GRID (CONTROLES ESQUERDA | PREVIEW FIXO DIREITA) ═══════════ */}
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        {job.status === "error" && (
          <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 font-geist">
            <div className="font-bold mb-1">❌ Falha no processamento</div>
            <p className="text-rose-300/90">{job.error_message || "Algo deu errado ao processar o vídeo."}</p>
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="mt-3 rounded-lg border border-rose-400/50 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-50"
            >
              {isRetrying ? "Recomeçando…" : "🔄 Tentar de novo"}
            </button>
          </div>
        )}
        {!isCleanReady && job.status !== "error" && (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <div className="mb-2 flex items-center gap-2 font-bold">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
              {STATUS_LABEL[job.status] || "Processando"} — {job.progress || 0}%
            </div>
            <div className="h-2 w-full max-w-xl overflow-hidden rounded-full bg-black/40 border border-[#242424]">
              <div className="h-full bg-brand-gradient transition-all duration-300" style={{ width: `${job.progress || 0}%` }} />
            </div>
            <p className="mt-2 text-xs text-emerald-200/80">
              O vídeo editado aparecerá automaticamente assim que a inteligência concluir o corte.
            </p>
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="mt-2 text-[11px] font-medium text-emerald-300/80 underline underline-offset-2 transition hover:text-emerald-200 disabled:opacity-50"
            >
              {isRetrying ? "Recomeçando…" : "Parou de avançar? Recomeçar o processamento"}
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start w-full min-w-0">
          {/* ═══════════ LEFT COLUMN (PAINEL DA FASE ATIVA) ═══════════ */}
          <div className="space-y-6 min-w-0 w-full">
            {/* ✂️ FASE 1 — CORTE TAB */}
            {activeTab === "corte" && (
              <div className="space-y-4 animate-in">
                {/* Barra de controle */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#242424] bg-[#141414] p-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlayPause}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-black transition hover:bg-emerald-400"
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                    <div className="font-mono text-xs font-semibold text-[#ededed] bg-[#0a0a0a] px-3 py-1.5 rounded-lg border border-[#242424]">
                      {formatTime(currentTime)} <span className="text-[#5c5c5c]">/ {formatTime(corteDuration)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[#6b6b6b]">Zoom</span>
                    <input
                      type="range"
                      min="100"
                      max="300"
                      value={zoomLevel}
                      onChange={(e) => setZoomLevel(parseInt(e.target.value))}
                      className="w-24 accent-emerald-500 cursor-pointer"
                    />
                    <button
                      onClick={() => setZoomLevel(100)}
                      className="rounded-lg border border-[#242424] px-2.5 py-1 text-[11px] font-medium text-[#9a9a9a] transition hover:border-[#333] hover:text-white"
                    >
                      Ajustar
                    </button>
                  </div>
                </div>

                {/* Ajuste fino de início e fim */}
                <div className="rounded-2xl border border-[#242424] bg-[#141414] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-[#ededed]">Início &amp; fim do vídeo</h3>
                    {isReprocessing ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Aplicando corte…
                      </span>
                    ) : (
                      <span className="hidden sm:block text-[11px] text-[#6b6b6b]">
                        Arraste as alças na linha do tempo ou ajuste aqui
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Início */}
                    <div className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-[#8f8f8f]">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Começa em
                      </div>
                      <div className="flex items-baseline gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={Math.max(0, dispTrimEnd - 0.2)}
                          value={Number(dispTrimStart.toFixed(2))}
                          onChange={(e) => setTrimStartValue(parseFloat(e.target.value) || 0)}
                          className="w-20 bg-transparent font-mono text-xl font-semibold text-white focus:outline-none"
                        />
                        <span className="text-xs text-[#6b6b6b]">s</span>
                        <span className="ml-auto font-mono text-xs text-[#6b6b6b]">{formatTime(dispTrimStart)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          onClick={() => setTrimStartValue(dispTrimStart - 0.5)}
                          className="rounded-md border border-[#242424] px-2 py-1 text-[11px] font-medium text-[#9a9a9a] transition hover:border-[#333] hover:text-white"
                        >
                          −0,5s
                        </button>
                        <button
                          onClick={() => setTrimStartValue(dispTrimStart + 0.5)}
                          className="rounded-md border border-[#242424] px-2 py-1 text-[11px] font-medium text-[#9a9a9a] transition hover:border-[#333] hover:text-white"
                        >
                          +0,5s
                        </button>
                        <button
                          onClick={setStartAtCurrentTime}
                          title="Usar o tempo atual do player"
                          className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-500/10"
                        >
                          no player
                        </button>
                      </div>
                    </div>

                    {/* Fim */}
                    <div className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-[#8f8f8f]">
                        <span className="h-2 w-2 rounded-full bg-rose-400" /> Termina em
                      </div>
                      <div className="flex items-baseline gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min={Number((dispTrimStart + 0.2).toFixed(2))}
                          max={corteDuration}
                          value={Number(dispTrimEnd.toFixed(2))}
                          onChange={(e) => setTrimEndValue(parseFloat(e.target.value) || 0)}
                          className="w-20 bg-transparent font-mono text-xl font-semibold text-white focus:outline-none"
                        />
                        <span className="text-xs text-[#6b6b6b]">s</span>
                        <span className="ml-auto font-mono text-xs text-[#6b6b6b]">{formatTime(dispTrimEnd)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          onClick={() => setTrimEndValue(dispTrimEnd - 0.5)}
                          className="rounded-md border border-[#242424] px-2 py-1 text-[11px] font-medium text-[#9a9a9a] transition hover:border-[#333] hover:text-white"
                        >
                          −0,5s
                        </button>
                        <button
                          onClick={() => setTrimEndValue(dispTrimEnd + 0.5)}
                          className="rounded-md border border-[#242424] px-2 py-1 text-[11px] font-medium text-[#9a9a9a] transition hover:border-[#333] hover:text-white"
                        >
                          +0,5s
                        </button>
                        <button
                          onClick={setEndAtCurrentTime}
                          title="Usar o tempo atual do player"
                          className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-500/10"
                        >
                          no player
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Linha do tempo interativa */}
                <div className="rounded-2xl border border-[#242424] bg-[#141414] p-5 overflow-hidden min-w-0 w-full">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-[#ededed]">Linha do tempo</span>
                      <span className="font-mono text-[11px] text-[#6b6b6b]">
                        {formatDuration(Math.max(0, dispTrimEnd - dispTrimStart))} / {formatDuration(corteDuration)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleAddManualCut}
                        className="rounded-lg border border-[#242424] px-2.5 py-1 text-[11px] font-medium text-[#9a9a9a] transition hover:border-emerald-500/40 hover:text-emerald-300"
                      >
                        ✂ Dividir aqui
                      </button>
                      <button
                        onClick={() => {
                          setRemoveMode((m) => !m);
                          setRemoveSel(null);
                          removeSelRef.current = null;
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                          removeMode
                            ? "border-rose-400 bg-rose-500/15 text-rose-300"
                            : "border-[#242424] text-[#9a9a9a] hover:border-rose-500/40 hover:text-rose-300"
                        }`}
                      >
                        🗑 Remover trecho
                      </button>
                    </div>
                  </div>

                  {removeMode && (
                    <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                      <b className="font-semibold">Modo remover:</b> arraste na linha do tempo por cima da parte errada. Ao soltar, ela sai do vídeo. Clique num bloco vermelho pra desfazer.
                    </div>
                  )}

                  <div className="relative w-full overflow-x-auto select-none pt-5 pb-1 min-w-0">
                    <div
                      ref={timelineRef}
                      className="relative"
                      style={{ width: `${Math.max(100, zoomLevel)}%`, minWidth: "560px" }}
                    >
                      {/* Régua */}
                      <div className="relative h-5 w-full mb-1.5">
                        {Array.from({ length: 9 }).map((_, i) => {
                          const p = (i / 8) * 100;
                          return (
                            <span
                              key={i}
                              className="absolute top-0 -translate-x-1/2 text-[10px] font-mono text-[#5c5c5c]"
                              style={{ left: `${p}%` }}
                            >
                              {formatTime((corteDuration / 8) * i)}
                            </span>
                          );
                        })}
                      </div>

                      {/* Track interativa */}
                      <div
                        onPointerDown={(e) => {
                          if (removeMode) {
                            const t = timeFromClientX(e.clientX);
                            removeAnchorRef.current = t;
                            removeSelRef.current = { a: t, b: t };
                            setRemoveSel(removeSelRef.current);
                            videoRef.current?.pause();
                            setDragKind("remove");
                            return;
                          }
                          handleSeek(timeFromClientX(e.clientX));
                          setDragKind("playhead");
                        }}
                        className={`relative h-20 w-full rounded-lg bg-[#0a0a0a] border overflow-hidden ${
                          removeMode ? "border-rose-500/40 cursor-crosshair" : "border-[#1f1f1f] cursor-pointer"
                        }`}
                      >
                        {/* Waveform sutil */}
                        <div className="absolute inset-0 flex items-center justify-between gap-[2px] px-1 opacity-[0.18] pointer-events-none">
                          {Array.from({ length: 160 }).map((_, i) => {
                            const h = Math.floor(Math.abs(Math.sin(i * 0.4) * 30 + Math.cos(i * 0.7) * 9 + 5));
                            return (
                              <div
                                key={`wave-${i}`}
                                className="w-[2px] rounded-full bg-emerald-300"
                                style={{ height: `${h}px` }}
                              />
                            );
                          })}
                        </div>

                        {/* Blocos de corte inteligente (posição absoluta = tempo original) */}
                        {localCuts.map((cut, i) => {
                          const left = (cut.start / corteDuration) * 100;
                          const width = Math.max(((cut.end - cut.start) / corteDuration) * 100, 0.6);
                          return (
                            <div
                              key={`cut-${i}`}
                              onPointerDown={(e) => {
                                // No modo remover, deixa o arraste passar pra track marcar a faixa
                                if (!removeMode) e.stopPropagation();
                              }}
                              onClick={(e) => {
                                if (removeMode) return;
                                e.stopPropagation();
                                handleSeek(cut.start);
                                handleToggleCut(i);
                              }}
                              title={cut.enabled ? "Clique para remover este trecho" : "Clique para manter este trecho"}
                              className={`absolute top-1.5 bottom-1.5 rounded-md border transition-colors cursor-pointer overflow-hidden ${
                                cut.enabled
                                  ? "border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20"
                                  : "border-rose-500/30 bg-rose-500/10 opacity-50 hover:opacity-75"
                              }`}
                              style={{ left: `${left}%`, width: `${width}%` }}
                            >
                              {!cut.enabled && (
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-rose-300/80">
                                  ✕
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {/* Máscara das pontas cortadas */}
                        <div
                          className="absolute inset-y-0 left-0 bg-black/70 pointer-events-none"
                          style={{ width: `${(dispTrimStart / corteDuration) * 100}%` }}
                        />
                        <div
                          className="absolute inset-y-0 right-0 bg-black/70 pointer-events-none"
                          style={{ width: `${Math.max(0, (1 - dispTrimEnd / corteDuration) * 100)}%` }}
                        />

                        {/* Alça de INÍCIO */}
                        <div
                          onPointerDown={(e) => {
                            if (removeMode) return;
                            e.stopPropagation();
                            setDragKind("start");
                          }}
                          className={`group absolute inset-y-0 z-40 w-5 -ml-2.5 cursor-ew-resize ${removeMode ? "pointer-events-none" : ""}`}
                          style={{ left: `${(dispTrimStart / corteDuration) * 100}%` }}
                        >
                          <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-emerald-400" />
                          <div className="absolute top-1/2 left-1/2 h-9 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 shadow-md transition group-hover:h-11" />
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-mono font-bold text-black opacity-0 transition group-hover:opacity-100 whitespace-nowrap">
                            {formatTime(dispTrimStart)}
                          </span>
                        </div>

                        {/* Alça de FIM */}
                        <div
                          onPointerDown={(e) => {
                            if (removeMode) return;
                            e.stopPropagation();
                            setDragKind("end");
                          }}
                          className={`group absolute inset-y-0 z-40 w-5 -ml-2.5 cursor-ew-resize ${removeMode ? "pointer-events-none" : ""}`}
                          style={{ left: `${(dispTrimEnd / corteDuration) * 100}%` }}
                        >
                          <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-emerald-400" />
                          <div className="absolute top-1/2 left-1/2 h-9 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 shadow-md transition group-hover:h-11" />
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-mono font-bold text-black opacity-0 transition group-hover:opacity-100 whitespace-nowrap">
                            {formatTime(dispTrimEnd)}
                          </span>
                        </div>

                        {/* Seleção do modo remover (faixa vermelha enquanto arrasta) */}
                        {removeSel && (
                          <div
                            className="absolute inset-y-0 z-30 border-x-2 border-rose-400 bg-rose-500/30 pointer-events-none"
                            style={{
                              left: `${(Math.min(removeSel.a, removeSel.b) / corteDuration) * 100}%`,
                              width: `${(Math.abs(removeSel.b - removeSel.a) / corteDuration) * 100}%`,
                            }}
                          />
                        )}

                        {/* Playhead */}
                        <div
                          className="absolute inset-y-0 z-30 w-px bg-white/90 pointer-events-none"
                          style={{ left: `${(currentTime / corteDuration) * 100}%` }}
                        >
                          <div className="h-0 w-0 border-x-[4px] border-x-transparent border-t-[6px] border-t-white -ml-[3.5px]" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Rodapé */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] text-[#6b6b6b]">
                      Arraste as <b className="font-semibold text-emerald-400">alças</b> pra definir início e fim · <b className="font-semibold text-rose-300">🗑 Remover trecho</b> pra tirar um erro do meio · o preview já toca cortado · a legenda entra na aba Estilo
                    </span>
                    <button onClick={() => leaveCorteTab("estilo")} className="btn-primary btn-pill text-xs font-bold">
                      Aprovar &amp; ir para Estilo →
                    </button>
                  </div>
                </div>

                {/* Transcrição */}
                {isCleanReady && (
                  <div className="glass-panel p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#a8a8a8]">📝 Transcrição Inteligente</p>
                        <p className="mt-0.5 text-[10px] text-[#737373]">Edite o texto das frases para ajustar o vídeo</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={copyTranscriptText} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
                          {copiedTx ? "✓ Copiado!" : "📋 Copiar Texto"}
                        </button>
                        <button onClick={downloadTranscriptTxt} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
                          ⬇️ Baixar TXT
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {localTranscript.map((seg, i) => (
                        <div key={i} className="rounded-xl border border-[#242424] bg-[#0a0a0a]/60 p-3 hover:border-emerald-500/30">
                          <div className="mb-1 flex items-center justify-between text-[10px] text-[#737373]">
                            <span onClick={() => handleSeek(seg.start)} className="cursor-pointer text-emerald-400 hover:underline">
                              {formatTime(seg.start)} → {formatTime(seg.end)}
                            </span>
                            <span className="text-emerald-400 font-bold">#{i + 1}</span>
                          </div>
                          <input
                            type="text"
                            value={seg.text}
                            onChange={(e) => handleTranscriptTextChange(i, e.target.value)}
                            className="w-full rounded-lg border border-[#242424] bg-[#141414] px-3 py-1.5 text-sm text-[#fafafa] focus:border-emerald-400 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 🎨 FASE 2 — ESTILO TAB */}
            {activeTab === "estilo" && (
              <div className="space-y-8 animate-in">
                <div className="border-b border-white/10 pb-4">
                  <h2 className="text-xl font-black text-white font-jakarta">Como vamos montar a Fase 2?</h2>
                  <p className="text-xs text-slate-400 font-geist">Personalize o formato visual, cores, headlines, legendas e elementos de animação.</p>
                </div>

                {/* 1. TIPO DE EDIÇÃO */}
                <div className="space-y-3">
                  <label className="text-[13px] font-semibold text-[#ededed]">Tipo de edição</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { id: "fullscreen", title: "Limpinho", desc: "Vídeo único 1080x1920 tela cheia", icon: "📱" },
                      { id: "split_screen", title: "Tela dividida", desc: "Split 50/50 vídeo topo + vídeo base", icon: "🖼️" },
                      { id: "multi_split", title: "Tela dividida 2", desc: "Carrossel de múltiplos B-Rolls no topo", icon: "🎬" },
                    ].map((t) => (
                      <div
                        key={t.id}
                        onClick={() => {
                          if (t.id === "fullscreen") updateStyleAndPersist((s) => ({ ...s, layout: "fullscreen" }));
                          else splitInputRef.current?.click();
                        }}
                        className={`group relative cursor-pointer rounded-2xl border p-5 transition-all ${
                          (style.layout === "fullscreen" && t.id === "fullscreen") || (style.layout === "split_screen" && t.id !== "fullscreen")
                            ? "border-emerald-400 bg-emerald-500/10"
                            : "border-[#242424] bg-[#141414] hover:border-[#404040]"
                        }`}
                      >
                        <div className="mb-3 text-3xl">{t.icon}</div>
                        <div className="text-base font-bold text-white">{t.title}</div>
                        <div className="mt-1 text-xs text-[#a8a8a8]">{t.desc}</div>
                        {((style.layout === "fullscreen" && t.id === "fullscreen") || (style.layout === "split_screen" && t.id !== "fullscreen")) && (
                          <span className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-[#0a0a0a] text-xs font-bold">
                            ✓
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <input ref={splitInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleSplitImagesUpload} />

                  {style.layout === "split_screen" && (
                    <div className="mt-3 rounded-2xl border border-[#242424] bg-[#141414] p-4 space-y-4">
                      {/* Sliders para enquadramento Y superior e inferior */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="flex justify-between items-center mb-1 text-xs text-[#a8a8a8]">
                            <span>↕️ Enquadramento Mídia Topo (Y):</span>
                            <span className="font-mono text-emerald-400 font-bold">{Math.round(framingYPercent)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={framingYPercent}
                            onChange={(e) => updateStyleAndPersist((s) => ({ ...s, split_screen_framing_y: parseFloat(e.target.value) }))}
                            className="w-full accent-emerald-400 cursor-pointer"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1 text-xs text-[#a8a8a8]">
                            <span>↕️ Enquadramento Mídia Base (Y):</span>
                            <span className="font-mono text-emerald-400 font-bold">{Math.round(framingYBottomPercent)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={framingYBottomPercent}
                            onChange={(e) => updateStyleAndPersist((s) => ({ ...s, split_screen_framing_y_bottom: parseFloat(e.target.value) }))}
                            className="w-full accent-emerald-400 cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Painel Interativo de Sugestões de B-Roll da IA */}
                      <div className="pt-3 border-t border-[#242424] space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-semibold text-[#ededed]">🎬 Sugestões de B-Roll IA</span>
                            <p className="text-[10px] text-slate-400 font-geist">Escolha mídias temáticas para os momentos chave do vídeo</p>
                          </div>
                          <button
                            onClick={handleFetchSuggestions}
                            disabled={loadingSuggestions}
                            className="whitespace-nowrap rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                          >
                            {loadingSuggestions ? "🔄 Analisando…" : "🤖 Sugerir B-Rolls IA"}
                          </button>
                        </div>

                        {brollSuggestions.length > 0 && (
                          <div className="space-y-3 pt-2">
                            {brollSuggestions.map((sugg) => (
                              <div key={sugg.id} className="rounded-xl border border-[#242424] bg-[#0a0a0a] p-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-mono font-bold text-emerald-400">⏱️ {formatTime(sugg.start)} - {formatTime(sugg.end)}</span>
                                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-md font-bold">{sugg.keyword}</span>
                                </div>
                                <p className="text-xs text-slate-300 italic bg-[#141414] p-2 rounded-lg border border-[#242424]">"{sugg.context_text}"</p>

                                {/* Opções de Mídias */}
                                <div className="grid grid-cols-3 gap-2 pt-1">
                                  {sugg.options.map((opt, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => handleActionSuggestion(sugg.id, opt.url, "accept")}
                                      className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-all ${
                                        sugg.accepted_url === opt.url ? "border-emerald-400 ring-2 ring-emerald-500/40" : "border-[#242424] hover:border-emerald-500/50"
                                      }`}
                                    >
                                      <img src={opt.thumbnail} alt={opt.title} className="h-16 w-full object-cover group-hover:scale-105 transition-transform" />
                                      <div className="absolute inset-x-0 bottom-0 bg-black/80 p-1 text-[9px] font-bold text-white truncate text-center">
                                        {opt.title}
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div className="flex justify-end gap-2 pt-1">
                                  <button
                                    onClick={() => handleActionSuggestion(sugg.id, "", "reject")}
                                    className="px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg"
                                  >
                                    ❌ Ignorar
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. COR DE DESTAQUE */}
                <div className="space-y-3">
                  <label className="text-[13px] font-semibold text-[#ededed]">Cor de destaque</label>
                  <div className="flex items-center gap-4 rounded-2xl border border-[#242424] bg-[#141414] p-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={highlightColor}
                        onChange={(e) => {
                          setHighlightColor(e.target.value);
                          updateStyleAndPersist((s) => ({ ...s, subtitle_color: e.target.value }));
                        }}
                        className="h-10 w-10 cursor-pointer rounded-xl border border-[#242424] bg-transparent p-0.5"
                      />
                      <div>
                        <span className="block text-[11px] font-medium text-[#a8a8a8]">Seletor Geral de Cor:</span>
                        <span className="font-mono text-sm font-bold text-emerald-400 uppercase">{highlightColor}</span>
                      </div>
                    </div>
                  </div>
                </div>



                {/* 3. ALINHAMENTO DA LEGENDA & ROTAÇÃO DO VÍDEO */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Alinhamento da legenda */}
                  <div className="space-y-3">
                    <label className="text-[13px] font-semibold text-[#ededed]">Alinhamento da legenda</label>
                    <div className="rounded-2xl border border-[#242424] bg-[#141414] p-4 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_position: "custom", subtitle_x_percent: 50 }))}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ${
                            Math.round(style.subtitle_x_percent) === 50
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-[#242424] bg-[#0d0d0d] text-[#a8a8a8] hover:text-white"
                          }`}
                        >
                          ↔ Centralizar horizontal
                        </button>
                        <button
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_position: "custom", subtitle_y_percent: 50 }))}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ${
                            Math.round(style.subtitle_y_percent) === 50
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-[#242424] bg-[#0d0d0d] text-[#a8a8a8] hover:text-white"
                          }`}
                        >
                          ↕ Centralizar vertical
                        </button>
                        <button
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_position: "custom", subtitle_x_percent: 50, subtitle_y_percent: 50 }))}
                          className="rounded-lg border border-[#242424] bg-[#0d0d0d] px-3 py-1.5 text-[11px] font-semibold text-[#a8a8a8] transition hover:border-emerald-500/40 hover:text-emerald-300"
                        >
                          ◎ Meio exato
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="mr-1 text-[11px] text-[#6b6b6b]">Vertical:</span>
                        {[
                          { label: "Topo", y: 12 },
                          { label: "Meio", y: 50 },
                          { label: "Base", y: 85 },
                        ].map((p) => (
                          <button
                            key={p.label}
                            onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_position: "custom", subtitle_y_percent: p.y }))}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                              Math.round(style.subtitle_y_percent) === p.y
                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                : "border-[#242424] bg-[#0d0d0d] text-[#a8a8a8] hover:text-white"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-[#6b6b6b]">
                        Posição atual: {Math.round(style.subtitle_x_percent)}% × {Math.round(style.subtitle_y_percent)}% — você também pode arrastar a legenda direto no preview.
                      </p>
                    </div>
                  </div>

                  {/* Girar vídeo */}
                  <div className="space-y-3">
                    <label className="text-[13px] font-semibold text-[#ededed]">Girar vídeo</label>
                    <div className="rounded-2xl border border-[#242424] bg-[#141414] p-4 space-y-3">
                      <div className="grid grid-cols-4 gap-2">
                        {[0, 90, 180, 270].map((deg) => (
                          <button
                            key={deg}
                            onClick={() => updateStyleAndPersist((s) => ({ ...s, rotation: deg }))}
                            className={`rounded-xl border py-2 text-xs font-bold transition ${
                              (style.rotation || 0) === deg
                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                : "border-[#242424] bg-[#0d0d0d] text-[#a8a8a8] hover:text-white"
                            }`}
                          >
                            {deg === 0 ? "Normal" : `${deg}°`}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-[#6b6b6b]">
                        Gira o vídeo no preview e no arquivo final — útil pra vídeo gravado deitado ou de cabeça pra baixo.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 4. ESTILO DE LEGENDA */}
                <div className="space-y-3">
                  <label className="text-[13px] font-semibold text-[#ededed]">Estilo de legenda</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { key: "andromeda" as SubtitleTheme, label: "⬛ Andromeda", bg: "bg-black text-white" },
                      { key: "energy" as SubtitleTheme, label: "⬜ Energy", bg: "bg-white text-black font-bold" },
                      { key: "million" as SubtitleTheme, label: "💎 Million", bg: "bg-black/60 text-yellow-300 drop-shadow-md" },
                      { key: "minimal_white" as SubtitleTheme, label: "⚪ Limpo Minimal", bg: "bg-black/40 text-white" },
                    ].map((p) => (
                      <div
                        key={p.key}
                        onClick={() => applyPresetTheme(p.key)}
                        className={`cursor-pointer rounded-2xl border p-4 transition-all text-center ${
                          style.subtitle_theme === p.key
                            ? "border-emerald-400 bg-emerald-500/10"
                            : "border-[#242424] bg-[#141414] hover:border-[#404040]"
                        }`}
                      >
                        <div className={`mx-auto rounded-xl p-3 text-xs font-bold ${p.bg}`}>
                          É assim que sua legenda irá aparecer
                        </div>
                        <div className="mt-3 text-xs font-bold text-[#fafafa]">{p.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. ELEMENTOS DA EDIÇÃO */}
                <div className="space-y-3">
                  <label className="text-[13px] font-semibold text-[#ededed]">Elementos da edição</label>
                  <div className="flex flex-wrap items-center gap-3">
                    {[
                      {
                        key: "zoom_enabled",
                        label: "🔍 Automação de zoom in",
                        active: style.zoom_enabled,
                        toggle: () => updateStyleAndPersist((s) => ({ ...s, zoom_enabled: !s.zoom_enabled })),
                      },
                      {
                        key: "subtitle_animated",
                        label: "🌟 Legenda Animada (Karaoke)",
                        active: style.subtitle_animated,
                        toggle: () => updateStyleAndPersist((s) => ({ ...s, subtitle_animated: !s.subtitle_animated })),
                      },
                      {
                        key: "color_grade_active",
                        label: "🎨 Color Grade Inteligente",
                        active: true,
                        toggle: () => {},
                      },
                      {
                        key: "auto_broll",
                        label: "🤖 Trilha sonora & B-Roll IA",
                        active: style.auto_broll_enabled,
                        toggle: () => updateStyleAndPersist((s) => ({ ...s, auto_broll_enabled: !s.auto_broll_enabled })),
                      },
                    ].map((item) => (
                      <button
                        key={item.key}
                        onClick={item.toggle}
                        className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition-all ${
                          item.active
                            ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                            : "border-[#242424] bg-[#141414] text-[#a8a8a8] hover:text-white"
                        }`}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${item.active ? "bg-emerald-400 text-[#0a0a0a]" : "bg-white/10 text-slate-500"}`}>
                          ✓
                        </span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 6. CONTROLES RIGOROSOS DE TEXTO E ANIMAÇÃO */}
                <div className="rounded-2xl border border-[#242424] bg-[#141414] p-6 space-y-5">
                  <label className="text-[13px] font-semibold text-[#ededed]">Legenda & tipografia</label>
                  
                  {/* Fonte Tipográfica Limpa */}
                  <div>
                    <span className="block text-xs font-medium text-[#a8a8a8] mb-1.5">Fonte da Legenda (Modelos Limpos):</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { name: "TikTok Medium", label: "🎵 TikTok Medium" },
                        { name: "Helvetica", label: "🏢 Helvetica" },
                        { name: "Montserrat", label: "✨ Montserrat" },
                        { name: "Lato", label: "🍃 Lato" },
                      ].map((f) => (
                        <button
                          key={f.name}
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_font: f.name as any }))}
                          className={`rounded-xl border py-2.5 px-3 text-xs font-bold transition ${
                            style.subtitle_font === f.name
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-[#242424] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Animações de Legenda */}
                  <div>
                    <span className="block text-xs font-medium text-[#a8a8a8] mb-1.5">Efeito de Animação ao Falar:</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: "pop_flash", label: "⚡ Pop / Pisca (Troca)" },
                        { id: "bounce_yellow", label: "🟡 Destaque Amarelo" },
                        { id: "typewriter", label: "⌨️ Máquina de Escrever" },
                        { id: "spotlight", label: "💡 Acende (Foco)" },
                      ].map((anim) => (
                        <button
                          key={anim.id}
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_animated: true, subtitle_animation_style: anim.id }))}
                          className={`rounded-xl border py-2 px-3 text-xs font-bold transition ${
                            style.subtitle_animated && (style.subtitle_animation_style || "bounce_yellow") === anim.id
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-[#242424] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
                          }`}
                        >
                          {anim.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Controles de Traçado (Stroke) e Sombra Projetada */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#242424]">
                    {/* Painel de Traçado (Outline) */}
                    <div className="space-y-3 rounded-xl bg-[#0a0a0a] p-4 border border-[#242424]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">✍️ Traçado (Contorno das Letras)</span>
                        <button
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_outline_enabled: !s.subtitle_outline_enabled }))}
                          className={`rounded-full px-3 py-1 text-[10px] font-extrabold transition ${
                            style.subtitle_outline_enabled ? "bg-emerald-500 text-black" : "bg-white/10 text-[#a8a8a8]"
                          }`}
                        >
                          {style.subtitle_outline_enabled ? "ATIVADO" : "DESATIVADO"}
                        </button>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex gap-2 pt-1">
                        {[
                          { label: "Nenhum", width: 0, enable: false },
                          { label: "Suave (1.5px)", width: 1.5, enable: true },
                          { label: "Médio (3px)", width: 3, enable: true },
                          { label: "Forte (5px)", width: 5, enable: true },
                        ].map((p) => (
                          <button
                            key={p.label}
                            onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_outline_enabled: p.enable, subtitle_outline_width: p.width }))}
                            className={`flex-1 rounded-lg border py-1 px-1 text-[10px] font-bold transition ${
                              (style.subtitle_outline_enabled === p.enable && (!p.enable || (style.subtitle_outline_width || 2) === p.width))
                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                : "border-[#242424] bg-[#141414] text-[#737373] hover:text-white"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {style.subtitle_outline_enabled && (
                        <div className="space-y-3 pt-2 border-t border-[#242424]">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[#a8a8a8]">Espessura Fina:</span>
                            <span className="font-mono text-xs font-bold text-emerald-400">{style.subtitle_outline_width || 2}px</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="8"
                            step="0.5"
                            value={style.subtitle_outline_width || 2}
                            onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_outline_width: parseFloat(e.target.value) }))}
                            className="w-full accent-emerald-400 cursor-pointer"
                          />

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-[#a8a8a8]">Cor do Traçado:</span>
                            <input
                              type="color"
                              value={style.subtitle_outline_color || "#000000"}
                              onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_outline_color: e.target.value }))}
                              className="h-7 w-12 cursor-pointer rounded border border-[#242424] bg-transparent p-0"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Painel de Sombra Projetada (Drop Shadow) */}
                    <div className="space-y-3 rounded-xl bg-[#0a0a0a] p-4 border border-[#242424]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">🌓 Sombra Projetada (Drop Shadow)</span>
                        <button
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_shadow_enabled: !s.subtitle_shadow_enabled }))}
                          className={`rounded-full px-3 py-1 text-[10px] font-extrabold transition ${
                            style.subtitle_shadow_enabled ? "bg-emerald-500 text-black" : "bg-white/10 text-[#a8a8a8]"
                          }`}
                        >
                          {style.subtitle_shadow_enabled ? "ATIVADO" : "DESATIVADO"}
                        </button>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex gap-2 pt-1">
                        {[
                          { label: "Nenhuma", offset: 0, enable: false },
                          { label: "Suave", offset: 3, enable: true },
                          { label: "Projetada", offset: 6, enable: true },
                          { label: "Marcada", offset: 10, enable: true },
                        ].map((p) => (
                          <button
                            key={p.label}
                            onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_shadow_enabled: p.enable, subtitle_shadow_offset: p.offset }))}
                            className={`flex-1 rounded-lg border py-1 px-1 text-[10px] font-bold transition ${
                              (style.subtitle_shadow_enabled === p.enable && (!p.enable || (style.subtitle_shadow_offset || 4) === p.offset))
                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                : "border-[#242424] bg-[#141414] text-[#737373] hover:text-white"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {style.subtitle_shadow_enabled && (
                        <div className="space-y-3 pt-2 border-t border-[#242424]">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[#a8a8a8]">Intensidade/Deslocamento:</span>
                            <span className="font-mono text-xs font-bold text-emerald-400">{style.subtitle_shadow_offset || 4}px</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="12"
                            step="1"
                            value={style.subtitle_shadow_offset || 4}
                            onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_shadow_offset: parseInt(e.target.value) }))}
                            className="w-full accent-emerald-400 cursor-pointer"
                          />

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-[#a8a8a8]">Cor da Sombra:</span>
                            <input
                              type="color"
                              value={style.subtitle_shadow_color || "#000000"}
                              onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_shadow_color: e.target.value }))}
                              className="h-7 w-12 cursor-pointer rounded border border-[#242424] bg-transparent p-0"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                    <div>
                      <span className="block text-xs font-medium text-[#a8a8a8] mb-1.5">Linhas da Legenda:</span>
                      <div className="grid grid-cols-2 gap-2">
                        {[1, 2].map((lines) => (
                          <button
                            key={lines}
                            onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_max_lines: lines }))}
                            className={`rounded-xl border py-2 text-xs font-bold transition ${
                              style.subtitle_max_lines === lines
                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                : "border-[#242424] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
                            }`}
                          >
                            {lines} {lines === 1 ? "Linha (Exata)" : "Linhas (Máx 2)"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1.5">
                        <span>Tamanho da Fonte:</span>
                        <span className="font-mono text-emerald-400 font-bold">{style.subtitle_font_size || 58}px</span>
                      </div>
                      <input
                        type="range"
                        min="30"
                        max="90"
                        value={style.subtitle_font_size || 58}
                        onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_font_size: parseInt(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1.5">
                        <span>Letras por Linha:</span>
                        <span className="font-mono text-emerald-400 font-bold">{style.subtitle_max_chars_per_line || 25}</span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="45"
                        value={style.subtitle_max_chars_per_line || 25}
                        onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_max_chars_per_line: parseInt(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1.5">
                        <span>Espaçamento de Letras:</span>
                        <span className="font-mono text-emerald-400 font-bold">{style.subtitle_letter_spacing || 0}px</span>
                      </div>
                      <input
                        type="range"
                        min="-5"
                        max="12"
                        value={style.subtitle_letter_spacing || 0}
                        onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_letter_spacing: parseInt(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* 7. PAINEL PROFISSIONAL DE COLOR GRADING */}
                <div className="rounded-2xl border border-[#242424] bg-[#141414] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-semibold text-[#ededed]">🎨 Color grading & imagem</label>
                    <div className="flex gap-2">
                      {[
                        { label: "Natural", grade: { contrast: 1.0, saturation: 1.0, brightness: 1.0, warmth: 0.0, sharpness: 0.0, intensity: 1.0 } },
                        { label: "Vívido", grade: { contrast: 1.25, saturation: 1.35, brightness: 1.05, warmth: 0.0, sharpness: 0.0, intensity: 1.0 } },
                        { label: "Cinema", grade: { contrast: 1.3, saturation: 0.9, brightness: 1.0, warmth: 0.15, sharpness: 0.0, intensity: 1.0 } },
                        { label: "Quente", grade: { contrast: 1.08, saturation: 1.12, brightness: 1.02, warmth: 0.3, sharpness: 0.0, intensity: 1.0 } },
                        { label: "Frio", grade: { contrast: 1.08, saturation: 1.05, brightness: 1.0, warmth: -0.3, sharpness: 0.0, intensity: 1.0 } },
                        { label: "P&B", grade: { contrast: 1.3, saturation: 0.0, brightness: 1.0, warmth: 0.0, sharpness: 0.0, intensity: 1.0 } },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => {
                            Object.entries(preset.grade).forEach(([k, v]) => handleGradeChange(k as any, v));
                          }}
                          className="rounded-lg border border-[#242424] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-bold text-[#a8a8a8] hover:text-emerald-300"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1">
                        <span>Contraste:</span>
                        <span className="font-mono text-emerald-400 font-bold">{Math.round((style.color_grade?.contrast ?? 1.0) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.05"
                        value={style.color_grade?.contrast ?? 1.0}
                        onChange={(e) => handleGradeChange("contrast", parseFloat(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1">
                        <span>Saturação:</span>
                        <span className="font-mono text-emerald-400 font-bold">{Math.round((style.color_grade?.saturation ?? 1.0) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="2.5"
                        step="0.05"
                        value={style.color_grade?.saturation ?? 1.0}
                        onChange={(e) => handleGradeChange("saturation", parseFloat(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1">
                        <span>Brilho:</span>
                        <span className="font-mono text-emerald-400 font-bold">{Math.round((style.color_grade?.brightness ?? 1.0) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.05"
                        value={style.color_grade?.brightness ?? 1.0}
                        onChange={(e) => handleGradeChange("brightness", parseFloat(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1">
                        <span>Temperatura (Warmth):</span>
                        <span className="font-mono text-emerald-400 font-bold">{Math.round((style.color_grade?.warmth ?? 0.0) * 100)}</span>
                      </div>
                      <input
                        type="range"
                        min="-0.5"
                        max="0.5"
                        step="0.05"
                        value={style.color_grade?.warmth ?? 0.0}
                        onChange={(e) => handleGradeChange("warmth", parseFloat(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                  </div>
                </div>

                {/* 8. ADAPTAÇÃO DE FORMATO DE VÍDEO & SELEÇÃO DE EXPORTAÇÃO MULTI-FORMATO */}
                <div className="rounded-2xl border border-[#242424] bg-[#141414] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-semibold text-[#ededed]">📐 Formatos de exportação</label>
                    <span className="text-[11px] text-[#a8a8a8]">Marque os formatos que deseja exportar</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { id: "9:16", label: "📱 9:16 (1080x1920)", desc: "Reels / TikTok / Shorts" },
                      { id: "4:5", label: "📸 4:5 (1080x1350)", desc: "Feed Instagram Retrato" },
                      { id: "1:1", label: "🔲 1:1 (1080x1080)", desc: "Feed Quadrado Post" },
                      { id: "16:9", label: "📺 16:9 (1920x1080)", desc: "YouTube / Widescreen" },
                    ].map((f) => {
                      const isSelected = selectedExportFormats.includes(f.id);
                      return (
                        <div
                          key={f.id}
                          onClick={() => {
                            updateStyleAndPersist((s) => ({ ...s, aspect_ratio: f.id as any }));
                            setSelectedExportFormats((prev) =>
                              prev.includes(f.id) ? prev.filter((item) => item !== f.id) : [...prev, f.id]
                            );
                          }}
                          className={`cursor-pointer rounded-2xl border p-4 text-left transition-all ${
                            isSelected
                              ? "border-emerald-400 bg-emerald-500/10"
                              : "border-[#242424] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-white">{f.label}</span>
                            <span className={`h-4 w-4 rounded-full border flex items-center justify-center text-[9px] font-bold ${isSelected ? "border-emerald-400 bg-emerald-400 text-black" : "border-[#404040]"}`}>
                              {isSelected ? "✓" : ""}
                            </span>
                          </div>
                          <div className="text-[10px] text-[#737373]">{f.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-[#242424]">
                  <button onClick={() => setActiveTab("visual")} className="btn-primary btn-pill px-8 py-3 text-xs font-bold">
                    Aprovar Estilo &amp; ir para Exportar →
                  </button>
                </div>
              </div>
            )}

            {/* 🎬 FASE 3 — VISUAL & EXPORTAR TAB */}
            {activeTab === "visual" && (
              <div className="space-y-6 animate-in">
                <div className="rounded-2xl border border-[#242424] bg-[#141414] p-6 space-y-5">
                  <h3 className="text-lg font-bold text-white">🎬 Exportação Final</h3>
                  <p className="text-xs text-[#a8a8a8]">
                    Revise todas as configurações e gere seu vídeo final de alta conversão.
                  </p>

                  <div className="space-y-2.5 rounded-xl bg-[#0a0a0a] p-4 border border-[#242424] text-xs text-[#a8a8a8]">
                    <div className="flex justify-between">
                      <span>Layout:</span>
                      <span className="font-bold text-emerald-400">{style.layout === "fullscreen" ? "Tela Cheia 1080x1920" : "Split 50/50"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fonte Selecionada:</span>
                      <span className="font-bold text-emerald-400">{style.subtitle_font || "TikTok Medium"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Formatos Selecionados para Exportar:</span>
                      <div className="flex gap-1.5">
                        {selectedExportFormats.map((fmt) => (
                          <span key={fmt} className="rounded bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300 border border-emerald-500/30">
                            {fmt}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      setIsRendering(true);
                      setRenderError(null);
                      try {
                        await setStyleOptions(jobId, style);
                        await startBatchRender(jobId, selectedExportFormats);
                        setTimeout(() => refetch(), 1500);
                      } catch (err) {
                        setRenderError(err instanceof Error ? err.message : "Erro ao exportar em lote.");
                      }
                      setIsRendering(false);
                    }}
                    disabled={!isCleanReady || isRendering}
                    className="w-full rounded-xl bg-emerald-500 py-4 text-base font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRendering
                      ? "⚡ Renderizando vídeos em lote…"
                      : `Exportar todos os formatos (${selectedExportFormats.length}) →`}
                  </button>

                  {renderError && <p className="text-xs text-rose-400">⚠️ {renderError}</p>}

                  {/* Batch Download Cards */}
                  {job.batch_videos && Object.keys(job.batch_videos).length > 0 && (
                    <div className="space-y-3 pt-3 border-t border-[#242424]">
                      <span className="block text-xs font-semibold text-[#ededed]">
                        ✅ Formatos Renderizados Prontos para Download:
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Object.entries(job.batch_videos).map(([fmt, url]) => {
                          const fname = url.split("/").pop() || `final_${fmt.replace(":", "_")}.mp4`;
                          return (
                            <button
                              key={fmt}
                              onClick={() => downloadFile(getDownloadUrl(jobId, fname), `editu_video_${fmt.replace(":", "_")}.mp4`)}
                              className="flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition"
                            >
                              <span>📱 Formato {fmt}</span>
                              <span className="text-[10px] bg-emerald-400 text-black px-2 py-0.5 rounded font-extrabold">⬇️ Baixar MP4</span>
                            </button>
                          );
                        })}
                      </div>

                      {job.batch_zip_url && (
                        <button
                          onClick={() => downloadFile(getDownloadUrl(jobId, "export_batch.zip"), "editu_videos_lote.zip")}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient py-3.5 text-sm font-extrabold text-[#0a0a0a] hover:opacity-90 transition mt-2"
                        >
                          📦 Baixar Pacote Completo ZIP (.zip)
                        </button>
                      )}
                    </div>
                  )}

                  {/* Single Download Fallback */}
                  {job.final_video_url && (!job.batch_videos || Object.keys(job.batch_videos).length === 0) && (
                    <button
                      onClick={() => downloadFile(getDownloadUrl(jobId, job.final_video_url?.split("/").pop() || "final_video.mp4"), "editu_video_final.mp4")}
                      data-testid="download-final"
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient py-3.5 text-sm font-extrabold text-[#0a0a0a] hover:opacity-90 transition"
                    >
                      ⬇️ Baixar Vídeo Final MP4
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ═══════════ RIGHT COLUMN: PLAYER DE PRÉVIA 9:16 PERMANENTE EM TODAS AS FASES ═══════════ */}
          <div className="sticky top-16 space-y-3">
            <div className="glass-panel overflow-hidden p-3 flex flex-col items-center justify-center max-h-[calc(100vh-100px)]">
              <div className="mb-2 w-full flex items-center justify-between text-[11px] text-[#a8a8a8]">
                <span>📱 Prévia Ao Vivo {style.aspect_ratio || "9:16"}</span>
                <span className="text-emerald-400 font-bold">
                  {isPlaying ? "▶ Tocando" : "⏸ Pausado"}
                </span>
              </div>

              <div
                ref={videoContainerRef}
                onMouseMove={handleContainerMouseMove}
                className={`relative mx-auto max-h-[calc(100vh-160px)] w-auto overflow-hidden rounded-[1.75rem] bg-black select-none border border-white/10 transition-all ${
                  (style.aspect_ratio || "9:16") === "4:5"
                    ? "aspect-[4/5] h-[420px]"
                    : (style.aspect_ratio || "9:16") === "1:1"
                    ? "aspect-[1/1] h-[380px]"
                    : (style.aspect_ratio || "9:16") === "16:9"
                    ? "aspect-[16/9] w-[450px] max-w-full h-auto"
                    : "aspect-[9/16] h-[450px]"
                }`}
              >


                {style.layout === "split_screen" ? (
                  <div className="flex h-full w-full flex-col">
                    {/* Top Media */}
                    <div className="relative h-1/2 w-full overflow-hidden bg-[#141414]">
                      {activeSplitUrl ? (
                        isTopMediaVideo ? (
                          <video
                            ref={topVideoRef}
                            key={activeSplitUrl}
                            src={getVideoUrl(activeSplitUrl)}
                            muted
                            loop
                            autoPlay
                            playsInline
                            className="h-full w-full object-cover"
                            style={{ objectPosition: `center ${framingYPercent}%` }}
                          />
                        ) : (
                          <img
                            key={activeSplitUrl}
                            src={getVideoUrl(activeSplitUrl)}
                            alt="B-Roll"
                            className="h-full w-full object-cover transition-all duration-300"
                            style={{ objectPosition: `center ${framingYPercent}%` }}
                          />
                        )
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
                          <span className="text-2xl mb-1">🖼️</span>
                          <span className="text-[11px] text-slate-400 font-geist">Sem mídia no topo</span>
                        </div>
                      )}
                    </div>

                    {/* Bottom Media */}
                    <div className="relative h-1/2 w-full overflow-hidden bg-black">
                      {currentVideoPath ? (
                        <video
                          ref={videoRef}
                          key={currentVideoPath}
                          src={getVideoUrl(currentVideoPath)}
                          controls
                          onPlay={handlePlay}
                          onPause={handlePause}
                          onTimeUpdate={handleTimeUpdate}
                          onError={handleVideoError}
                          className="h-full w-full object-cover transition-none"
                          style={{
                            filter: cssGradeFilter,
                            transform: `scale(${currentZoomScale}) rotate(${style.rotation || 0}deg)`,
                            objectPosition: `center ${framingYBottomPercent}%`,
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-500">
                          {videoError ? <span className="text-rose-400 px-3 text-center">⚠️ {videoError}</span> : <>Carregando vídeo...</>}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* FULLSCREEN PREVIEW */
                  currentVideoPath ? (
                    <>
                      {/* Fundo desfocado do próprio vídeo quando o formato não bate
                          (ex.: vertical em 16:9) — mesmo tratamento do render final */}
                      {useBlurBg && (
                        <video
                          ref={bgVideoRef}
                          key={`bg-${currentVideoPath}`}
                          src={getVideoUrl(currentVideoPath)}
                          muted
                          playsInline
                          className="absolute inset-0 h-full w-full object-cover"
                          style={{
                            filter: `${cssGradeFilter} blur(22px) brightness(0.85)`,
                            transform: `scale(1.15) rotate(${style.rotation || 0}deg)`,
                          }}
                        />
                      )}
                      <video
                        ref={videoRef}
                        key={currentVideoPath}
                        src={getVideoUrl(currentVideoPath)}
                        controls
                        onPlay={handlePlay}
                        onPause={handlePause}
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onError={handleVideoError}
                        className={`relative z-[1] h-full w-full transition-none ${
                          useBlurBg ? "object-contain" : "object-cover"
                        }`}
                        style={{
                          filter: cssGradeFilter,
                          transform: `scale(${currentZoomScale}) rotate(${style.rotation || 0}deg)`,
                          objectPosition: useBlurBg ? "center center" : smartObjectPosition,
                        }}
                      />
                    </>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-500">
                      {videoError ? <span className="text-rose-400 px-3 text-center">⚠️ {videoError}</span> : <>Carregando vídeo...</>}
                    </div>
                  )
                )}

                {/* Aviso enquanto o backend aplica os cortes aprovados */}
                {isReprocessing && activeTab !== "corte" && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-200">Aplicando seus cortes no vídeo…</span>
                    <span className="text-[10px] text-[#9a9a9a]">A legenda entra sincronizada assim que terminar</span>
                  </div>
                )}

                {/* Scrub: arraste no preview pra navegar · clique = play/pause */}
                {currentVideoPath && (
                  <div
                    onPointerDown={handleScrubDown}
                    onPointerMove={handleScrubMove}
                    onPointerUp={handleScrubEnd}
                    onPointerCancel={handleScrubEnd}
                    title="Arraste para os lados para navegar no vídeo · clique para tocar/pausar"
                    className="absolute inset-x-0 top-0 bottom-14 z-10 cursor-grab active:cursor-grabbing"
                  />
                )}

                {/* Subtitle Overlay — só DEPOIS dos cortes (na aba Corte a legenda fica
                    de fora; ela entra na aba Estilo já sincronizada com o vídeo cortado) */}
                {style.subtitle_style === "basic" && activeSub && activeTab !== "corte" && (
                  <div
                    onMouseDown={handleSubMouseDown}
                    className={`absolute cursor-move select-none -translate-x-1/2 -translate-y-1/2 transition-shadow z-20 ${
                      isDraggingSub ? "ring-2 ring-emerald-400 scale-105" : "hover:ring-1 hover:ring-white/40"
                    }`}
                    style={{
                      left: `${style.subtitle_x_percent}%`,
                      top: `${style.subtitle_y_percent}%`,
                    }}
                  >
                    <span
                      className="inline-block rounded-lg px-3.5 py-1.5 font-bold text-center leading-snug max-w-[280px] whitespace-pre-line"
                      style={{
                        fontSize: `${Math.max(12, Math.round((style.subtitle_font_size || 58) * 0.23))}px`,
                        color: style.subtitle_color,
                        backgroundColor: style.subtitle_bg_color !== "transparent" && style.subtitle_bg_color !== "none" && style.subtitle_bg_color !== "" ? style.subtitle_bg_color : "transparent",
                        letterSpacing: `${((style.subtitle_letter_spacing || 0) * 0.23).toFixed(2)}px`,
                        fontFamily:
                          style.subtitle_font === "TikTok Medium" ? "'TikTok Sans', 'Proxima Nova', sans-serif"
                          : style.subtitle_font === "Helvetica" ? "'Helvetica Neue', Helvetica, Arial, sans-serif"
                          : style.subtitle_font === "Montserrat" ? "'Montserrat', sans-serif"
                          : style.subtitle_font === "Lato" ? "'Lato', sans-serif"
                          : style.subtitle_font === "The Bold Font" ? "'Anton', sans-serif"
                          : style.subtitle_font === "Bebas Neue" ? "'Bebas Neue', sans-serif"
                          : "'Inter', sans-serif",
                        textShadow: style.subtitle_outline_enabled ? buildExternalOutline(style.subtitle_outline_width || 2, style.subtitle_outline_color || "#000000") : "none",
                        filter: style.subtitle_shadow_enabled
                          ? `drop-shadow(0 ${Math.round((style.subtitle_shadow_offset || 4) * 0.8)}px ${Math.round((style.subtitle_shadow_offset || 4) * 1.6)}px ${shadowRgba(style.subtitle_shadow_color)})`
                          : "none",
                      }}
                    >
                      {renderPreviewSubContent(activeSub)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  transcribing: "Transcrevendo áudio",
  cutting: "Detectando cortes",
  grading: "Aplicando color grade",
  clean_ready: "Pronto",
  rendering: "Renderizando",
  done: "Finalizado",
  error: "Erro",
};

function formatDuration(seconds?: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function downloadFile(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildExternalOutline(width: number, color: string): string {
  // Anel de sombras em 16 direções + anel interno: contorno arredondado e uniforme,
  // sem os "buracos" nas diagonais que o método de 8 direções deixava.
  const r = Math.max(1, width * 0.6); // escala compacta pro tamanho da fonte no preview
  const shadows: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    shadows.push(`${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r).toFixed(1)}px 0 ${color}`);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    shadows.push(`${(Math.cos(a) * r * 0.55).toFixed(1)}px ${(Math.sin(a) * r * 0.55).toFixed(1)}px 0 ${color}`);
  }
  return shadows.join(", ");
}

function shadowRgba(color: string | undefined): string {
  // Suaviza a cor da sombra projetada (65% de opacidade) — sombra chapada 100% preta fica dura
  if (!color) return "rgba(0,0,0,0.65)";
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.65)`;
}

function formatTimeExact(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}
