"""Color grading module — FFmpeg filters with individual controls."""

from __future__ import annotations
import subprocess

from app.models.schemas import ColorGradeOptions


def get_ffmpeg_binary() -> str:
    import shutil
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _build_grade_filter(opts: ColorGradeOptions) -> str:
    """
    Build FFmpeg video filter string from individual grade controls.
    No transpose logic — orientation is handled at upload time (Etapa 0).
    """
    filters = []

    # EQ filter: contrast, brightness, saturation
    contrast = opts.contrast
    brightness = (opts.brightness - 1.0) * 0.1  # map 0.5-1.5 → -0.05 to 0.05
    saturation = opts.saturation

    if abs(contrast - 1.0) > 0.01 or abs(brightness) > 0.005 or abs(saturation - 1.0) > 0.01:
        filters.append(
            f"eq=contrast={contrast:.3f}:brightness={brightness:.4f}:saturation={saturation:.3f}"
        )

    # Warmth (color temperature): shift red/blue balance via curves
    if abs(opts.warmth) > 0.05:
        w = opts.warmth
        r_mid = 0.5 + (0.04 * w)
        b_mid = 0.5 - (0.04 * w)
        filters.append(
            f"curves=red='0/0 0.5/{r_mid:.3f} 1/1'"
            f":blue='0/0 0.5/{b_mid:.3f} 1/1'"
        )

    # Sharpness (unsharp mask)
    if opts.sharpness > 0.1:
        s = min(opts.sharpness, 2.0)
        filters.append(f"unsharp=5:5:{s:.1f}")

    return ",".join(filters)


def apply_color_grade(
    input_path: str,
    output_path: str,
    grade: ColorGradeOptions | None = None,
    intensity: float = 1.0,
) -> str:
    """
    Apply color grade to video using FFmpeg.
    Accepts either a ColorGradeOptions object or a legacy intensity float.
    No rotation/transpose logic — handled by Etapa 0 normalization.
    """
    ffmpeg_exe = get_ffmpeg_binary()

    if grade is None:
        # Legacy mode: convert single intensity to ColorGradeOptions
        grade = ColorGradeOptions(
            intensity=intensity,
            contrast=1.0 + (0.05 * intensity),
            brightness=1.0 + (0.02 * intensity),
            saturation=1.0 + (0.15 * intensity),
            warmth=0.03 * intensity,
            sharpness=0.5 * min(intensity, 1.5),
        )

    vf = _build_grade_filter(grade)

    cmd = [ffmpeg_exe, "-y", "-i", input_path]
    if vf:
        cmd.extend(["-vf", vf])
    else:
        # Nada a aplicar: copia o stream em vez de re-encodar de graça
        # (cada re-encode desnecessário some com detalhe do vídeo).
        cmd.extend(["-c", "copy", output_path])
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode == 0:
                return output_path
        except Exception:
            pass
        cmd = [ffmpeg_exe, "-y", "-i", input_path]

    cmd.extend([
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        output_path
    ])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"⚠️ Color grade warning: {result.stderr[-500:]}")
            subprocess.run(["cp", input_path, output_path])
    except FileNotFoundError:
        print("⚠️ FFmpeg not found. Copying without color grade.")
        subprocess.run(["cp", input_path, output_path])

    return output_path
