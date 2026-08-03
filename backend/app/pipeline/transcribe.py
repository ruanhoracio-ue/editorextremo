"""Audio transcription module using faster-whisper with word-level timestamps."""

from __future__ import annotations

import os
import shutil
from typing import List

from app.models.schemas import TranscriptSegment, TranscriptWord


def transcribe_audio(
    video_path: str,
    language: str = "pt",
    model_size: str = "base",
) -> List[TranscriptSegment]:
    """
    Transcribe audio from video_path using faster-whisper.
    Returns list of TranscriptSegment with word-level timestamps.
    """
    try:
        from faster_whisper import WhisperModel
        print(f"🎙️ Starting Whisper transcription ({model_size}): {video_path}")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        segments_generator, info = model.transcribe(
            video_path,
            language=language,
            word_timestamps=True,
            vad_filter=False,
        )

        segments: List[TranscriptSegment] = []
        for seg in segments_generator:
            words: List[TranscriptWord] = []
            if seg.words:
                for w in seg.words:
                    clean_word = w.word.strip()
                    if clean_word:
                        words.append(TranscriptWord(
                            word=clean_word,
                            start=round(w.start, 3),
                            end=round(w.end, 3),
                            confidence=round(w.probability, 2),
                        ))

            if words:
                seg_start = words[0].start
                seg_end = words[-1].end
                seg_text = " ".join(w.word for w in words)
                segments.append(TranscriptSegment(
                    text=seg_text,
                    start=seg_start,
                    end=seg_end,
                    words=words,
                ))

        print(f"✅ Whisper transcription complete: {len(segments)} raw segments")
        chunked = _chunk_into_short_captions(segments)
        return chunked if chunked else segments

    except Exception as e:
        print(f"⚠️ Whisper error: {e}")
        import traceback
        traceback.print_exc()
        raise RuntimeError(f"Erro ao transcrever áudio do vídeo: {e}")


def _chunk_into_short_captions(
    segments: List[TranscriptSegment],
    max_words: int = 4,
) -> List[TranscriptSegment]:
    """
    Split transcript segments into punchy 3-4 word captions.
    Starts caption 80ms BEFORE speech for instant response and ends 100ms AFTER speech
    so captions never lag behind the voice.
    """
    result: List[TranscriptSegment] = []

    for seg in segments:
        words = seg.words
        if not words:
            result.append(seg)
            continue

        chunk_words: List[TranscriptWord] = []
        for w in words:
            chunk_words.append(w)
            if len(chunk_words) >= max_words or w.word.endswith((".", "?", "!", ";")):
                # 80ms pre-roll start so caption appears instantly when voice begins
                start_time = max(0.0, round(chunk_words[0].start - 0.08, 3))
                end_time = round(chunk_words[-1].end + 0.10, 3)
                text = " ".join(cw.word for cw in chunk_words)
                result.append(TranscriptSegment(
                    text=text,
                    start=start_time,
                    end=end_time,
                    words=chunk_words,
                ))
                chunk_words = []

        if chunk_words:
            start_time = max(0.0, round(chunk_words[0].start - 0.08, 3))
            end_time = round(chunk_words[-1].end + 0.10, 3)
            text = " ".join(cw.word for cw in chunk_words)
            result.append(TranscriptSegment(
                text=text,
                start=start_time,
                end=end_time,
                words=chunk_words,
            ))

    return result
