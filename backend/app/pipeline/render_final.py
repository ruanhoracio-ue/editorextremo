"""Final render module — FFmpeg composition with subtitles, clean split screen, dynamic zoom."""

from __future__ import annotations

import os
import subprocess
import shutil
from pathlib import Path
from typing import List, Optional

from app.models.schemas import StyleOptions, TranscriptSegment


def get_ffmpeg_binary() -> str:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def format_caption_text(
    raw_text: str,
    max_lines: int = 1,
    max_chars_per_line: int = 25,
    is_uppercase: bool = False,
) -> str:
    """Format caption text into strict 1 or 2 lines without ever overflowing into 3 lines."""
    text = raw_text.upper() if is_uppercase else raw_text
    words = text.split()
    if not words:
        return ""

    lines: list[str] = []
    current = ""
    for w in words:
        if len((current + " " + w).strip()) <= max_chars_per_line:
            current = (current + " " + w).strip()
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)

    if max_lines == 1:
        return " ".join(lines)
    elif max_lines == 2:
        if len(lines) <= 2:
            return "\\N".join(lines)
        return lines[0] + "\\N" + " ".join(lines[1:])
    return "\\N".join(lines)


def _get_canvas_dimensions(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio == "4:5":
        return 1080, 1350
    elif aspect_ratio == "1:1":
        return 1080, 1080
    elif aspect_ratio == "16:9":
        return 1920, 1080
    return 1080, 1920


def render_final_video(
    clean_video_path: str,
    output_path: str,
    style_options: StyleOptions,
    transcript: Optional[List[TranscriptSegment]] = None,
    cuts: Optional[List] = None,
) -> str:
    """Render final video on dynamic resolution canvas (9:16, 4:5, 1:1, 16:9) with clean split screen, framing Y, and dynamic zoom."""
    ffmpeg_exe = get_ffmpeg_binary()
    filters: list[str] = []
    input_args = ["-i", clean_video_path]

    aspect = getattr(style_options, "aspect_ratio", "9:16") or "9:16"
    canvas_w, canvas_h = _get_canvas_dimensions(aspect)

    # --- Rotação do vídeo principal (0/90/180/270) — antes do scale/crop ---
    rotation = int(getattr(style_options, "rotation", 0) or 0) % 360
    rot_map = {90: "transpose=1", 180: "transpose=1,transpose=1", 270: "transpose=2"}
    main_src = "[0:v]"
    if rotation in rot_map:
        filters.append(f"[0:v]{rot_map[rotation]}[vsrc]")
        main_src = "[vsrc]"

    # --- Split Screen Layout (Clean 50/50 vertical stack with framing Y) ---
    if style_options.layout == "split_screen" and style_options.split_screen_image:
        img_path = style_options.split_screen_image
        if os.path.exists(img_path):
            ext = os.path.splitext(img_path)[1].lower()
            if ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
                input_args.extend(["-loop", "1", "-i", img_path])
            else:
                input_args.extend(["-stream_loop", "-1", "-i", img_path])

            framing_y_top = getattr(style_options, "split_screen_framing_y", 50.0)
            framing_y_bot = getattr(style_options, "split_screen_framing_y_bottom", 50.0)
            half_h = canvas_h // 2
            crop_y_top = f"(in_h-{half_h})*{framing_y_top/100.0:.2f}"
            crop_y_bot = f"(in_h-{half_h})*{framing_y_bot/100.0:.2f}"

            filters.append(
                f"[1:v]scale={canvas_w}:-1,crop={canvas_w}:{half_h}:0:'{crop_y_top}',setsar=1[top];"
                f"{main_src}scale={canvas_w}:{half_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{half_h}:0:'{crop_y_bot}',setsar=1[bot];"
                f"[top][bot]vstack=inputs=2[base_canvas]"
            )
        else:
            filters.append(
                f"{main_src}scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{canvas_h},setsar=1[base_canvas]"
            )
    else:
        filters.append(
            f"{main_src}scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{canvas_h},setsar=1[base_canvas]"
        )

    # --- Dynamic Zoom Filter ---
    current_label = "base_canvas"
    if style_options.zoom_enabled:
        zoom_filter = _build_varied_zoom_filter(cuts, transcript, style_options.zoom_intensity, canvas_w, canvas_h)
        if zoom_filter:
            filters.append(f"[{current_label}]{zoom_filter}[zoomed_canvas]")
            current_label = "zoomed_canvas"

    # --- Subtitles ASS ---
    if style_options.subtitle_style == "basic" and transcript:
        ass_path = _generate_ass_subtitles(clean_video_path, transcript, style_options)
        if ass_path:
            escaped = ass_path.replace(":", "\\:").replace("'", "\\'")
            filters.append(f"[{current_label}]ass='{escaped}'[final]")
        else:
            filters.append(f"[{current_label}]null[final]")
    else:
        filters.append(f"[{current_label}]null[final]")

    # --- Build Command ---
    cmd = [ffmpeg_exe, "-y"]
    cmd.extend(input_args)

    filter_complex = ";".join(filters)
    cmd.extend(["-filter_complex", filter_complex])
    cmd.extend(["-map", "[final]", "-map", "0:a"])
    cmd.extend([
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        output_path
    ])

    try:
        print(f"🎬 Render command: {' '.join(cmd[:14])}...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"⚠️ Complex render failed: {result.stderr[-600:]}")
            _simple_render(ffmpeg_exe, clean_video_path, output_path, style_options, transcript)
    except Exception as e:
        print(f"⚠️ Render exception: {e}. Running simple render fallback.")
        _simple_render(ffmpeg_exe, clean_video_path, output_path, style_options, transcript)

    return output_path


def _build_varied_zoom_filter(
    cuts: Optional[List] = None,
    transcript: Optional[List[TranscriptSegment]] = None,
    zoom_intensity: float = 1.18,
    canvas_w: int = 1080,
    canvas_h: int = 1920,
) -> str:
    """Build FFmpeg filter that alternates zoom in (1.18x) on EVERY cut segment change."""
    conditions = []
    if cuts:
        enabled_cuts = [c for c in cuts if getattr(c, "enabled", True)]
        for i, cut in enumerate(enabled_cuts):
            start = getattr(cut, "start", cut.get("start", 0) if isinstance(cut, dict) else 0)
            end = getattr(cut, "end", cut.get("end", 0) if isinstance(cut, dict) else 0)
            if i % 2 == 1:
                conditions.append(f"between(time,{start:.2f},{end:.2f})")
    elif transcript:
        for i, seg in enumerate(transcript):
            if i % 2 == 1:
                conditions.append(f"between(time,{seg.start:.2f},{seg.end:.2f})")

    if not conditions:
        return ""

    cond_expr = "+".join(conditions)
    z_expr = f"if(gt({cond_expr},0), {zoom_intensity:.3f}, 1.0)"

    return (
        f"zoompan=z='{z_expr}'"
        f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d=1:s={canvas_w}x{canvas_h}:fps=30"
    )


def _simple_render(
    ffmpeg_exe: str,
    clean_video_path: str,
    output_path: str,
    style_options: StyleOptions,
    transcript: Optional[List[TranscriptSegment]],
) -> str:
    """Fallback render."""
    aspect = getattr(style_options, "aspect_ratio", "9:16") or "9:16"
    canvas_w, canvas_h = _get_canvas_dimensions(aspect)
    vf_parts = []

    # Rotação também no fallback
    rotation = int(getattr(style_options, "rotation", 0) or 0) % 360
    rot_map = {90: "transpose=1", 180: "transpose=1,transpose=1", 270: "transpose=2"}
    if rotation in rot_map:
        vf_parts.append(rot_map[rotation])

    vf_parts.append(
        f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{canvas_h},setsar=1"
    )

    if style_options.subtitle_style == "basic" and transcript:
        ass_path = _generate_ass_subtitles(clean_video_path, transcript, style_options)
        if ass_path:
            escaped = ass_path.replace(":", "\\:").replace("'", "\\'")
            vf_parts.append(f"ass='{escaped}'")

    cmd = [ffmpeg_exe, "-y", "-i", clean_video_path, "-vf", ",".join(vf_parts)]
    cmd.extend([
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        output_path
    ])

    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=True)
    except Exception:
        subprocess.run(["cp", clean_video_path, output_path])

    return output_path


def _hex_to_ass_color(hex_color: str, alpha: str = "00") -> str:
    """Convert #RRGGBB hex to ASS &HAABBGGRR."""
    if not hex_color or hex_color in ("transparent", "none"):
        return f"&H{alpha}000000"

    hex_clean = hex_color.lstrip("#")
    if len(hex_clean) != 6:
        return f"&H{alpha}000000"

    r, g, b = hex_clean[0:2], hex_clean[2:4], hex_clean[4:6]
    return f"&H{alpha}{b}{g}{r}".upper()


def _generate_ass_subtitles(
    video_path: str,
    transcript: List[TranscriptSegment],
    style: StyleOptions,
) -> Optional[str]:
    """Generate ASS subtitles for 1080x1920 canvas with strict 1/2 line formatting and Karaoke animation styles."""
    if not transcript:
        return None

    ass_path = Path(video_path).parent / "subtitles.ass"

    raw_font = style.subtitle_font.value if hasattr(style.subtitle_font, "value") else str(style.subtitle_font)
    font_map = {
        "TikTok Medium": "Arial",
        "Helvetica": "Helvetica",
        "Montserrat": "Arial",
        "Lato": "Arial",
        "The Bold Font": "Arial",
        "Bebas Neue": "Arial",
        "Inter": "Arial",
    }
    font_name = font_map.get(raw_font, "Arial")
    font_size = style.subtitle_font_size

    aspect = getattr(style, "aspect_ratio", "9:16") or "9:16"
    canvas_w, canvas_h = _get_canvas_dimensions(aspect)
    pos_x = int((style.subtitle_x_percent / 100.0) * canvas_w)
    pos_y = int((style.subtitle_y_percent / 100.0) * canvas_h)
    spacing = style.subtitle_letter_spacing

    primary_color = _hex_to_ass_color(style.subtitle_color)

    # Karaoke: SecondaryColour = cor das palavras AINDA NÃO faladas (ASS BGR + alpha)
    anim_style = getattr(style, "subtitle_animation_style", "bounce_yellow")
    if anim_style == "typewriter":
        secondary_color = "&HFF000000"  # alpha FF = invisível até ser falada (efeito revelar)
    elif anim_style == "spotlight":
        secondary_color = "&H00707070"  # cinza apagado até "acender" na fala
    else:
        secondary_color = "&H0015CAFA"  # amarelo (pop_flash / bounce_yellow)

    outline_color = _hex_to_ass_color(style.subtitle_outline_color)

    shadow_hex = getattr(style, "subtitle_shadow_color", "#000000") or "#000000"
    if style.subtitle_bg_color not in ("transparent", "none", ""):
        back_color = _hex_to_ass_color(style.subtitle_bg_color, "80")
    else:
        # Sombra semi-transparente (alpha 50 ≈ 69% de opacidade) — sombra 100% chapada fica dura
        back_color = _hex_to_ass_color(shadow_hex, "50")

    border_style = 1
    outline_w = getattr(style, "subtitle_outline_width", 2) if style.subtitle_outline_enabled else 0
    shadow_d = getattr(style, "subtitle_shadow_offset", 3) if style.subtitle_shadow_enabled else 0

    theme = style.subtitle_theme.value if hasattr(style.subtitle_theme, "value") else str(style.subtitle_theme)

    if theme == "andromeda":
        primary_color = "&H00FFFFFF"
    elif theme == "energy":
        primary_color = "&H00000000"
    elif theme == "million":
        primary_color = "&H00FFFFFF"
    elif theme == "minimal_white":
        primary_color = "&H00FFFFFF"

    header = f"""[Script Info]
Title: Editu Subtitles
ScriptType: v4.00+
PlayResX: {canvas_w}
PlayResY: {canvas_h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},{back_color},-1,0,0,0,100,100,{spacing},0,{border_style},{outline_w},{shadow_d},5,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    is_animated = getattr(style, "subtitle_animated", False)
    max_lines = getattr(style, "subtitle_max_lines", 1)
    max_chars = getattr(style, "subtitle_max_chars_per_line", 25)
    is_upper = theme in ("andromeda", "million")

    for seg in transcript:
        start = _seconds_to_ass_time(seg.start)
        end = _seconds_to_ass_time(seg.end)

        if is_animated and seg.words:
            # Word-by-word karaoke. Use \kt to jump the karaoke timer to each
            # word's real offset (relative to the dialogue start) so highlights
            # are perfectly synchronized with each spoken word.
            # Use words[0].start as the base reference (not seg.start) to avoid
            # any pre-roll offset that would shift all karaoke timings.
            karaoke_parts = []
            base_ts = seg.words[0].start
            for w in seg.words:
                dur_cs = int(max(0.1, w.end - w.start) * 100)
                offset_cs = max(0, int((w.start - base_ts) * 100))
                word_txt = w.word.upper() if is_upper else w.word
                karaoke_parts.append(f"{{\\kt{offset_cs}}}{{\\kf{dur_cs}}}{word_txt}")
            text = " ".join(karaoke_parts)
        else:
            text = format_caption_text(seg.text, max_lines, max_chars, is_upper)

        # \blur arredonda as bordas do traçado e difunde a sombra (visual mais suave)
        blur_tag = "{\\blur1.5}" if (outline_w or shadow_d) else ""
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\pos({pos_x},{pos_y})}}{blur_tag}{text}")

    ass_path.write_text(header + "\n".join(events), encoding="utf-8")
    return str(ass_path)


def _seconds_to_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"
