"""Final render module — FFmpeg composition with subtitles, clean split screen, dynamic zoom."""

from __future__ import annotations

import os
import re
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


# Enquadramento vertical ao recortar para outro formato. O padrão (35% da altura)
# fica na linha do rosto em vídeo de pessoa falando — não decapita em 1:1/4:5/16:9 —
# e o usuário ajusta arrastando o preview (style.crop_focus_y).
DEFAULT_CROP_FOCUS_Y = 35.0


def _crop_y_expr(style_options) -> str:
    focus = getattr(style_options, "crop_focus_y", DEFAULT_CROP_FOCUS_Y)
    try:
        focus = float(focus)
    except (TypeError, ValueError):
        focus = DEFAULT_CROP_FOCUS_Y
    frac = max(0.0, min(100.0, focus)) / 100.0
    return f"max(0,min(in_h-out_h,in_h*{frac:.4f}-out_h/2))"

# Quando o formato de destino é MUITO diferente do original (ex.: vídeo vertical
# exportado em 16:9, ou horizontal exportado em 9:16), cortar destruiria o
# enquadramento. Nesses casos mostramos o vídeo inteiro centralizado sobre um
# fundo desfocado dele mesmo. Abaixo desta fração de área visível, entra o fundo.
BLUR_BG_MIN_VISIBLE = 0.5


def _get_video_dimensions(video_path: str) -> Optional[tuple[int, int]]:
    """Largura x altura do vídeo. Usa ffprobe e cai pro stderr do ffmpeg quando
    só existe o binário do imageio-ffmpeg (caso do pacote dos alunos)."""
    if shutil.which("ffprobe"):
        try:
            res = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", video_path],
                capture_output=True, text=True, timeout=60, check=True,
            )
            w, h = res.stdout.strip().split("x")[:2]
            if int(w) > 0 and int(h) > 0:
                return int(w), int(h)
        except Exception:
            pass
    try:
        res = subprocess.run([get_ffmpeg_binary(), "-i", video_path],
                             capture_output=True, text=True, timeout=60)
        m = re.search(r"Video:.*?[\s,](\d{2,5})x(\d{2,5})", res.stderr)
        if m:
            return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return None


def _needs_blur_background(src_dims: Optional[tuple[int, int]], canvas_w: int, canvas_h: int) -> bool:
    """Só entra quando o destino é MUITO mais largo que a origem (ex.: vídeo vertical
    exportado em 16:9), onde recortar decapitaria a imagem.

    O caminho contrário — vídeo horizontal exportado em 9:16 — continua recortando
    no rosto: é o formato Reels/Shorts de sempre, onde a pessoa preenche a tela.
    """
    if not src_dims or not src_dims[0] or not src_dims[1]:
        return False
    src_ar = src_dims[0] / src_dims[1]
    tgt_ar = canvas_w / canvas_h
    if tgt_ar <= src_ar:
        return False
    return src_ar / tgt_ar < BLUR_BG_MIN_VISIBLE


def _blur_bg_filter(main_src: str, canvas_w: int, canvas_h: int, out_label: str) -> str:
    """Vídeo inteiro centralizado sobre um fundo desfocado dele mesmo.
    O blur é feito em miniatura e reescalado (muito mais rápido que gblur em 1080p)."""
    sw = max(16, (canvas_w // 8) // 2 * 2)
    sh = max(16, (canvas_h // 8) // 2 * 2)
    return (
        f"{main_src}split=2[bgsrc][fgsrc];"
        f"[bgsrc]scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh},"
        f"gblur=sigma=8,scale={canvas_w}:{canvas_h},eq=brightness=-0.12:saturation=1.05[bgblur];"
        f"[fgsrc]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease:flags=lanczos[fgfit];"
        f"[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,setsar=1[{out_label}]"
    )


_STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"


def _resolve_media_path(ref: Optional[str]) -> Optional[str]:
    """Converte a referência guardada no job em caminho de arquivo real.

    O que fica salvo pode ser a URL web (`/storage/<job>/<arquivo>`) ou um caminho
    absoluto antigo, de quando o projeto morava em outra pasta. Nos dois casos
    ancoramos pelo trecho `storage/...`, que é estável.
    """
    if not ref:
        return None
    if os.path.isabs(ref) and os.path.exists(ref):
        return ref
    marker = "storage/"
    idx = ref.replace("\\", "/").find(marker)
    if idx != -1:
        candidate = _STORAGE_ROOT / ref.replace("\\", "/")[idx + len(marker):]
        if candidate.exists():
            return str(candidate)
    return ref if os.path.exists(ref) else None


def _time_window_expr(start: float, end: float) -> Optional[str]:
    """Expressão `enable` do FFmpeg para uma janela de tempo. None = sempre visível."""
    start = max(0.0, float(start or 0.0))
    end = float(end or 0.0)
    if start <= 0 and end <= 0:
        return None
    if end <= 0:
        return f"gte(t,{start:.3f})"
    if end <= start:
        return None
    return f"between(t,{start:.3f},{end:.3f})"


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

    # Formato de destino muito diferente do original? Mostra o vídeo inteiro sobre
    # fundo desfocado em vez de recortar (ex.: vertical → 16:9, horizontal → 9:16).
    src_dims = _get_video_dimensions(clean_video_path)
    if src_dims and rotation in (90, 270):
        src_dims = (src_dims[1], src_dims[0])
    use_blur_bg = _needs_blur_background(src_dims, canvas_w, canvas_h)
    crop_y = _crop_y_expr(style_options)

    # --- Split Screen Layout (Clean 50/50 vertical stack with framing Y) ---
    split_img = _resolve_media_path(style_options.split_screen_image) if style_options.layout == "split_screen" else None
    next_input = 1  # índice do próximo -i (0 é o vídeo principal)

    if split_img:
        ext = os.path.splitext(split_img)[1].lower()
        if ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
            input_args.extend(["-loop", "1", "-i", split_img])
        else:
            input_args.extend(["-stream_loop", "-1", "-i", split_img])
        split_idx = next_input
        next_input += 1

        framing_y_top = getattr(style_options, "split_screen_framing_y", 50.0)
        framing_y_bot = getattr(style_options, "split_screen_framing_y_bottom", 50.0)
        half_h = canvas_h // 2
        crop_y_top = f"(in_h-{half_h})*{framing_y_top/100.0:.2f}"
        crop_y_bot = f"(in_h-{half_h})*{framing_y_bot/100.0:.2f}"

        split_window = _time_window_expr(
            getattr(style_options, "split_screen_start", 0.0),
            getattr(style_options, "split_screen_end", 0.0),
        )

        split_build = (
            f"[{split_idx}:v]scale={canvas_w}:-1:flags=lanczos,crop={canvas_w}:{half_h}:0:'{crop_y_top}',setsar=1[top];"
            f"{main_src}split=2[mainfull][mainsplit];"
            f"[mainsplit]scale={canvas_w}:{half_h}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={canvas_w}:{half_h}:0:'{crop_y_bot}',setsar=1[bot];"
            f"[top][bot]vstack=inputs=2[splitv]"
        )

        if split_window:
            # Fora da janela o vídeo volta a ocupar a tela toda: compomos a versão
            # tela cheia por baixo e sobrepomos a tela dividida só durante a janela.
            filters.append(
                split_build + ";"
                f"[mainfull]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase:flags=lanczos,"
                f"crop={canvas_w}:{canvas_h}:(in_w-out_w)/2:'{crop_y}',setsar=1[fullv];"
                f"[fullv][splitv]overlay=0:0:enable='{split_window}'[base_canvas]"
            )
        else:
            filters.append(split_build + ";[splitv]null[base_canvas]")
    elif use_blur_bg:
        filters.append(_blur_bg_filter(main_src, canvas_w, canvas_h, "base_canvas"))
    else:
        filters.append(
            f"{main_src}scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={canvas_w}:{canvas_h}:(in_w-out_w)/2:'{crop_y}',setsar=1[base_canvas]"
        )

    # --- Dynamic Zoom Filter ---
    # Sem zoom no 16:9 (YouTube) nem quando o vídeo está centralizado sobre fundo
    # desfocado — nos dois casos o objetivo é preservar o enquadramento original.
    current_label = "base_canvas"
    if style_options.zoom_enabled and aspect != "16:9" and not use_blur_bg:
        zoom_filter = _build_varied_zoom_filter(cuts, transcript, style_options.zoom_intensity, canvas_w, canvas_h)
        if zoom_filter:
            filters.append(f"[{current_label}]{zoom_filter}[zoomed_canvas]")
            current_label = "zoomed_canvas"

    # --- Anexos (imagens sobrepostas) ---
    # Depois do zoom (um logo/selo não deve pulsar junto) e antes da legenda,
    # para a legenda ficar sempre por cima do anexo.
    for ov in (getattr(style_options, "overlays", None) or []):
        ov_path = _resolve_media_path(getattr(ov, "src", None))
        if not ov_path:
            continue
        ov_ext = os.path.splitext(ov_path)[1].lower()
        if ov_ext in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
            input_args.extend(["-stream_loop", "-1", "-i", ov_path])
        else:
            input_args.extend(["-loop", "1", "-i", ov_path])
        ov_idx = next_input
        next_input += 1

        ov_w = max(2, int(canvas_w * max(2.0, min(100.0, ov.width_percent)) / 100.0))
        ov_w -= ov_w % 2
        opacity = max(0.0, min(1.0, getattr(ov, "opacity", 1.0)))
        # Preserva o canal alpha do PNG e aplica a opacidade escolhida
        prep = f"[{ov_idx}:v]scale={ov_w}:-1:flags=lanczos,format=rgba"
        if opacity < 1.0:
            prep += f",colorchannelmixer=aa={opacity:.3f}"
        prep += f"[ovp{ov_idx}]"

        x_expr = f"(W*{ov.x_percent/100.0:.4f})-(w/2)"
        y_expr = f"(H*{ov.y_percent/100.0:.4f})-(h/2)"
        window = _time_window_expr(ov.start, ov.end)
        overlay_args = f"overlay={x_expr}:{y_expr}:format=auto"
        if window:
            overlay_args += f":enable='{window}'"
        out_label = f"ovout{ov_idx}"
        filters.append(f"{prep};[{current_label}][ovp{ov_idx}]{overlay_args}[{out_label}]")
        current_label = out_label

    # --- Subtitles ASS ---
    if style_options.subtitle_style == "basic" and transcript:
        ass_path = _generate_ass_subtitles(clean_video_path, transcript, style_options)
        if ass_path:
            escaped = ass_path.replace(":", "\\:").replace("'", "\\'")
            fonts_escaped = _fonts_dir().replace(":", "\\:").replace("'", "\\'")
            filters.append(f"[{current_label}]ass='{escaped}':fontsdir='{fonts_escaped}'[final]")
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
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
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

    crop_y = _crop_y_expr(style_options)
    vf_parts.append(
        f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={canvas_w}:{canvas_h}:(in_w-out_w)/2:'{crop_y}',setsar=1"
    )

    if style_options.subtitle_style == "basic" and transcript:
        ass_path = _generate_ass_subtitles(clean_video_path, transcript, style_options)
        if ass_path:
            escaped = ass_path.replace(":", "\\:").replace("'", "\\'")
            fonts_escaped = _fonts_dir().replace(":", "\\:").replace("'", "\\'")
            vf_parts.append(f"ass='{escaped}':fontsdir='{fonts_escaped}'")

    cmd = [ffmpeg_exe, "-y", "-i", clean_video_path, "-vf", ",".join(vf_parts)]
    cmd.extend([
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        output_path
    ])

    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=True)
    except Exception:
        subprocess.run(["cp", clean_video_path, output_path])

    return output_path


def _fonts_dir() -> str:
    """Diretório das fontes embarcadas usadas no burn das legendas (libass fontsdir)."""
    return str(Path(__file__).resolve().parent.parent / "assets" / "fonts")


def _wrap_words_by_chars(words: list, max_chars: int) -> list[list]:
    """Agrupa palavras em linhas de até max_chars — MESMO algoritmo guloso do preview
    (getDisplayLines no editor), pra exportação e preview quebrarem idêntico."""
    lines: list[list] = []
    current: list = []
    current_len = 0
    for w in words:
        word_txt = w.word if hasattr(w, "word") else str(w)
        new_len = current_len + (1 if current else 0) + len(word_txt)
        if new_len <= max_chars or not current:
            current.append(w)
            current_len = new_len
        else:
            lines.append(current)
            current = [w]
            current_len = len(word_txt)
    if current:
        lines.append(current)
    return lines


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
    # Fontes REAIS embarcadas em app/assets/fonts (via fontsdir do libass) — o export
    # usa a mesma fonte do preview em vez de cair tudo em Arial.
    font_map = {
        "TikTok Medium": "TikTok Sans",
        "Helvetica": "Arimo",  # metricamente idêntica à Helvetica/Arial, licença livre
        "Montserrat": "Montserrat",
        "Lato": "Lato",
        "The Bold Font": "Anton",
        "Bebas Neue": "Bebas Neue",
        "Inter": "Inter",
    }
    font_name = font_map.get(raw_font, "Inter")
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
Title: EditorExtremo Subtitles
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

    # NÃO usar \blur aqui: em ASS ele borra o glifo inteiro, não só a sombra/traçado,
    # e a legenda sai felpuda. A sombra já é suavizada pelo alpha do BackColour acima,
    # que é o equivalente ao drop-shadow do preview (borra a sombra, mantém a letra nítida).
    blur_tag = ""

    for seg in transcript:
        if is_animated and seg.words:
            # Word-by-word karaoke com quebra de linha IGUAL ao preview: as palavras
            # são agrupadas em linhas de max_chars, e cada bloco de max_lines linhas
            # vira um Dialogue próprio com o tempo das suas palavras (o preview só
            # mostra as linhas da palavra ativa — aqui é o equivalente exato).
            # \kt pula o timer do karaokê pro offset real de cada palavra.
            lines = _wrap_words_by_chars(seg.words, max_chars)
            group_size = max(1, max_lines)
            for gi in range(0, len(lines), group_size):
                group = lines[gi:gi + group_size]
                g_words = [w for line in group for w in line]
                g_start = _seconds_to_ass_time(g_words[0].start)
                g_end = _seconds_to_ass_time(g_words[-1].end)
                base_ts = g_words[0].start
                line_txts = []
                for line in group:
                    parts = []
                    for w in line:
                        dur_cs = int(max(0.1, w.end - w.start) * 100)
                        offset_cs = max(0, int((w.start - base_ts) * 100))
                        word_txt = w.word.upper() if is_upper else w.word
                        parts.append(f"{{\\kt{offset_cs}}}{{\\kf{dur_cs}}}{word_txt}")
                    line_txts.append(" ".join(parts))
                text = "\\N".join(line_txts)
                events.append(f"Dialogue: 0,{g_start},{g_end},Default,,0,0,0,,{{\\pos({pos_x},{pos_y})}}{blur_tag}{text}")
            continue

        start = _seconds_to_ass_time(seg.start)
        end = _seconds_to_ass_time(seg.end)
        text = format_caption_text(seg.text, max_lines, max_chars, is_upper)
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\pos({pos_x},{pos_y})}}{blur_tag}{text}")

    ass_path.write_text(header + "\n".join(events), encoding="utf-8")
    return str(ass_path)


def _seconds_to_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"
