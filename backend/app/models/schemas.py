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
    MONTSERRAT = "Montserrat"
    BEBAS = "Bebas Neue"
    IMPACT = "Impact"


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
    subtitle_shadow_enabled: bool = False
    subtitle_letter_spacing: int = Field(default=0, ge=-10, le=20)
    subtitle_font_size: int = Field(default=58, ge=24, le=120)
    subtitle_max_lines: int = Field(default=1, ge=1, le=2)
    subtitle_max_chars_per_line: int = Field(default=25, ge=10, le=50)
    subtitle_animated: bool = False
    subtitle_animation_style: str = Field(default="bounce_yellow")

    aspect_ratio: str = Field(default="9:16")

    zoom_enabled: bool = True
    zoom_intensity: float = Field(default=1.15, ge=1.0, le=2.0)
    color_grade: ColorGradeOptions = Field(default_factory=ColorGradeOptions)
    cut_margin: float = Field(default=0.06, ge=0.0, le=0.5)
    split_screen_image: Optional[str] = None
    split_screen_images: List[str] = Field(default_factory=list)
    split_screen_framing_y: float = Field(default=50.0, ge=0.0, le=100.0)
    auto_broll_enabled: bool = False


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

    # Cut info
    cuts: Optional[List[CutSegment]] = None
    silences: Optional[List[SilenceRange]] = None
    original_duration: Optional[float] = None
    clean_duration: Optional[float] = None

    # Style
    style_options: Optional[StyleOptions] = Field(default_factory=StyleOptions)

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        use_enum_values = True
