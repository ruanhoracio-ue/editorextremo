"""Pydantic schemas for Job, StyleOptions, and TranscriptWord."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------- Enums ----------

class JobStatus(str, Enum):
    QUEUED = "queued"
    TRANSCRIBING = "transcribing"
    CUTTING = "cutting"
    GRADING = "grading"
    CLEAN_READY = "clean_ready"
    RENDERING = "rendering"
    DONE = "done"
    ERROR = "error"


class LayoutType(str, Enum):
    FULLSCREEN = "fullscreen"
    SPLIT_SCREEN = "split_screen"


class SubtitleStyle(str, Enum):
    NONE = "none"
    BASIC = "basic"


class SubtitlePosition(str, Enum):
    BOTTOM = "bottom"
    MIDDLE = "middle"
    TOP = "top"
    CUSTOM = "custom"


class SubtitleFont(str, Enum):
    INTER = "Inter"
    TIKTOK = "TikTok Medium"
    HELVETICA = "Helvetica"
    MONTSERRAT = "Montserrat"
    LATO = "Lato"
    THE_BOLD = "The Bold Font"
    BEBAS = "Bebas Neue"


class SubtitleTheme(str, Enum):
    ANDROMEDA = "andromeda"
    ENERGY = "energy"
    MILLION = "million"
    MINIMAL_WHITE = "minimal_white"


# ---------- Transcript ----------

class TranscriptWord(BaseModel):
    word: str
    start: float
    end: float
    confidence: float = 1.0


class TranscriptSegment(BaseModel):
    text: str
    start: float
    end: float
    words: List[TranscriptWord] = []


# ---------- Color Grade Options ----------

class ColorGradeOptions(BaseModel):
    """Individual color grading controls."""
    intensity: float = Field(default=1.0, ge=0.0, le=2.0)
    contrast: float = Field(default=1.0, ge=0.5, le=2.0)
    brightness: float = Field(default=1.0, ge=0.5, le=1.5)
    saturation: float = Field(default=1.0, ge=0.0, le=2.5)
    warmth: float = Field(default=0.0, ge=-1.0, le=1.0)  # -1=cool, 0=neutral, 1=warm
    sharpness: float = Field(default=0.0, ge=0.0, le=2.0)


# ---------- Anexos (imagem/PNG sobreposta) ----------

class MediaOverlay(BaseModel):
    """Imagem sobreposta ao vídeo, com posição, tamanho e janela de tempo."""
    id: str
    src: str                                                   # /storage/<job>/overlay_x.png
    x_percent: float = Field(default=50.0, ge=0.0, le=100.0)   # centro do anexo
    y_percent: float = Field(default=50.0, ge=0.0, le=100.0)
    width_percent: float = Field(default=30.0, ge=2.0, le=100.0)
    start: float = Field(default=0.0, ge=0.0)
    end: float = Field(default=0.0, ge=0.0)                    # 0 = até o fim do vídeo
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)


# ---------- Style Options ----------

class StyleOptions(BaseModel):
    layout: LayoutType = LayoutType.FULLSCREEN
    subtitle_style: SubtitleStyle = SubtitleStyle.BASIC
    subtitle_position: SubtitlePosition = SubtitlePosition.BOTTOM
    subtitle_font: SubtitleFont = SubtitleFont.INTER
    subtitle_theme: SubtitleTheme = SubtitleTheme.MINIMAL_WHITE

    # Draggable position, colors, outline, shadow & letter spacing
    subtitle_x_percent: float = Field(default=50.0, ge=0.0, le=100.0)
    subtitle_y_percent: float = Field(default=80.0, ge=0.0, le=100.0)
    subtitle_color: str = "#FFFFFF"
    subtitle_outline_color: str = "#000000"
    subtitle_bg_color: str = "transparent"
    subtitle_outline_enabled: bool = False
    subtitle_outline_width: float = Field(default=2.0, ge=0.0, le=20.0)
    subtitle_shadow_enabled: bool = False
    subtitle_shadow_offset: int = Field(default=4, ge=0, le=30)
    subtitle_shadow_color: str = "#000000"
    subtitle_letter_spacing: int = Field(default=0, ge=-10, le=20)
    subtitle_font_size: int = Field(default=58, ge=24, le=120)
    subtitle_max_lines: int = Field(default=1, ge=1, le=2)
    subtitle_max_chars_per_line: int = Field(default=25, ge=10, le=50)
    subtitle_animated: bool = False
    subtitle_animation_style: str = Field(default="bounce_yellow")

    aspect_ratio: str = Field(default="9:16")
    # Rotação do vídeo em graus (0, 90, 180, 270) — aplicada no render final
    rotation: int = Field(default=0)
    # Enquadramento vertical ao recortar para outro formato: que altura do vídeo
    # original fica no centro do recorte (0 = topo, 100 = base). 35% ≈ linha do
    # rosto em vídeo de pessoa falando.
    crop_focus_y: float = Field(default=35.0, ge=0.0, le=100.0)

    zoom_enabled: bool = True
    zoom_intensity: float = Field(default=1.15, ge=1.0, le=2.0)
    color_grade: ColorGradeOptions = Field(default_factory=ColorGradeOptions)
    cut_margin: float = Field(default=0.06, ge=0.0, le=0.5)
    split_screen_image: Optional[str] = None
    split_screen_images: List[str] = Field(default_factory=list)
    split_screen_framing_y: float = Field(default=50.0, ge=0.0, le=100.0)
    split_screen_framing_y_bottom: float = Field(default=50.0, ge=0.0, le=100.0)
    # Janela em que a tela dividida fica no ar (segundos do vídeo limpo).
    # end = 0 significa "até o fim"; fora da janela o vídeo volta a tela cheia.
    split_screen_start: float = Field(default=0.0, ge=0.0)
    split_screen_end: float = Field(default=0.0, ge=0.0)

    # Anexos (imagens/PNGs) sobrepostos ao vídeo
    overlays: List[MediaOverlay] = Field(default_factory=list)
    auto_broll_enabled: bool = False


# ---------- B-Roll Suggestions ----------

class BRollMediaOption(BaseModel):
    title: str
    url: str
    thumbnail: str
    media_type: str = "image"  # image or video


class BRollSuggestion(BaseModel):
    id: str
    start: float
    end: float
    keyword: str
    context_text: str
    options: List[BRollMediaOption] = []
    accepted_url: Optional[str] = None
    status: str = "pending"  # pending, accepted, rejected


# ---------- Cut Segment ----------

class CutSegment(BaseModel):
    start: float
    end: float
    enabled: bool = True


# ---------- Silence Info ----------

class SilenceRange(BaseModel):
    start: float
    end: float
    duration: float


# ---------- Job ----------

class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    status: JobStatus = JobStatus.QUEUED
    progress: int = 0
    error_message: Optional[str] = None

    # File paths
    original_file: Optional[str] = None
    original_filename: Optional[str] = None
    clean_video: Optional[str] = None
    final_video: Optional[str] = None

    # Transcript
    transcript: Optional[List[TranscriptSegment]] = None
    raw_transcript: Optional[List[TranscriptSegment]] = None

    # Style options
    style_options: Optional[StyleOptions] = None

    # Cut info
    cuts: Optional[List[CutSegment]] = None
    silences: Optional[List[SilenceRange]] = None
    original_duration: Optional[float] = None
    clean_duration: Optional[float] = None

    # Multi-format Batch Export
    batch_videos: Optional[dict[str, str]] = None
    batch_zip_url: Optional[str] = None

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        use_enum_values = True
