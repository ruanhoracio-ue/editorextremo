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


# Palavras "de ligação" (preposições, artigos, conjunções) que NUNCA podem fechar
# uma legenda — "mesmo, a mais de" fica feio; o "de" pertence à próxima frase.
_LINKING_WORDS = {
    "a", "à", "às", "ao", "aos", "as", "o", "os", "e", "é", "de", "da", "do", "das", "dos",
    "em", "no", "na", "nos", "nas", "num", "numa", "um", "uma", "uns", "umas",
    "pra", "pro", "pras", "pros", "para", "por", "pela", "pelo", "pelas", "pelos",
    "com", "sem", "sob", "sobre", "que", "se", "mas", "ou", "nem", "como",
    "meu", "minha", "seu", "sua", "teu", "tua", "esse", "essa", "este", "esta",
    "aquele", "aquela", "mais", "menos", "muito", "tão", "já",
}

_HARD_BREAKS = (".", "?", "!", ";", ":", ",")


def _is_linking(word: str) -> bool:
    return word.strip().strip(".,?!;:…\"'").lower() in _LINKING_WORDS


def _chunk_into_short_captions(
    segments: List[TranscriptSegment],
    max_words: int = 4,
) -> List[TranscriptSegment]:
    """
    Split transcript segments into punchy 3-4 word captions.
    Segment start/end are derived exactly from word timestamps so subtitles
    are perfectly synchronized with the spoken audio — no artificial offsets.

    Regras de quebra:
    - pontuação forte (. ? ! ; :) e VÍRGULA sempre fecham a legenda;
    - uma legenda nunca termina em palavra de ligação (preposição/artigo/conjunção):
      essas palavras são adiadas pra legenda seguinte.
    """
    result: List[TranscriptSegment] = []

    def flush(chunk: List[TranscriptWord]):
        if not chunk:
            return
        result.append(TranscriptSegment(
            text=" ".join(cw.word for cw in chunk),
            start=round(chunk[0].start, 3),
            end=round(chunk[-1].end, 3),
            words=chunk,
        ))

    for seg in segments:
        words = seg.words
        if not words:
            result.append(seg)
            continue

        chunk_words: List[TranscriptWord] = []
        for w in words:
            chunk_words.append(w)
            hard_break = w.word.strip().endswith(_HARD_BREAKS)
            if hard_break or len(chunk_words) >= max_words:
                carry: List[TranscriptWord] = []
                if not hard_break:
                    # Adia palavras de ligação do fim pro próximo chunk (no máx. 2,
                    # e nunca esvaziando o chunk atual)
                    while len(chunk_words) > 1 and len(carry) < 2 and _is_linking(chunk_words[-1].word):
                        carry.insert(0, chunk_words.pop())
                flush(chunk_words)
                chunk_words = carry

        flush(chunk_words)

    return result


def rechunk_transcript(segments: List[TranscriptSegment]) -> List[TranscriptSegment]:
    """Re-agrupa um transcript já chunkado aplicando as regras atuais de quebra.

    Usado no reprocessamento de cortes: jobs antigos foram chunkados com regras
    antigas (sem vírgula/preposição); achatamos as palavras e re-chunkamos.
    """
    all_words: List[TranscriptWord] = []
    for seg in segments:
        all_words.extend(seg.words)
    if not all_words:
        return segments
    merged = TranscriptSegment(
        text=" ".join(w.word for w in all_words),
        start=all_words[0].start,
        end=all_words[-1].end,
        words=all_words,
    )
    return _chunk_into_short_captions([merged])
