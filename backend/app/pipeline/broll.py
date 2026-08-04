"""Auto B-Roll Module — searches and downloads stock images/videos based on transcript context."""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List, Optional

from app.models.schemas import TranscriptSegment

STOPWORDS_PT = {
    "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas", "por", "pelo", "pela", "pelos", "pelas", "com",
    "para", "pra", "se", "que", "e", "ou", "mas", "como", "mais", "muito", "seu", "sua",
    "meu", "minha", "este", "esta", "isto", "isso", "aquilo", "ele", "ela", "eles", "elas",
    "tem", "ter", "ser", "esta", "foi", "sao", "vai", "fazer", "pode", "aqui", "agora",
    "entao", "onde", "quando", "quem", "qual", "porque", "porquê", "sim", "nao", "tambem",
}

# Curated High-Res Unsplash Vertical B-Rolls for instant fallback
CURATED_UNSPLASH_BROLLS = [
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080&q=80",  # Tech abstract
    "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1080&q=80",  # Circuit board
    "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1080&q=80",  # Matrix code
    "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&q=80",  # Neon gaming
]


def extract_key_topics(transcript: List[TranscriptSegment]) -> List[str]:
    """Extract top 3 key topic nouns from transcript text."""
    full_text = " ".join(seg.text for seg in transcript)
    words = re.findall(r"\b[A-Za-zÀ-ÿ]{4,}\b", full_text)

    freq = {}
    for w in words:
        w_lower = w.lower()
        if w_lower not in STOPWORDS_PT:
            freq[w_lower] = freq.get(w_lower, 0) + 1

    sorted_keywords = sorted(freq.keys(), key=lambda k: freq[k], reverse=True)
    return sorted_keywords[:3] if sorted_keywords else ["tecnologia", "inovacao"]


def fetch_auto_broll_image(
    transcript: List[TranscriptSegment],
    output_dir: Path,
) -> Optional[str]:
    """Find and download a relevant high-resolution stock image for split screen."""
    topics = extract_key_topics(transcript)
    query = topics[0] if topics else "technology"

    print(f"🔍 Auto B-Roll searching for topic: '{query}'")
    target_file = output_dir / "auto_broll.jpg"

    # Try Wikimedia Commons Open Search API
    url = (
        "https://commons.wikimedia.org/w/api.php?"
        f"action=query&generator=search&gsrsearch={urllib.parse.quote(query)}"
        "&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|size&format=json"
    )

    req = urllib.request.Request(url, headers={"User-Agent": "EdituApp/1.0 (contact@editu.app)"})

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        pages = data.get("query", {}).get("pages", {})
        image_urls = []

        for page_id, page_data in pages.items():
            imageinfo = page_data.get("imageinfo", [])
            if imageinfo:
                img_url = imageinfo[0].get("url")
                if img_url and img_url.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    image_urls.append(img_url)

        if image_urls:
            dl_req = urllib.request.Request(image_urls[0], headers={"User-Agent": "EdituApp/1.0 (contact@editu.app)"})
            with urllib.request.urlopen(dl_req, timeout=12) as dl_resp, open(target_file, "wb") as f:
                f.write(dl_resp.read())
            print(f"✅ Auto B-Roll image downloaded from Wikimedia: {target_file}")
            return str(target_file)

    except Exception as e:
        print(f"⚠️ Wikimedia search failed: {e}")

    # Fallback to Unsplash Curated High-Res Vertical B-Roll
    try:
        idx = hash(query) % len(CURATED_UNSPLASH_BROLLS)
        unsplash_url = CURATED_UNSPLASH_BROLLS[idx]
        dl_req = urllib.request.Request(unsplash_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(dl_req, timeout=10) as dl_resp, open(target_file, "wb") as f:
            f.write(dl_resp.read())
        print(f"✅ Auto B-Roll fetched Unsplash stock: {target_file}")
        return str(target_file)
    except Exception as e:
        print(f"⚠️ Unsplash fallback failed: {e}")

    return _generate_fallback_broll(output_dir, query)


def _generate_fallback_broll(output_dir: Path, topic: str) -> str:
    """Generate a clean dark gradient fallback image using FFmpeg."""
    from app.pipeline.cut_detector import get_ffmpeg_binary
    ffmpeg_exe = get_ffmpeg_binary()

    target_file = output_dir / "auto_broll.jpg"
    cmd = [
        ffmpeg_exe, "-y",
        "-f", "lavfi",
        "-i", "color=c=0x0f172a:s=1080x960:d=1",
        "-vframes", "1",
        str(target_file)
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except Exception:
        pass
    return str(target_file)


def generate_broll_timeline_suggestions(
    transcript: List[TranscriptSegment],
    output_dir: Path,
) -> List[dict]:
    """
    Scans transcript to suggest specific B-Roll moments with stock options for interactive approval.
    """
    if not transcript:
        return []

    suggestions = []
    step = max(1, len(transcript) // 3)

    unsplash_base = "https://images.unsplash.com/"
    broll_photos = [
        ("photo-1522071820081-009f0129c71c", "Reunião de Trabalho"),
        ("photo-1460925895917-afdab827c52f", "Gráficos & Resultados"),
        ("photo-1551836022-d5d88e9218df", "Tecnologia & Inovação"),
        ("photo-1517245386807-bb43f82c33c4", "Apresentação Executiva"),
    ]

    for i in range(0, len(transcript), step):
        if len(suggestions) >= 3:
            break
        seg = transcript[i]
        text_clean = seg.text.strip()
        words = [w for w in re.findall(r"\b[A-Za-zÀ-ÿ]{4,}\b", text_clean) if w.lower() not in STOPWORDS_PT]
        topic = words[0] if words else "negocios"

        options = []
        for idx, (photo_id, title) in enumerate(broll_photos[:3]):
            options.append({
                "title": f"{title} ({topic.capitalize()})",
                "url": f"{unsplash_base}{photo_id}?w=1080&q=80",
                "thumbnail": f"{unsplash_base}{photo_id}?w=400&q=80",
                "media_type": "image",
            })

        suggestions.append({
            "id": f"broll_sugg_{len(suggestions)+1}",
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "keyword": topic.capitalize(),
            "context_text": text_clean,
            "options": options,
            "accepted_url": None,
            "status": "pending",
        })

    return suggestions
