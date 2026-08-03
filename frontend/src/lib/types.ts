/* Editu TypeScript Types */

export type JobStatus =
  | "queued"
  | "transcribing"
  | "cutting"
  | "grading"
  | "clean_ready"
  | "rendering"
  | "done"
  | "error";

export type LayoutType = "fullscreen" | "split_screen";

export type SubtitleStyle = "none" | "basic";

export type SubtitlePosition = "bottom" | "middle" | "top" | "custom";

export type SubtitleFont = "Inter" | "Montserrat" | "Bebas Neue" | "Impact";

export type SubtitleTheme =
  | "andromeda"
  | "energy"
  | "million"
  | "minimal_white";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words: TranscriptWord[];
}

export interface CutSegment {
  start: number;
  end: number;
  enabled: boolean;
}

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface ColorGradeOptions {
  intensity: number;
  contrast: number;
  brightness: number;
  saturation: number;
  warmth: number;
  sharpness: number;
}

export interface StyleOptions {
  layout: LayoutType;
  subtitle_style: SubtitleStyle;
  subtitle_position: SubtitlePosition;
  subtitle_font: SubtitleFont;
  subtitle_theme: SubtitleTheme;

  // Drag & drop position & colors
  subtitle_x_percent: number;
  subtitle_y_percent: number;
  subtitle_color: string;
  subtitle_outline_color: string;
  subtitle_bg_color: string;
  subtitle_outline_enabled: boolean;
  subtitle_shadow_enabled: boolean;
  subtitle_letter_spacing: number;
  subtitle_font_size: number;
  subtitle_max_lines: number;
  subtitle_max_chars_per_line: number;
  subtitle_animated: boolean;
  subtitle_animation_style?: string;

  zoom_enabled: boolean;
  zoom_intensity: number;
  color_grade: ColorGradeOptions;
  cut_margin: number;
  split_screen_image?: string;
  split_screen_images?: string[];
  split_screen_framing_y?: number;
  auto_broll_enabled?: boolean;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  original_filename?: string;
  original_duration?: number;
  clean_duration?: number;
  original_video_url?: string;
  clean_video_url?: string;
  final_video_url?: string;
  split_image_url?: string;
  split_images_urls?: string[];
  transcript?: TranscriptSegment[];
  style_options?: StyleOptions;
  error_message?: string;
  created_at?: string;
  cuts?: CutSegment[];
  silences?: SilenceRange[];
}

export const DEFAULT_COLOR_GRADE: ColorGradeOptions = {
  intensity: 1.0,
  contrast: 1.0,
  brightness: 1.0,
  saturation: 1.0,
  warmth: 0.0,
  sharpness: 0.0,
};

export const DEFAULT_STYLE_OPTIONS: StyleOptions = {
  layout: "fullscreen",
  subtitle_style: "basic",
  subtitle_position: "bottom",
  subtitle_font: "Inter",
  subtitle_theme: "minimal_white",

  subtitle_x_percent: 50.0,
  subtitle_y_percent: 85.0,
  subtitle_color: "#FFFFFF",
  subtitle_outline_color: "#000000",
  subtitle_bg_color: "transparent",
  subtitle_outline_enabled: false,
  subtitle_shadow_enabled: false,
  subtitle_letter_spacing: 0,
  subtitle_font_size: 58,
  subtitle_max_lines: 1,
  subtitle_max_chars_per_line: 25,
  subtitle_animated: false,
  subtitle_animation_style: "bounce_yellow",

  zoom_enabled: true,
  zoom_intensity: 1.15,
  color_grade: { ...DEFAULT_COLOR_GRADE },
  cut_margin: 0.06,
  split_screen_framing_y: 50.0,
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Iniciando processamento...",
  transcribing: "Otimizando e transcrevendo áudio...",
  cutting: "Cortando silêncios...",
  grading: "Aplicando color grade...",
  clean_ready: "Vídeo limpo pronto!",
  rendering: "Renderizando final...",
  done: "Concluído!",
  error: "Erro no processamento",
};

export const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "#64748b",
  transcribing: "#fbbf24",
  cutting: "#fbbf24",
  grading: "#fbbf24",
  clean_ready: "#34d399",
  rendering: "#22d3ee",
  done: "#34d399",
  error: "#fb7185",
};
