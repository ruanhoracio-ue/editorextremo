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

  const [isDraggingSub, setIsDraggingSub] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const topVideoRef = useRef<HTMLVideoElement>(null);
  const gradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitInputRef = useRef<HTMLInputElement>(null);
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

    // Eagerly load cuts/transcript if empty (so user sees something while processing)
    if (job.cuts && localCuts.length === 0) setLocalCuts(job.cuts);
    if (job.transcript && localTranscript.length === 0) setLocalTranscript(job.transcript);

    // Force sync when job finishes its initial pipeline or a reprocess
    if (isJobFinished) {
      if (!hasInitialSyncedFinishedJob.current || isReprocessing) {
        if (job.cuts) setLocalCuts(job.cuts);
        if (job.transcript) setLocalTranscript(job.transcript);
        hasInitialSyncedFinishedJob.current = true;
        setIsReprocessing(false);
      }
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
  const isSegmentZoomed = style.zoom_enabled && zoomIndex !== -1 && zoomIndex % 2 === 1;
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

  const handleUpdateCutSegment = useCallback(
    (updatedCuts: CutSegment[]) => {
      setLocalCuts(updatedCuts);
      setIsReprocessing(true);

      if (cutTimer.current) clearTimeout(cutTimer.current);
      cutTimer.current = setTimeout(async () => {
        try {
          await updateCuts(jobId, updatedCuts);
        } catch {
          setIsReprocessing(false);
        }
      }, 700);
    },
    [jobId]
  );

  const handleToggleCut = useCallback(
    async (index: number) => {
      const updated = localCuts.map((c, i) =>
        i === index ? { ...c, enabled: !c.enabled } : c
      );
      handleUpdateCutSegment(updated);
    },
    [localCuts, handleUpdateCutSegment]
  );

  const handleSegmentTimeChange = useCallback(
    (index: number, field: "start" | "end", val: number) => {
      if (localCuts.length === 0) return;
      const newCuts = localCuts.map((c) => ({ ...c }));
      const seg = newCuts[index];
      if (!seg) return;

      const maxDuration = job?.original_duration || job?.clean_duration || 1;

      if (field === "start") {
        const minStart = index > 0 ? newCuts[index - 1].end : 0;
        const maxStart = seg.end - 0.1;
        const clamped = Math.max(minStart, Math.min(val, maxStart));
        newCuts[index].start = Math.round(clamped * 100) / 100;
      } else {
        const minEnd = seg.start + 0.1;
        const maxEnd = index < newCuts.length - 1 ? newCuts[index + 1].start : maxDuration;
        const clamped = Math.max(minEnd, Math.min(val, maxEnd));
        newCuts[index].end = Math.round(clamped * 100) / 100;
      }
      handleUpdateCutSegment(newCuts);
    },
    [localCuts, job?.original_duration, job?.clean_duration, handleUpdateCutSegment]
  );

  const setStartAtCurrentTime = () => {
    if (localCuts.length === 0) return;
    const newStart = Math.max(0, Math.min(currentTime, (localCuts[0]?.end || 1) - 0.1));
    handleSegmentTimeChange(0, "start", newStart);
  };

  const setEndAtCurrentTime = () => {
    if (localCuts.length === 0) return;
    const lastIdx = localCuts.length - 1;
    const maxDur = job?.original_duration || job?.clean_duration || 1;
    const newEnd = Math.min(maxDur, Math.max((localCuts[lastIdx]?.start || 0) + 0.1, currentTime));
    handleSegmentTimeChange(lastIdx, "end", newEnd);
  };

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

  const handleRemoveCutSegment = (index: number) => {
    if (localCuts.length <= 1) return;
    const updated = localCuts.filter((_, i) => i !== index);
    handleUpdateCutSegment(updated);
  };

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
      if (lineWords.some(w => currentTime >= w.start && currentTime <= w.end)) {
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
        : animStyle === "neon_cyan"
        ? "text-emerald-300 drop-shadow-[0_2px_10px_rgba(16,185,129,0.9)] scale-110 font-bold"
        : animStyle === "box_primary"
        ? "text-emerald-300 drop-shadow-[0_2px_10px_rgba(52,211,153,0.9)] scale-110 font-black"
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
            const isWordActive = currentTime >= wObj.start && currentTime <= wObj.end;
            return (
              <span
                key={wIdx}
                className={`inline-block transition-all duration-150 ${
                  isWordActive ? activeColorClass : "opacity-80"
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
  const currentVideoPath = job.clean_video_url || job.final_video_url || "";

  const cg = style.color_grade || DEFAULT_STYLE_OPTIONS.color_grade;
  const cssGradeFilter = `contrast(${Math.round((cg.contrast ?? 1.0) * 100)}%) saturate(${Math.round((cg.saturation ?? 1.0) * 100)}%) brightness(${Math.round((cg.brightness ?? 1.0) * 100)}%) sepia(${Math.max(0, Math.round((cg.warmth ?? 0) * 50))}%)`;
  const framingYPercent = style.split_screen_framing_y ?? 50.0;
  const framingYBottomPercent = style.split_screen_framing_y_bottom ?? 50.0;

  const segmentBadges = ["HOOK", "DINÂMICA", "RECURSOS", "CONTEÚDO", "CTA"];

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#fafafa] font-sans" onMouseUp={handleMouseUp}>
      {/* ═══════════ HEADER COM FASES E STATUS ═══════════ */}
      <header className="sticky top-0 z-40 border-b border-[#262626] bg-[#0a0a0a]/90 backdrop-blur-md px-6 py-3.5">
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
          <div className="flex items-center rounded-full bg-[#171717] p-1 border border-[#262626]">
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
              onClick={() => setActiveTab("estilo")}
              className={`flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "estilo"
                  ? "bg-brand-gradient text-[#0a0a0a] shadow-lg shadow-emerald-500/20 scale-[1.02]"
                  : "text-[#a8a8a8] hover:text-white hover:bg-white/5"
              }`}
            >
              <span>🎨</span> Estilo
            </button>
            <button
              onClick={() => setActiveTab("visual")}
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
            <p className="text-rose-300/90">{job.error_message || "Erro desconhecido no backend. Tente enviar o vídeo novamente."}</p>
          </div>
        )}
        {!isCleanReady && job.status !== "error" && (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <div className="mb-2 flex items-center gap-2 font-bold">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
              {STATUS_LABEL[job.status] || "Processando"} — {job.progress || 0}%
            </div>
            <div className="h-2 w-full max-w-xl overflow-hidden rounded-full bg-black/40 border border-[#262626]">
              <div className="h-full bg-brand-gradient transition-all duration-300" style={{ width: `${job.progress || 0}%` }} />
            </div>
            <p className="mt-2 text-xs text-emerald-200/80">
              O vídeo editado aparecerá automaticamente assim que a inteligência concluir o corte.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start w-full min-w-0">
          {/* ═══════════ LEFT COLUMN (PAINEL DA FASE ATIVA) ═══════════ */}
          <div className="space-y-6 min-w-0 w-full">
            {/* ✂️ FASE 1 — CORTE TAB */}
            {activeTab === "corte" && (
              <div className="space-y-6 animate-in">
                {/* Control Bar: Timecode, Play, Zoom, Fit */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#262626] bg-[#171717] p-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlayPause}
                      className="shiny-cta h-10 w-10 text-base font-bold text-white shadow-lg"
                    >
                      <span className="shiny-dots" aria-hidden="true" />
                      <span className="shiny-cta-content">{isPlaying ? "⏸" : "▶"}</span>
                    </button>
                    <div className="font-mono text-xs text-[#fafafa] font-semibold bg-[#0a0a0a] px-3 py-1.5 rounded-lg border border-[#262626]">
                      {formatTime(currentTime)} / {formatTime(totalDuration)}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#a8a8a8] font-medium">Zoom</span>
                      <input
                        type="range"
                        min="50"
                        max="200"
                        value={zoomLevel}
                        onChange={(e) => setZoomLevel(parseInt(e.target.value))}
                        className="w-28 accent-emerald-400 cursor-pointer"
                      />
                    </div>
                    <button
                      onClick={() => setZoomLevel(100)}
                      className="rounded-xl border border-[#262626] bg-[#171717] px-3 py-1.5 text-xs font-semibold text-[#a8a8a8] transition hover:bg-[#262626] hover:text-white"
                    >
                      Fit
                    </button>
                  </div>
                </div>

                {/* ✂️ PAINEL DE CORTE MANUAL DO INÍCIO & FINAL */}
                <div className="rounded-2xl border border-emerald-500/30 bg-[#171717] p-5 shadow-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262626] pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>✂️</span> Corte Manual do Início & Final
                      </h3>
                      <p className="text-[11px] text-[#a8a8a8]">
                        Ajuste com precisão onde o vídeo deve começar e terminar, ou use o tempo atual do player.
                      </p>
                    </div>
                    {isReprocessing && (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 animate-pulse">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        Reprocessando cortes...
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* CORTE INICIAL */}
                    <div className="rounded-xl border border-[#262626] bg-[#0a0a0a] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          🟢 Início do Vídeo (Corte Inicial)
                        </span>
                        <span className="font-mono text-sm font-bold text-white">
                          {localCuts[0] ? `${localCuts[0].start.toFixed(2)}s` : "0.00s"}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max={localCuts[0] ? Math.max(0, localCuts[0].end - 0.1) : 100}
                          value={localCuts[0] ? localCuts[0].start : 0}
                          onChange={(e) => handleSegmentTimeChange(0, "start", parseFloat(e.target.value) || 0)}
                          className="w-24 rounded-lg border border-[#262626] bg-[#171717] px-3 py-1.5 font-mono text-xs text-white focus:border-emerald-400 focus:outline-none"
                        />
                        <input
                          type="range"
                          min="0"
                          max={localCuts[0] ? Math.max(0, localCuts[0].end - 0.1) : 100}
                          step="0.05"
                          value={localCuts[0] ? localCuts[0].start : 0}
                          onChange={(e) => handleSegmentTimeChange(0, "start", parseFloat(e.target.value) || 0)}
                          className="flex-1 accent-emerald-400 cursor-pointer"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={() => handleSegmentTimeChange(0, "start", (localCuts[0]?.start || 0) - 0.5)}
                          className="rounded-lg border border-[#262626] bg-[#171717] px-2.5 py-1 text-[11px] font-bold text-[#a8a8a8] hover:text-white hover:border-emerald-500/40"
                        >
                          -0.5s
                        </button>
                        <button
                          onClick={() => handleSegmentTimeChange(0, "start", (localCuts[0]?.start || 0) + 0.5)}
                          className="rounded-lg border border-[#262626] bg-[#171717] px-2.5 py-1 text-[11px] font-bold text-[#a8a8a8] hover:text-white hover:border-emerald-500/40"
                        >
                          +0.5s
                        </button>
                        <button
                          onClick={setStartAtCurrentTime}
                          className="shiny-cta px-3 py-1 text-[11px] font-bold text-white rounded-lg ml-auto"
                        >
                          <span className="shiny-cta-content">📍 Cortar Início no Player ({formatTime(currentTime)})</span>
                        </button>
                      </div>
                    </div>

                    {/* CORTE FINAL */}
                    <div className="rounded-xl border border-[#262626] bg-[#0a0a0a] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          🔴 Fim do Vídeo (Corte Final)
                        </span>
                        <span className="font-mono text-sm font-bold text-white">
                          {localCuts.length > 0 ? `${localCuts[localCuts.length - 1].end.toFixed(2)}s` : `${totalDuration.toFixed(2)}s`}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          step="0.1"
                          min={localCuts.length > 0 ? localCuts[localCuts.length - 1].start + 0.1 : 0}
                          max={job?.original_duration || totalDuration}
                          value={localCuts.length > 0 ? localCuts[localCuts.length - 1].end : totalDuration}
                          onChange={(e) => handleSegmentTimeChange(localCuts.length - 1, "end", parseFloat(e.target.value) || 0)}
                          className="w-24 rounded-lg border border-[#262626] bg-[#171717] px-3 py-1.5 font-mono text-xs text-white focus:border-emerald-400 focus:outline-none"
                        />
                        <input
                          type="range"
                          min={localCuts.length > 0 ? localCuts[localCuts.length - 1].start + 0.1 : 0}
                          max={job?.original_duration || totalDuration}
                          step="0.05"
                          value={localCuts.length > 0 ? localCuts[localCuts.length - 1].end : totalDuration}
                          onChange={(e) => handleSegmentTimeChange(localCuts.length - 1, "end", parseFloat(e.target.value) || 0)}
                          className="flex-1 accent-emerald-400 cursor-pointer"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={() => handleSegmentTimeChange(localCuts.length - 1, "end", (localCuts[localCuts.length - 1]?.end || 0) - 0.5)}
                          className="rounded-lg border border-[#262626] bg-[#171717] px-2.5 py-1 text-[11px] font-bold text-[#a8a8a8] hover:text-white hover:border-emerald-500/40"
                        >
                          -0.5s
                        </button>
                        <button
                          onClick={() => handleSegmentTimeChange(localCuts.length - 1, "end", (localCuts[localCuts.length - 1]?.end || 0) + 0.5)}
                          className="rounded-lg border border-[#262626] bg-[#171717] px-2.5 py-1 text-[11px] font-bold text-[#a8a8a8] hover:text-white hover:border-emerald-500/40"
                        >
                          +0.5s
                        </button>
                        <button
                          onClick={setEndAtCurrentTime}
                          className="shiny-cta px-3 py-1 text-[11px] font-bold text-white rounded-lg ml-auto"
                        >
                          <span className="shiny-cta-content">📍 Cortar Fim no Player ({formatTime(currentTime)})</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* TIMELINE PRO COM RULER, CUT BLOCKS E WAVEFORM AUDIO */}
                <div className="rounded-2xl border border-[#262626] bg-[#171717] p-6 shadow-2xl overflow-hidden min-w-0 w-full">
                  <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#a8a8a8]">
                    <span>🎞️ Linha do Tempo & Cortes Inteligentes</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleAddManualCut}
                        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                      >
                        ✂️ Split no Player ({formatTime(currentTime)})
                      </button>
                      <span className="text-emerald-400 font-mono">{formatDuration(totalDuration)} total</span>
                    </div>
                  </div>

                  <div className="relative w-full overflow-x-auto select-none py-2 min-w-0">
                    <div className="min-w-[700px] relative">
                      {/* Ruler Bar */}
                      <div className="flex h-6 w-full items-end justify-between border-b border-[#262626] pb-1 text-[10px] font-mono text-[#737373]">
                        {Array.from({ length: 9 }).map((_, i) => (
                          <span key={i}>{((totalDuration / 8) * i).toFixed(2)}s</span>
                        ))}
                      </div>

                      {/* Video Cut Blocks Track */}
                      <div className="relative mt-3 h-20 w-full rounded-xl bg-[#0a0a0a] border border-[#262626] overflow-hidden flex gap-1 p-1">
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
                                <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider text-emerald-400">
                                  {badgeLabel} #{i + 1}
                                </span>
                                <span className="text-[9px] font-mono text-slate-400">{(cut.end - cut.start).toFixed(1)}s</span>
                              </div>
                              <div className="text-[10px] font-bold text-white truncate">
                                {localTranscript[i]?.text || `Segmento ${i + 1}`}
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
                              className="w-[2px] rounded-full bg-gradient-to-t from-emerald-500 to-emerald-300 opacity-80"
                              style={{ height: `${h}px` }}
                            />
                          );
                        })}
                      </div>

                      {/* Bright Emerald Playhead Bar */}
                      <div
                        className="absolute top-0 bottom-0 w-[3px] bg-emerald-400 z-30 pointer-events-none transition-all shadow-[0_0_12px_#10b981]"
                        style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                      >
                        <div className="h-0 w-0 border-x-[6px] border-x-transparent border-t-[8px] border-t-emerald-400 -ml-[4.5px] -mt-1" />
                      </div>
                    </div>
                  </div>

                  {/* Banner */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0a0a0a] p-3 border border-[#262626] text-xs text-[#a8a8a8]">
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
                        <div key={i} className="rounded-xl border border-[#262626] bg-[#0a0a0a]/60 p-3 hover:border-emerald-500/30">
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
                            className="w-full rounded-lg border border-[#262626] bg-[#171717] px-3 py-1.5 text-sm text-[#fafafa] focus:border-emerald-400 focus:outline-none"
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
                  <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">TIPO DE EDIÇÃO</label>
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
                            ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 scale-[1.02]"
                            : "border-[#262626] bg-[#171717] hover:border-[#404040]"
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
                    <div className="mt-3 rounded-2xl border border-[#262626] bg-[#171717] p-4 space-y-4">
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
                      <div className="pt-3 border-t border-[#262626] space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">🎬 Sugestões de B-Roll IA</span>
                            <p className="text-[10px] text-slate-400 font-geist">Escolha mídias temáticas para os momentos chave do vídeo</p>
                          </div>
                          <button onClick={handleFetchSuggestions} disabled={loadingSuggestions} className="shiny-cta px-3 py-1.5 text-xs font-bold whitespace-nowrap">
                            <span className="shiny-cta-content text-white">{loadingSuggestions ? "🔄 Analisando..." : "🤖 Sugerir B-Rolls IA"}</span>
                          </button>
                        </div>

                        {brollSuggestions.length > 0 && (
                          <div className="space-y-3 pt-2">
                            {brollSuggestions.map((sugg) => (
                              <div key={sugg.id} className="rounded-xl border border-[#262626] bg-[#0a0a0a] p-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-mono font-bold text-emerald-400">⏱️ {formatTime(sugg.start)} - {formatTime(sugg.end)}</span>
                                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-md font-bold">{sugg.keyword}</span>
                                </div>
                                <p className="text-xs text-slate-300 italic bg-[#171717] p-2 rounded-lg border border-[#262626]">"{sugg.context_text}"</p>

                                {/* Opções de Mídias */}
                                <div className="grid grid-cols-3 gap-2 pt-1">
                                  {sugg.options.map((opt, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => handleActionSuggestion(sugg.id, opt.url, "accept")}
                                      className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-all ${
                                        sugg.accepted_url === opt.url ? "border-emerald-400 ring-2 ring-emerald-500/40" : "border-[#262626] hover:border-emerald-500/50"
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
                  <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">COR DE DESTAQUE</label>
                  <div className="flex items-center gap-4 rounded-2xl border border-[#262626] bg-[#171717] p-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={highlightColor}
                        onChange={(e) => {
                          setHighlightColor(e.target.value);
                          updateStyleAndPersist((s) => ({ ...s, subtitle_color: e.target.value }));
                        }}
                        className="h-10 w-10 cursor-pointer rounded-xl border border-[#262626] bg-transparent p-0.5"
                      />
                      <div>
                        <span className="block text-[11px] font-medium text-[#a8a8a8]">Seletor Geral de Cor:</span>
                        <span className="font-mono text-sm font-bold text-emerald-400 uppercase">{highlightColor}</span>
                      </div>
                    </div>
                  </div>
                </div>



                {/* 4. ESTILO DE LEGENDA */}
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">ESTILO DE LEGENDA</label>
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
                            ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 scale-[1.02]"
                            : "border-[#262626] bg-[#171717] hover:border-[#404040]"
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
                  <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">ELEMENTOS DA EDIÇÃO</label>
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
                            ? "border-emerald-400 bg-emerald-500/10 text-emerald-300 shadow-lg shadow-emerald-500/10"
                            : "border-[#262626] bg-[#171717] text-[#a8a8a8] hover:text-white"
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
                <div className="rounded-2xl border border-[#262626] bg-[#171717] p-6 space-y-5">
                  <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">CONTROLES DE LEGENDA & TIPOGRAFIA LIMPA</label>
                  
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
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-md shadow-emerald-500/10"
                              : "border-[#262626] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
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
                        { id: "neon_cyan", label: "🟢 Neon Esmeralda" },
                        { id: "box_primary", label: "🔲 Caixa de Texto" },
                      ].map((anim) => (
                        <button
                          key={anim.id}
                          onClick={() => updateStyleAndPersist((s) => ({ ...s, subtitle_animated: true, subtitle_animation_style: anim.id }))}
                          className={`rounded-xl border py-2 px-3 text-xs font-bold transition ${
                            style.subtitle_animated && (style.subtitle_animation_style || "bounce_yellow") === anim.id
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-[#262626] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
                          }`}
                        >
                          {anim.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Controles de Traçado (Stroke) e Sombra Projetada */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#262626]">
                    {/* Painel de Traçado (Outline) */}
                    <div className="space-y-3 rounded-xl bg-[#0a0a0a] p-4 border border-[#262626]">
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
                                : "border-[#262626] bg-[#171717] text-[#737373] hover:text-white"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {style.subtitle_outline_enabled && (
                        <div className="space-y-3 pt-2 border-t border-[#262626]">
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
                              className="h-7 w-12 cursor-pointer rounded border border-[#262626] bg-transparent p-0"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Painel de Sombra Projetada (Drop Shadow) */}
                    <div className="space-y-3 rounded-xl bg-[#0a0a0a] p-4 border border-[#262626]">
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
                                : "border-[#262626] bg-[#171717] text-[#737373] hover:text-white"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {style.subtitle_shadow_enabled && (
                        <div className="space-y-3 pt-2 border-t border-[#262626]">
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
                              className="h-7 w-12 cursor-pointer rounded border border-[#262626] bg-transparent p-0"
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
                                : "border-[#262626] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
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
                <div className="rounded-2xl border border-[#262626] bg-[#171717] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">🎨 COLOR GRADING & TRATAMENTO DE IMAGEM</label>
                    <div className="flex gap-2">
                      {[
                        { label: "Vívido", grade: { contrast: 1.25, saturation: 1.35, brightness: 1.05, warmth: 0.0 } },
                        { label: "Cinema", grade: { contrast: 1.3, saturation: 0.9, brightness: 1.0, warmth: 0.15 } },
                        { label: "P&B", grade: { contrast: 1.3, saturation: 0.0, brightness: 1.0, warmth: 0.0 } },
                        { label: "Natural", grade: { contrast: 1.0, saturation: 1.0, brightness: 1.0, warmth: 0.0 } },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => {
                            Object.entries(preset.grade).forEach(([k, v]) => handleGradeChange(k as any, v));
                          }}
                          className="rounded-lg border border-[#262626] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-bold text-[#a8a8a8] hover:text-emerald-300"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
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

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1">
                        <span>Intensidade Geral:</span>
                        <span className="font-mono text-emerald-400 font-bold">{Math.round((style.color_grade?.intensity ?? 1.0) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="2.0"
                        step="0.05"
                        value={style.color_grade?.intensity ?? 1.0}
                        onChange={(e) => handleGradeChange("intensity", parseFloat(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-[#a8a8a8] mb-1">
                        <span>Nitidez (Sharpness):</span>
                        <span className="font-mono text-emerald-400 font-bold">{Math.round((style.color_grade?.sharpness ?? 0.0) * 100)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="2.0"
                        step="0.05"
                        value={style.color_grade?.sharpness ?? 0.0}
                        onChange={(e) => handleGradeChange("sharpness", parseFloat(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* 8. ADAPTAÇÃO DE FORMATO DE VÍDEO & SELEÇÃO DE EXPORTAÇÃO MULTI-FORMATO */}
                <div className="rounded-2xl border border-[#262626] bg-[#171717] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-emerald-400">📐 ADAPTAÇÃO DE FORMATOS DE VÍDEO</label>
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
                              ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 scale-[1.02]"
                              : "border-[#262626] bg-[#0a0a0a] text-[#a8a8a8] hover:text-white"
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

                <div className="flex justify-end gap-3 pt-4 border-t border-[#262626]">
                  <button onClick={() => setActiveTab("visual")} className="shiny-cta px-8 py-3 text-xs font-bold">
                    <span className="shiny-dots" aria-hidden="true" />
                    <span className="shiny-cta-content text-white">Aprovar Estilo & Ir para Exportar →</span>
                  </button>
                </div>
              </div>
            )}

            {/* 🎬 FASE 3 — VISUAL & EXPORTAR TAB */}
            {activeTab === "visual" && (
              <div className="space-y-6 animate-in">
                <div className="rounded-2xl border border-[#262626] bg-[#171717] p-6 space-y-5 shadow-2xl">
                  <h3 className="text-lg font-bold text-white">🎬 Exportação Final</h3>
                  <p className="text-xs text-[#a8a8a8]">
                    Revise todas as configurações e gere seu vídeo final de alta conversão.
                  </p>

                  <div className="space-y-2.5 rounded-xl bg-[#0a0a0a] p-4 border border-[#262626] text-xs text-[#a8a8a8]">
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
                    className="shiny-cta w-full py-4 text-base font-bold"
                  >
                    <span className="shiny-dots" aria-hidden="true" />
                    <span className="shiny-cta-content text-white">
                      {isRendering
                        ? "⚡ Renderizando Vídeos em Lote..."
                        : `🚀 Exportar Todos os Formatos (${selectedExportFormats.length}) em Lote →`}
                    </span>
                  </button>

                  {renderError && <p className="text-xs text-rose-400">⚠️ {renderError}</p>}

                  {/* Batch Download Cards */}
                  {job.batch_videos && Object.keys(job.batch_videos).length > 0 && (
                    <div className="space-y-3 pt-3 border-t border-[#262626]">
                      <span className="block text-xs font-bold text-emerald-400 uppercase tracking-wider">
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
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient py-3.5 text-sm font-extrabold text-[#0a0a0a] shadow-xl hover:opacity-90 transition mt-2"
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
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient py-3.5 text-sm font-extrabold text-[#0a0a0a] shadow-xl hover:opacity-90 transition"
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
            <div className="glass-panel overflow-hidden p-3 flex flex-col items-center justify-center shadow-2xl max-h-[calc(100vh-100px)]">
              <div className="mb-2 w-full flex items-center justify-between text-[11px] text-[#a8a8a8]">
                <span>📱 Prévia Ao Vivo 9:16</span>
                <span className="text-emerald-400 font-bold">
                  {isPlaying ? "▶ Tocando" : "⏸ Pausado"}
                </span>
              </div>

              <div
                ref={videoContainerRef}
                onMouseMove={handleContainerMouseMove}
                className={`relative mx-auto max-h-[calc(100vh-160px)] w-auto overflow-hidden rounded-[1.75rem] bg-black shadow-2xl select-none border border-white/10 transition-all ${
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
                    <div className="relative h-1/2 w-full overflow-hidden bg-[#171717]">
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
                            transform: `scale(${currentZoomScale})`,
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
                        letterSpacing: `${style.subtitle_letter_spacing || 0}px`,
                        fontFamily:
                          style.subtitle_font === "TikTok Medium" ? "'Proxima Nova', 'TikTok Display', sans-serif"
                          : style.subtitle_font === "Helvetica" ? "'Helvetica Neue', Helvetica, Arial, sans-serif"
                          : style.subtitle_font === "Montserrat" ? "'Montserrat', sans-serif"
                          : style.subtitle_font === "Lato" ? "'Lato', sans-serif"
                          : style.subtitle_font === "The Bold Font" ? "'Anton', sans-serif"
                          : style.subtitle_font === "Bebas Neue" ? "'Bebas Neue', sans-serif"
                          : "'Inter', sans-serif",
                        textShadow: style.subtitle_outline_enabled ? buildExternalOutline(style.subtitle_outline_width || 2, style.subtitle_outline_color || "#000000") : "none",
                        filter: style.subtitle_shadow_enabled ? `drop-shadow(0 ${style.subtitle_shadow_offset || 4}px ${style.subtitle_shadow_offset || 4}px ${style.subtitle_shadow_color || "rgba(0,0,0,0.9)"})` : "none",
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
  const d = Math.max(1, Math.round(width / 2));
  const c = color;
  return [
    `${d}px ${d}px 0 ${c}`,
    `${-d}px ${d}px 0 ${c}`,
    `${d}px -${d}px 0 ${c}`,
    `${-d}px -${d}px 0 ${c}`,
    `0 ${d}px 0 ${c}`,
    `0 -${d}px 0 ${c}`,
    `${d}px 0 0 ${c}`,
    `-${d}px 0 0 ${c}`,
  ].join(", ");
}

function formatTimeExact(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}
