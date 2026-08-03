"""AI Music generation stub.

FUTURE: Integrate with an external API (e.g., ElevenLabs Music API, Suno, etc.)
This module is intentionally "pluggable" — swap the implementation without
changing the interface.
"""

from typing import Optional


def generate_soundtrack(
    mood: str = "upbeat",
    duration_seconds: float = 60.0,
    output_path: Optional[str] = None,
) -> Optional[str]:
    """
    Generate a soundtrack using an AI music API.

    Args:
        mood: Desired mood (e.g., "upbeat", "calm", "dramatic").
        duration_seconds: Target duration of the soundtrack.
        output_path: Where to save the generated audio file.

    Returns:
        Path to the generated audio file, or None if not available.

    FUTURE INTEGRATION POINT:
        Replace this stub with an actual API call, e.g.:

        from elevenlabs import generate_music
        audio = generate_music(mood=mood, duration=duration_seconds)
        Path(output_path).write_bytes(audio)
        return output_path
    """
    print(f"🎵 [STUB] Music generation requested: mood='{mood}', duration={duration_seconds}s")
    print("   → This feature is not yet implemented. Skipping soundtrack generation.")
    return None
