"""Cut detector module — exact sample-accurate FFmpeg cuts and transcript synchronization."""

from __future__ import annotations

import os
import subprocess
import shutil
from typing import List, Tuple, Optional

from app.models.schemas import CutSegment, SilenceRange, TranscriptSegment, TranscriptWord


SILENCE_THRESHOLD_DB = -28  # dB
MIN_SILENCE_DURATION = 0.20  # seconds
MIN_SPEECH_DURATION = 0.10   # seconds


def get_ffmpeg_binary() -> str:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def get_video_duration(video_path: str) -> float:
    """Get exact duration of video in seconds.

    Tries ffprobe first, then falls back to parsing ffmpeg's stderr (which is
    available when only imageio-ffmpeg ships the ffmpeg binary and no ffprobe
    is installed). Never silently returns a hardcoded default, because a wrong
    duration clips keep segments and truncates captions mid-video.
    """
    ffprobe_exe = shutil.which("ffprobe") or "ffprobe"
    if shutil.which("ffprobe"):
        try:
            cmd = [
                ffprobe_exe, "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
            val = res.stdout.strip()
            if val:
                return float(val)
        except Exception:
            pass

    # Fallback: ask ffmpeg directly for container duration.
    ffmpeg_exe = get_ffmpeg_binary()
    try:
        res = subprocess.run(
            [ffmpeg_exe, "-i", video_path],
            capture_output=True, text=True, timeout=120,
        )
        output = res.stderr
        for line in output.splitlines():
            if "Duration:" not in line:
                continue
            # e.g. "  Duration: 00:00:20.42, start: ..."
            tok = line.split("Duration:")[1].strip().split(",")[0].strip()
            h, m, s = tok.split(":")
            duration = int(h) * 3600 + int(m) * 60 + float(s)
            if duration > 0:
                return round(duration, 3)
    except Exception:
        pass

    raise RuntimeError(f"Falha ao obter duração do vídeo: {video_path}")


def detect_silence_ranges(
    video_path: str,
    noise_threshold_db: float = SILENCE_THRESHOLD_DB,
    min_silence_duration: float = MIN_SILENCE_DURATION,
) -> List[SilenceRange]:
    """Detect silence/breath ranges in audio using FFmpeg silencedetect."""
    ffmpeg_exe = get_ffmpeg_binary()
    cmd = [
        ffmpeg_exe, "-i", video_path,
        "-af", f"silencedetect=noise={noise_threshold_db}dB:d={min_silence_duration}",
        "-f", "null", "-"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        output = res.stderr
    except Exception:
        return []

    silences: List[SilenceRange] = []
    current_start = None

    for line in output.splitlines():
        if "silence_start:" in line:
            try:
                current_start = float(line.split("silence_start:")[1].split()[0])
            except (IndexError, ValueError):
                pass
        elif "silence_end:" in line and current_start is not None:
            try:
                parts = line.split("silence_end:")[1].split()
                end_time = float(parts[0])
                duration = float(line.split("silence_duration:")[1].split()[0]) if "silence_duration:" in line else round(end_time - current_start, 3)
                silences.append(SilenceRange(start=current_start, end=end_time, duration=duration))
                current_start = None
            except (IndexError, ValueError):
                pass

    return silences


def compute_keep_segments(
    video_path: str,
    transcript: List[TranscriptSegment],
    silences: Optional[List[SilenceRange]] = None,
    cut_margin: float = 0.05,
) -> Tuple[List[CutSegment], List[SilenceRange]]:
    """
    Compute keep segments based on speech word timestamps and silence gaps.
    Cuts happen in breath/silence gaps (> 0.20s) between spoken words.
    """
    total_duration = get_video_duration(video_path)

    if silences is None:
        silences = detect_silence_ranges(video_path)

    all_words: List[TranscriptWord] = []
    for seg in transcript:
        all_words.extend(seg.words)

    if not all_words:
        # Fallback to silence ranges if no words
        if not silences:
            return [CutSegment(start=0.0, end=total_duration, enabled=True)], []

        keep: List[CutSegment] = []
        prev = 0.0
        for s in silences:
            if s.start > prev + MIN_SPEECH_DURATION:
                keep.append(CutSegment(start=round(prev, 3), end=round(s.start, 3), enabled=True))
            prev = s.end
        if prev < total_duration - MIN_SPEECH_DURATION:
            keep.append(CutSegment(start=round(prev, 3), end=round(total_duration, 3), enabled=True))
        return keep, silences

    # Group words into speech clusters separated by breath gaps (> 0.20s)
    clusters: List[List[TranscriptWord]] = []
    current_cluster: List[TranscriptWord] = []

    for i, w in enumerate(all_words):
        if not current_cluster:
            current_cluster.append(w)
        else:
            prev_word = current_cluster[-1]
            gap = w.start - prev_word.end
            if gap > MIN_SILENCE_DURATION:
                clusters.append(current_cluster)
                current_cluster = [w]
            else:
                current_cluster.append(w)

    if current_cluster:
        clusters.append(current_cluster)

    # Convert clusters into keep segments with smart boundaries:
    # snap every edge to the closest real silence detected by silencedetect so
    # cuts land exactly at speech onset/offset instead of relying on Whisper
    # word timestamps (which can drift) plus a fixed margin.
    keep_segments: List[CutSegment] = []
    for clus in clusters:
        seg_start = _snap_boundary(silences, clus[0].start, total_duration, cut_margin, side="start")
        seg_end = _snap_boundary(silences, clus[-1].end, total_duration, cut_margin, side="end")

        # Ensure no overlap with previous segment
        if keep_segments and seg_start < keep_segments[-1].end:
            keep_segments[-1].end = round(seg_end, 3)
        else:
            if seg_end > seg_start + 0.05:
                keep_segments.append(CutSegment(
                    start=round(seg_start, 3),
                    end=round(seg_end, 3),
                    enabled=True,
                ))

    return keep_segments, silences


def _snap_boundary(
    silences: List[SilenceRange],
    word_time: float,
    total_duration: float,
    cut_margin: float,
    snap_window: float = 0.40,
    side: str = "start",
) -> float:
    """
    Snap a keep-segment boundary to the nearest detected silence edge so cuts
    land exactly in quiet zones instead of mid-sound.

    side="start": find the silence whose end is closest before the first word
    and use its end as the segment start (exact speech onset, trims leading
    silence so the video starts right when the person talks). Falls back to
    word_time - cut_margin when no silence is nearby.

    side="end": find the silence whose start is closest after the last word and
    use its start as the segment end (exact speech offset, trims trailing
    silence so the video ends cleanly). Falls back to word_time + cut_margin.
    """
    if side == "start":
        best = None
        for s in silences:
            if s.end <= word_time + 1e-6 and s.end >= word_time - snap_window:
                if best is None or s.end > best.end:
                    best = s
        if best is not None:
            return round(max(0.0, best.end), 3)
        return round(max(0.0, word_time - cut_margin), 3)

    best = None
    for s in silences:
        if s.start >= word_time - 1e-6 and s.start <= word_time + snap_window:
            if best is None or s.start < best.start:
                best = s
    if best is not None:
        return round(min(total_duration, best.start), 3)
    return round(min(total_duration, word_time + cut_margin), 3)


def adjust_transcript_for_cuts(
    transcript: List[TranscriptSegment],
    cuts: List[CutSegment],
) -> List[TranscriptSegment]:
    """
    Recalculate transcript segment and word timestamps to match the shortened,
    cut video so subtitles remain 100% perfectly synchronized word by word.
    """
    enabled_cuts = [c for c in cuts if getattr(c, "enabled", True)]
    if not enabled_cuts or not transcript:
        return transcript

    adjusted_segments: List[TranscriptSegment] = []

    for seg in transcript:
        new_words: List[TranscriptWord] = []
        for w in seg.words:
            # Find which cut segment contains this word
            for i, cut in enumerate(enabled_cuts):
                if w.start < cut.end and w.end > cut.start:
                    clean_offset = sum((c.end - c.start) for c in enabled_cuts[:i])
                    w_start = round(clean_offset + max(0.0, w.start - cut.start), 3)
                    w_end = round(clean_offset + min(cut.end - cut.start, w.end - cut.start), 3)
                    if w_end > w_start:
                        new_words.append(TranscriptWord(
                            word=w.word,
                            start=w_start,
                            end=w_end,
                            confidence=getattr(w, "confidence", 1.0)
                        ))
                    break

        if new_words:
            seg_start = new_words[0].start
            seg_end = new_words[-1].end
            text = " ".join(w.word for w in new_words)
            adjusted_segments.append(TranscriptSegment(
                text=text,
                start=seg_start,
                end=seg_end,
                words=new_words,
            ))

    return adjusted_segments if adjusted_segments else transcript


def apply_cuts(video_path: str, segments: List[CutSegment], output_path: str) -> str:
    """
    Concatenate enabled KEEP segments into output video using 100% sample-accurate
    FFmpeg trim & atrim filters to prevent any keyframe desync or drift.
    """
    enabled_segments = [s for s in segments if s.enabled]

    if not enabled_segments:
        subprocess.run(["cp", video_path, output_path])
        return output_path

    ffmpeg_exe = get_ffmpeg_binary()

    filter_parts = []
    concat_inputs = []

    for i, seg in enumerate(enabled_segments):
        filter_parts.append(
            f"[0:v]trim=start={seg.start:.3f}:end={seg.end:.3f},setpts=PTS-STARTPTS[v{i}];"
            f"[0:a]atrim=start={seg.start:.3f}:end={seg.end:.3f},asetpts=PTS-STARTPTS[a{i}];"
        )
        concat_inputs.append(f"[v{i}][a{i}]")

    concat_filter = "".join(concat_inputs) + f"concat=n={len(enabled_segments)}:v=1:a=1[outv][outa]"
    full_filter_complex = "".join(filter_parts) + concat_filter

    cmd = [
        ffmpeg_exe, "-y",
        "-i", video_path,
        "-filter_complex", full_filter_complex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        output_path
    ]

    try:
        print(f"✂️ Cutting video with sample-accurate trim: {len(enabled_segments)} segments")
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=True)
    except Exception as e:
        print(f"⚠️ FFmpeg trim cut error: {e}. Running fallback.")
        subprocess.run(["cp", video_path, output_path])

    return output_path
