"use client";

import { useState, useEffect, useRef, useCallback, use } from "react";
import { useJobStatus } from "@/hooks/useJobStatus";
import {
  setStyleOptions,
  startRender,
  getVideoUrl,
  updateCuts,
  updateColorGrade,
  uploadSplitImage,
  uploadSplitImages,
  updateTranscript,
  triggerAutoBroll,
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
  const [highlightColor, setHighlightColor] = useState("#22D3EE");
  const [headlineText, setHeadlineText] = useState("");

  const [isDraggingSub, setIsDraggingSub] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const topVideoRef = useRef<HTMLVideoElement>(null);
  const gradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitInputRef = useRef<HTMLInputElement>(null);
  const userTouchedStyle = useRef(false);

  // Sync from job on initial load only
  useEffect(() => {
    if (!job) return;
    if (job.style_options && !userTouchedStyle.current) {
      setStyle(job.style_options);
    }
    if (job.cuts && localCuts.length === 0) setLocalCuts(job.cuts);
    if (job.transcript && localTranscript.length === 0) setLocalTranscript(job.transcript);

    if (job.status === "clean_ready" && isReprocessing) {
      if (job.cuts) setLocalCuts(job.cuts);
      if (job.transcript) setLocalTranscript(job.transcript);
      setIsReprocessing(false);
    }
  }, [job, isReprocessing, localCuts.length, localTranscript.length]);

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
    }
  };

  const handlePlay = () => {
    if (topVideoRef.current) topVideoRef.current.play().catch(() => {});
    setIsPlaying(true);
  };

  const handlePause = () => {
    if (topVideoRef.current) topVideoRef.current.pause();
    setIsPlaying(false);
  };

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
  };

  // PRECISE SUBTITLE SYNC — find the segment whose word-level time range
  // best covers currentTime. No artificial tolerances that cause overlapping matches.
  const activeSubIndex = (() => {
    let bestIdx = -1;
    let bestOverlap = -Infinity;
    for (let i = 0; i < localTranscript.length; i++) {
      const s = localTranscript[i];
      // Exact match: currentTime falls within the segment's word boundaries
      if (currentTime >= s.start && currentTime <= s.end) {
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
        if (currentTime > s.end && currentTime <= s.end + 0.05) {
          bestIdx = i;
          break;
        }
      }
    }
    return bestIdx;
  })();
  const activeSub = activeSubIndex !== -1 ? localTranscript[activeSubIndex] : null;

  // Multi-File Split Carousel
  const splitUrls = job?.split_images_urls || (job?.split_image_url ? [job.split_image_url] : []);
  const currentSplitIdx = splitUrls.length > 0 ? Math.floor(currentTime / 4) % splitUrls.length : 0;
  const activeSplitUrl = splitUrls.length > 0 ? splitUrls[currentSplitIdx] : null;

  const isTopMediaVideo = activeSplitUrl && (
    activeSplitUrl.endsWith(".mp4") ||
    activeSplitUrl.endsWith(".mov") ||
    activeSplitUrl.endsWith(".webm") ||
    activeSplitUrl.endsWith(".mkv") ||
    activeSplitUrl.endsWith(".avi")
  );

  // Dynamic Zoom Scale
  const isSegmentZoomed = style.zoom_enabled && activeSubIndex !== -1 && Math.floor(activeSubIndex / 3) % 2 === 1;
  const currentZoomScale = isSegmentZoomed ? 1.15 : 1.0;

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

  const handleRender = async () => {
    setRenderError(null);
    setIsRendering(true);
    try {
      if (localTranscript.length > 0) await updateTranscript(jobId, localTranscript);
      await setStyleOptions(jobId, style);
      await startRender(jobId);
      setTimeout(() => refetch(), 1000);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "Erro ao renderizar");
    }
    setIsRendering(false);
  };

  const handleToggleCut = useCallback(
    async (index: number) => {
      const updated = localCuts.map((c, i) =>
        i === index ? { ...c, enabled: !c.enabled } : c
      );
      setLocalCuts(updated);
      setIsReprocessing(true);
      try {
        await updateCuts(jobId, updated);
      } catch {
        setIsReprocessing(false);
      }
    },
    [localCuts, jobId]
  );

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
          await uploadSplitImage(jobId, files[0]);
        } else {
          await uploadSplitImages(jobId, files);
        }
        updateStyleAndPersist((s) => ({ ...s, layout: "split_screen" }));
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

  const applyPresetTheme = (theme: SubtitleTheme) => {
    const presets: Record<SubtitleTheme, Partial<StyleOptions>> = {
      andromeda: { subtitle_color: "#FFFFFF", subtitle_outline_color: "#000000", subtitle_bg_color: "#000000", subtitle_outline_enabled: false, subtitle_shadow_enabled: false },
      energy: { subtitle_color: "#000000", subtitle_outline_color: "#000000", subtitle_bg_color: "#FFFFFF", subtitle_outline_enabled: false, subtitle_shadow_enabled: false },
      million: { subtitle_color: "#FFFFFF", subtitle_outline_color: "#000000", subtitle_bg_color: "transparent", subtitle_outline_enabled: false, subtitle_shadow_enabled: true },
      minimal_white: { subtitle_color: "#FFFFFF", subtitle_outline_color: "#000000", subtitle_bg_color: "transparent", subtitle_outline_enabled: false, subtitle_shadow_enabled: false },
    };
    updateStyleAndPersist((s) => ({ ...s, subtitle_theme: theme, ...presets[theme] }));
  };

  // STRICT 1 OR 2 LINE FORMATTING — groups words into lines respecting maxChars/maxLines
  const wrapWordsIntoLines = (words: string[], maxChars: number, maxLines: number): string[][] => {
    const lines: string[][] = [];
    let currentLine: string[] = [];
    let currentLen = 0;

    for (const w of words) {
      const newLen = currentLen + (currentLine.length > 0 ? 1 : 0) + w.length;
      if (newLen <= maxChars || currentLine.length === 0) {
        currentLine.push(w);
        currentLen = newLen;
      } else {
        lines.push(currentLine);
        currentLine = [w];
        currentLen = w.length;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    // Clamp to maxLines
    if (maxLines === 1) {
      return [words]; // single line with all words
    } else if (maxLines === 2 && lines.length > 2) {
      return [lines[0], lines.slice(1).flat()];
    }
    return lines;
  };

  const formatSubText = (rawText: string) => {
    const isUpper = ["andromeda", "million"].includes(style.subtitle_theme);
    const text = isUpper ? rawText.toUpperCase() : rawText;
    const maxChars = style.subtitle_max_chars_per_line || 25;
    const maxLines = style.subtitle_max_lines || 1;
    const words = text.split(/\s+/).filter(Boolean);
    const lines = wrapWordsIntoLines(words, maxChars, maxLines);
    return lines.map(l => l.join(" ")).join("\n");
  };

  // Render Subtitle Content in Preview — respects maxLines even with animation
  const renderPreviewSubContent = (sub: TranscriptSegment) => {
    if (!style.subtitle_animated || !sub.words || sub.words.length === 0) {
      return formatSubText(sub.text);
    }

    const isUpper = ["andromeda", "million"].includes(style.subtitle_theme);
    const maxChars = style.subtitle_max_chars_per_line || 25;
    const maxLines = style.subtitle_max_lines || 1;
    const animStyle = style.subtitle_animation_style || "bounce_yellow";

    const activeColorClass =
      animStyle === "neon_cyan"
        ? "text-cyan-300 drop-shadow-[0_2px_10px_rgba(34,211,238,0.9)] scale-110 font-black"
        : animStyle === "box_primary"
        ? "text-emerald-300 drop-shadow-[0_2px_10px_rgba(52,211,153,0.9)] scale-110 font-black"
        : "text-yellow-300 drop-shadow-[0_2px_10px_rgba(250,204,21,0.9)] scale-110 font-black";

    // Group words into lines respecting maxChars and maxLines
    const wordTexts = sub.words.map(w => isUpper ? w.word.toUpperCase() : w.word);
    const lines = wrapWordsIntoLines(wordTexts, maxChars, maxLines);

    // Build a flat index map so we can match sub.words[i] -> which line it belongs to
    let wordIdx = 0;
    return lines.map((lineWords, lineIdx) => (
      <span key={`line-${lineIdx}`} className="block">
        {lineWords.map((wordTxt) => {
          const wObj = sub.words[wordIdx];
          const isWordActive = wObj ? currentTime >= wObj.start && currentTime <= wObj.end : false;
          wordIdx++;
          return (
            <span
              key={wordIdx}
              className={`inline-block transition-all duration-150 mr-1.5 ${
                isWordActive ? activeColorClass : "opacity-80"
              }`}
            >
              {wordTxt}
            </span>
          );
        })}
      </span>
    ));
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
          <svg className="mx-auto h-10 w-10 animate-spin text-cyan-300" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-4 text-sm text-slate-400 font-geist">Carregando Editu...</p>
        </div>
      </main>
    );
  }

  const isCleanReady = job.status === "clean_ready" || job.status === "done";
  const totalDuration = job.clean_duration || job.original_duration || 1;
  const currentVideoPath = job.clean_video_url || job.final_video_url || "";

  const cg = style.color_grade;
  const cssGradeFilter = `contrast(${Math.round(cg.contrast * 100)}%) saturate(${Math.round(cg.saturation * 100)}%) brightness(${Math.round(cg.brightness * 100)}%)`;
  const framingYPercent = style.split_screen_framing_y ?? 50.0;

  const segmentBadges = ["HOOK", "DINÂMICA", "RECURSOS", "CONTEÚDO", "CTA"];

  return (
    <main className="min-h-screen bg-[#07090E] text-slate-100 font-geist" onMouseUp={handleMouseUp}>
      {/* ═══════════ HEADER COM FASES E STATUS ═══════════ */}
      <header className="sticky top-0 z-40 border-b border-cyan-500/10 bg-[#0A0D16]/90 backdrop-blur-md px-6 py-3.5">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-sm font-bold text-white font-jakarta truncate max-w-[320px]">
                {job.original_filename || "Vídeo sem nome"}
              </h1>
              <p className="text-[11px] text-cyan-300 font-medium">
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
          <div className="flex items-center rounded-2xl bg-black/60 p-1.5 border border-white/10">
            <button
              onClick={() => setActiveTab("corte")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold transition-all font-jakarta ${
                activeTab === "corte"
                  ? "bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/20 scale-[1.02]"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>✂️</span> FASE 1 Corte
            </button>
            <button
              onClick={() => setActiveTab("estilo")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold transition-all font-jakarta ${
                activeTab === "estilo"
                  ? "bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/20 scale-[1.02]"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>🎨</span> Estilo
            </button>
            <button
              onClick={() => setActiveTab("visual")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold transition-all font-jakarta ${
                activeTab === "visual"
                  ? "bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/20 scale-[1.02]"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
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
            <p className="text-rose-300/90">{job.error_message || "Erro desconhecido no backend. Tente enviar o vídeo novamente."}</p>
          </div>
        )}
        {!isCleanReady && job.status !== "error" && (
          <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-cyan-100 font-geist">
            <div className="mb-2 flex items-center gap-2 font-bold">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
              {STATUS_LABEL[job.status] || "Processando"} — {job.progress || 0}%
            </div>
            <div className="progress-track max-w-xl">
              <div className="progress-fill" style={{ width: `${job.progress || 0}%` }} />
            </div>
            <p className="mt-2 text-xs text-cyan-200/70">
              O vídeo editado aparecerá automaticamente aqui assim que o processamento terminar.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
          {/* ═══════════ LEFT COLUMN (PAINEL DA FASE ATIVA) ═══════════ */}
          <div className="space-y-6">
            {/* ✂️ FASE 1 — CORTE TAB */}
            {activeTab === "corte" && (
              <div className="space-y-6 animate-in">
                {/* Control Bar: Timecode, Play, Zoom, Fit */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0E121E] p-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlayPause}
                      className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400 font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:scale-105 active:scale-95"
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                    <div className="rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-sm font-mono font-bold text-cyan-300">
                      {formatTimeExact(currentTime)} / {formatTimeExact(totalDuration)}
                    </div>
                    <span className="rounded-lg bg-cyan-400/10 border border-cyan-400/30 px-2.5 py-1 text-xs font-bold text-cyan-300">
                      📌 IN
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-medium">Zoom</span>
                      <input
                        type="range"
                        min="50"
                        max="200"
                        value={zoomLevel}
                        onChange={(e) => setZoomLevel(parseInt(e.target.value))}
                        className="w-28 accent-cyan-400 cursor-pointer"
                      />
                    </div>
                    <button
                      onClick={() => setZoomLevel(100)}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
                    >
                      Fit
                    </button>
                  </div>
                </div>

                {/* TIMELINE PRO COM RULER, CUT BLOCKS E WAVEFORM AUDIO */}
                <div className="rounded-2xl border border-white/10 bg-[#0E121E] p-6 shadow-2xl overflow-hidden">
                  <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                    <span>🎞️ Linha do Tempo & Cortes Inteligentes</span>
                    <span className="text-cyan-400 font-mono">{formatDuration(totalDuration)} total</span>
                  </div>

                  <div className="relative w-full overflow-x-auto select-none py-2">
                    <div className="min-w-[700px] relative">
                      {/* Ruler Bar */}
                      <div className="flex h-6 w-full items-end justify-between border-b border-white/10 pb-1 text-[10px] font-mono text-slate-500">
                        {Array.from({ length: 9 }).map((_, i) => (
                          <span key={i}>{((totalDuration / 8) * i).toFixed(2)}s</span>
                        ))}
                      </div>

                      {/* Video Cut Blocks Track */}
                      <div className="relative mt-3 h-20 w-full rounded-xl bg-black/60 border border-white/10 overflow-hidden flex gap-1 p-1">
                        {localCuts.map((cut, i) => {
                          const widthPct = Math.max(((cut.end - cut.start) / totalDuration) * 100, 1);
                          const badgeLabel = segmentBadges[i % segmentBadges.length];
                          return (
                            <div
                              key={`cut-${i}`}
                              onClick={() => {
                                // Map original cut.start to clean video time offset
                                const enabledBefore = localCuts.slice(0, i).filter(c => c.enabled);
                                const cleanOffset = enabledBefore.reduce((acc, c) => acc + (c.end - c.start), 0);
                                handleSeek(cleanOffset);
                                handleToggleCut(i);
                              }}
                              className={`relative h-full flex-1 rounded-lg border transition-all cursor-pointer flex flex-col justify-between p-2 overflow-hidden ${
                                cut.enabled
                                  ? "border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40"
                                  : "border-rose-500/40 bg-rose-950/40 opacity-50 hover:opacity-75"
                              }`}
                              style={{ minWidth: `${widthPct}%` }}
                            >
                              <div className="flex items-center justify-between">
                                <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider text-cyan-300">
                                  {badgeLabel}
                                </span>
                                <span className="text-[9px] font-mono text-slate-400">{(cut.end - cut.start).toFixed(1)}s</span>
                              </div>
                              <div className="text-[10px] font-bold text-white truncate">
                                {localTranscript[i]?.text || "Segmento"}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Audio Waveform Track */}
                      <div className="relative mt-2 h-14 w-full rounded-xl bg-black/80 border border-white/10 overflow-hidden p-2 flex items-center justify-between gap-[2px]">
                        {Array.from({ length: 120 }).map((_, i) => {
                          const h = Math.floor(Math.abs(Math.sin(i * 0.4) * 36 + Math.cos(i * 0.7) * 12 + 8));
                          return (
                            <div
                              key={`wave-${i}`}
                              className="w-[2px] rounded-full bg-gradient-to-t from-emerald-400 to-cyan-300 opacity-80"
                              style={{ height: `${h}px` }}
                            />
                          );
                        })}
                      </div>

                      {/* Bright Cyan Playhead Bar */}
                      <div
                        className="absolute top-0 bottom-0 w-[3px] bg-cyan-400 z-30 pointer-events-none transition-all shadow-[0_0_12px_#22D3EE]"
                        style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                      >
                        <div className="h-0 w-0 border-x-[6px] border-x-transparent border-t-[8px] border-t-cyan-400 -ml-[4.5px] -mt-1" />
                      </div>
                    </div>
                  </div>

                  {/* Banner */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3 border border-white/5 text-xs text-slate-400">
                    <span>💡 Clique em qualquer bloco de vídeo para ativar ou desativar o corte automático.</span>
                    <button onClick={() => setActiveTab("estilo")} className="btn-primary btn-pill text-xs font-bold">
                      Aprovar Corte & Ir para Estilo →
                    </button>
                  </div>
                </div>

                {/* Transcrição */}
                {isCleanReady && (
                  <div className="glass-panel p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-geist">📝 Transcrição Inteligente</p>
                        <p className="mt-0.5 text-[10px] text-slate-500 font-geist">Edite o texto das frases para ajustar o vídeo</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={copyTranscriptText} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-400/20 font-geist">
                          {copiedTx ? "✓ Copiado!" : "📋 Copiar Texto"}
                        </button>
                        <button onClick={downloadTranscriptTxt} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-400/20 font-geist">
                          ⬇️ Baixar TXT
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {localTranscript.map((seg, i) => (
                        <div key={i} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 hover:border-white/10">
                          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500 font-geist">
                            <span onClick={() => handleSeek(seg.start)} className="cursor-pointer text-cyan-400/80 hover:underline">
                              {formatTime(seg.start)} → {formatTime(seg.end)}
                            </span>
                            <span className="text-cyan-400 font-bold">#{i + 1}</span>
                          </div>
                          <input
                            type="text"
                            value={seg.text}
                            onChange={(e) => handleTranscriptTextChange(i, e.target.value)}
                            className="w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 py-1.5 text-sm text-white focus:border-cyan-400 focus:outline-none font-geist"
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
                  <label className="text-xs font-black uppercase tracking-wider text-cyan-400 font-geist">TIPO DE EDIÇÃO</label>
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
                            ? "border-cyan-400 bg-cyan-400/10 shadow-lg shadow-cyan-500/10 scale-[1.02]"
                            : "border-white/10 bg-[#0E121E] hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="mb-3 text-3xl">{t.icon}</div>
                        <div className="font-jakarta text-base font-bold text-white">{t.title}</div>
                        <div className="mt-1 text-xs text-slate-400 font-geist">{t.desc}</div>
                        {((style.layout === "fullscreen" && t.id === "fullscreen") || (style.layout === "split_screen" && t.id !== "fullscreen")) && (
                          <span className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-black text-xs font-bold">
                            ✓
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <input ref={splitInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleSplitImagesUpload} />

                  {style.layout === "split_screen" && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-[#0E121E] p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex-1 w-full">
                        <div className="flex justify-between items-center mb-1 text-xs text-slate-300 font-geist">
                          <span>↕️ Enquadramento Mídia Topo:</span>
                          <span className="font-mono text-cyan-300 font-bold">{Math.round(framingYPercent)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={framingYPercent}
                          onChange={(e) => updateStyleAndPersist((s) => ({ ...s, split_screen_framing_y: parseFloat(e.target.value) }))}
                          className="w-full accent-cyan-400 cursor-pointer"
                        />
                      </div>
                      <button onClick={handleAutoBroll} disabled={isAutoBrolling} className="btn-primary btn-pill text-xs whitespace-nowrap">
                        {isAutoBrolling ? "🤖 Buscando B-Roll..." : "🤖 Gerar Auto B-Roll IA"}
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. COR DE DESTAQUE */}
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-wider text-cyan-400 font-geist">COR DE DESTAQUE</label>
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#0E121E] p-4">
                    {[
                      { hex: "#22D3EE", name: "Ciano Editu" },
                      { hex: "#34D399", name: "Verde Esmeralda" },
                      { hex: "#FACC15", name: "Amarelo Ouro" },
                      { hex: "#FF5200", name: "Laranja Pop" },
                      { hex: "#EC4899", name: "Rosa Neon" },
                    ].map((c) => (
                      <button
                        key={c.hex}
                        onClick={() => {
                          setHighlightColor(c.hex);
                          updateStyleAndPersist((s) => ({ ...s, subtitle_color: c.hex }));
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition font-geist ${
                          highlightColor === c.hex
                            ? "border-white bg-white/10 text-white"
                            : "border-white/10 bg-black/40 text-slate-400 hover:text-white"
                        }`}
                      >
                        <span className="h-4 w-4 rounded-full shadow" style={{ backgroundColor: c.hex }} />
                        <span>{c.name}</span>
                      </button>
                    ))}
                    <div className="flex items-center gap-2 border-l border-white/10 pl-3">
                      <input
                        type="color"
                        value={highlightColor}
                        onChange={(e) => {
                          setHighlightColor(e.target.value);
                          updateStyleAndPersist((s) => ({ ...s, subtitle_color: e.target.value }));
                        }}
                        className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent"
                      />
                      <span className="font-mono text-xs text-cyan-300 uppercase font-geist">{highlightColor}</span>
                    </div>
                  </div>
                </div>

                {/* 3. ESTILO DE HEADLINE */}
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-wider text-cyan-400 font-geist">ESTILO DE HEADLINE (TÍTULO DE TOPO)</label>
                  <div className="rounded-2xl border border-white/10 bg-[#0E121E] p-5 space-y-4">
                    <input
                      type="text"
                      placeholder="Digite a sua headline de topo aqui (Ex: É ASSIM QUE VAI FICAR A SUA HEADLINE)..."
                      value={headlineText}
                      onChange={(e) => setHeadlineText(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white focus:border-cyan-400 focus:outline-none font-geist"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-cyan-400 bg-cyan-400/10 p-3 text-center font-jakarta font-black text-white text-xs uppercase tracking-wide">
                        {headlineText || "É ASSIM QUE VAI FICAR A SUA HEADLINE"}
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/60 p-3 text-center font-jakarta font-black text-cyan-300 text-xs uppercase tracking-wide">
                        {headlineText || "É ASSIM QUE VAI FICAR A SUA HEADLINE"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. ESTILO DE LEGENDA */}
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-wider text-cyan-400 font-geist">ESTILO DE LEGENDA</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { key: "andromeda" as SubtitleTheme, label: "⬛ Andromeda", bg: "bg-black text-white" },
                      { key: "energy" as SubtitleTheme, label: "⬜ Energy", bg: "bg-white text-black font-black" },
                      { key: "million" as SubtitleTheme, label: "💎 Million", bg: "bg-black/60 text-yellow-300 drop-shadow-md" },
                      { key: "minimal_white" as SubtitleTheme, label: "⚪ Limpo Minimal", bg: "bg-black/40 text-white" },
                    ].map((p) => (
                      <div
                        key={p.key}
                        onClick={() => applyPresetTheme(p.key)}
                        className={`cursor-pointer rounded-2xl border p-4 transition-all text-center ${
                          style.subtitle_theme === p.key
                            ? "border-cyan-400 bg-cyan-400/10 shadow-lg shadow-cyan-500/10 scale-[1.02]"
                            : "border-white/10 bg-[#0E121E] hover:border-white/20"
                        }`}
                      >
                        <div className={`mx-auto rounded-xl p-3 text-xs font-bold ${p.bg}`}>
                          É assim que sua legenda irá aparecer
                        </div>
                        <div className="mt-3 text-xs font-bold text-slate-300 font-geist">{p.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. ELEMENTOS DA EDIÇÃO */}
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-wider text-cyan-400 font-geist">ELEMENTOS DA EDIÇÃO</label>
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
                        className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition-all font-geist ${
                          item.active
                            ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200 shadow-lg shadow-cyan-500/10"
                            : "border-white/10 bg-[#0E121E] text-slate-400 hover:text-white"
                        }`}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${item.active ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-slate-500"}`}>
                          ✓
                        </span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 6. CONTROLES RIGOROSOS DE TEXTO */}
                <div className="rounded-2xl border border-white/10 bg-[#0E121E] p-6 space-y-4">
                  <label className="text-xs font-black uppercase tracking-wider text-cyan-400 font-geist">CONTROLES RIGOROSOS DE TEXTO</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <span className="block text-xs font-medium text-slate-400 mb-1.5 font-geist">Linhas da Legenda:</span>
                      <div className="grid grid-cols-2 gap-2">
                        {[1, 2].map((lines) => (
                          <button
                            key={lines}
                            onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_max_lines: lines }))}
                            className={`rounded-xl border py-2 text-xs font-bold transition font-geist ${
                              style.subtitle_max_lines === lines
                                ? "border-cyan-400 bg-cyan-400/20 text-cyan-300"
                                : "border-white/10 bg-black/40 text-slate-400 hover:text-white"
                            }`}
                          >
                            {lines} {lines === 1 ? "Linha (Exata)" : "Linhas (Máx 2)"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-slate-400 mb-1.5 font-geist">
                        <span>Letras por Linha:</span>
                        <span className="font-mono text-cyan-300 font-bold">{style.subtitle_max_chars_per_line || 25}</span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="45"
                        value={style.subtitle_max_chars_per_line || 25}
                        onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_max_chars_per_line: parseInt(e.target.value) }))}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-slate-400 mb-1.5 font-geist">
                        <span>Espaçamento de Letras:</span>
                        <span className="font-mono text-cyan-300 font-bold">{style.subtitle_letter_spacing || 0}px</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        value={style.subtitle_letter_spacing || 0}
                        onChange={(e) => updateStyleAndPersist((s) => ({ ...s, subtitle_letter_spacing: parseInt(e.target.value) }))}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                  <button onClick={() => setActiveTab("visual")} className="btn-primary btn-pill px-8 text-sm font-bold">
                    Aprovar Estilo & Ir para Exportar →
                  </button>
                </div>
              </div>
            )}

            {/* 🎬 FASE 3 — VISUAL & EXPORTAR TAB */}
            {activeTab === "visual" && (
              <div className="space-y-6 animate-in">
                <div className="rounded-2xl border border-white/10 bg-[#0E121E] p-6 space-y-5 shadow-2xl">
                  <h3 className="text-lg font-black text-white font-jakarta">🎬 Exportação Final</h3>
                  <p className="text-xs text-slate-400 font-geist">
                    Revise todas as configurações e gere seu vídeo final em resolução vertical 1080x1920 30FPS.
                  </p>

                  <div className="space-y-2 rounded-xl bg-black/40 p-4 border border-white/5 text-xs text-slate-300 font-geist">
                    <div className="flex justify-between">
                      <span>Layout:</span>
                      <span className="font-bold text-cyan-400">{style.layout === "fullscreen" ? "Tela Cheia 1080x1920" : "Split 50/50"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tema Legenda:</span>
                      <span className="font-bold text-cyan-400 uppercase">{style.subtitle_theme}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Formato Linhas:</span>
                      <span className="font-bold text-cyan-400">{style.subtitle_max_lines === 1 ? "1 Linha Exata" : "Máximo 2 Linhas"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Animação Karaoke:</span>
                      <span className="font-bold text-emerald-400">{style.subtitle_animated ? "🌟 Ativa" : "Desativada"}</span>
                    </div>
                  </div>

                  <button onClick={handleRender} disabled={!isCleanReady || isRendering} className="btn-primary btn-pill w-full py-4 text-base font-black">
                    {isRendering ? "🎬 Renderizando Vídeo Final..." : "🚀 Exportar Vídeo Final"}
                  </button>

                  {renderError && <p className="text-xs text-rose-400 font-geist">⚠️ {renderError}</p>}

                  {job.final_video_url && (
                    <a
                      href={getVideoUrl(job.final_video_url)}
                      download
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 py-3.5 text-sm font-black text-slate-950 shadow-xl transition hover:bg-emerald-300 font-jakarta"
                    >
                      ⬇️ Baixar Vídeo Final (1080x1920)
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ═══════════ RIGHT COLUMN: PLAYER DE PRÉVIA 9:16 PERMANENTE EM TODAS AS FASES ═══════════ */}
          <div className="sticky top-16 space-y-3">
            <div className="glass-panel overflow-hidden p-3 flex flex-col items-center justify-center shadow-2xl max-h-[calc(100vh-100px)]">
              <div className="mb-2 w-full flex items-center justify-between text-[11px] text-slate-400 font-geist">
                <span>📱 Prévia Ao Vivo 9:16</span>
                <span className="text-cyan-400 font-bold">
                  {isPlaying ? "▶ Tocando" : "⏸ Pausado"}
                </span>
              </div>

              <div
                ref={videoContainerRef}
                onMouseMove={handleContainerMouseMove}
                className="relative mx-auto aspect-[9/16] h-[450px] max-h-[calc(100vh-160px)] w-auto overflow-hidden rounded-[1.75rem] bg-black shadow-2xl select-none border border-white/10"
              >
                {/* Headline Overlay Option */}
                {headlineText && (
                  <div className="absolute top-4 left-4 right-4 z-30 rounded-xl bg-black/80 p-2 text-center font-jakarta text-[10px] font-black text-white uppercase tracking-wider border border-cyan-400/40 shadow-lg">
                    {headlineText}
                  </div>
                )}

                {style.layout === "split_screen" ? (
                  <div className="flex h-full w-full flex-col">
                    {/* Top Media */}
                    <div className="relative h-1/2 w-full overflow-hidden bg-slate-900">
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
                          className="h-full w-full object-cover transition-transform duration-500 ease-out"
                          style={{
                            filter: cssGradeFilter,
                            transform: `scale(${currentZoomScale})`,
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
                    <video
                      ref={videoRef}
                      key={currentVideoPath}
                      src={getVideoUrl(currentVideoPath)}
                      controls
                      onPlay={handlePlay}
                      onPause={handlePause}
                      onTimeUpdate={handleTimeUpdate}
                      onError={handleVideoError}
                      className="h-full w-full object-cover transition-transform duration-500 ease-out"
                      style={{
                        filter: cssGradeFilter,
                        transform: `scale(${currentZoomScale})`,
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-500">
                      {videoError ? <span className="text-rose-400 px-3 text-center">⚠️ {videoError}</span> : <>Carregando vídeo...</>}
                    </div>
                  )
                )}

                {/* Subtitle Overlay */}
                {style.subtitle_style === "basic" && activeSub && (
                  <div
                    onMouseDown={handleSubMouseDown}
                    className={`absolute cursor-move select-none -translate-x-1/2 -translate-y-1/2 transition-shadow z-20 ${
                      isDraggingSub ? "ring-2 ring-cyan-400 scale-105" : "hover:ring-1 hover:ring-white/40"
                    }`}
                    style={{
                      left: `${style.subtitle_x_percent}%`,
                      top: `${style.subtitle_y_percent}%`,
                    }}
                  >
                    <span
                      className="inline-block rounded-lg px-3.5 py-1.5 font-bold text-center leading-snug max-w-[270px] whitespace-pre-line"
                      style={{
                        fontSize: `${Math.max(10, style.subtitle_font_size / 5)}px`,
                        color: style.subtitle_color,
                        backgroundColor: style.subtitle_bg_color !== "transparent" && style.subtitle_bg_color !== "none" && style.subtitle_bg_color !== "" ? style.subtitle_bg_color : "transparent",
                        letterSpacing: `${style.subtitle_letter_spacing || 0}px`,
                        fontFamily:
                          style.subtitle_font === "Bebas Neue" ? "'Bebas Neue', sans-serif"
                          : style.subtitle_font === "Montserrat" ? "'Montserrat', sans-serif"
                          : style.subtitle_font === "Impact" ? "Impact, sans-serif"
                          : "'Inter', sans-serif",
                        WebkitTextStroke: style.subtitle_outline_enabled ? `1.2px ${style.subtitle_outline_color}` : "none",
                        filter: style.subtitle_shadow_enabled ? "drop-shadow(0 3px 6px rgba(0,0,0,0.95))" : "none",
                        boxShadow: "none",
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

function formatTimeExact(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}
