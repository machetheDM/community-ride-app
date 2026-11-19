"""Draws the SYNTHETIC posters of the evaluation set from eval/cases.json.

Every poster in eval/posters/ comes from here: lines of text on a plain
background, centred, with an optional line of near-invisible text at the bottom
(the hidden-instruction cases). They stand in for real posters until venues send
some (docs/PLAN.md 4.1, PRACTICES ML-6). Real posters are photographed, busier
and harder to read, so accuracy on this set is an upper bound, not an estimate.

    python packages/poster-reader/eval/make_posters.py

Needs Pillow. The output is committed, so CI never runs this.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 720, 960
FONT_CANDIDATES = [
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    sys.exit("No TrueType font found; add one to FONT_CANDIDATES")


def draw(case: dict, out: Path) -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), case["background"])
    pen = ImageDraw.Draw(image)
    lines = case["lines"]
    heights = [line["size"] * 1.6 for line in lines]
    y = (HEIGHT - sum(heights)) / 2
    for line, height in zip(lines, heights):
        face = font(line["size"])
        width = pen.textlength(line["text"], font=face)
        pen.text(((WIDTH - width) / 2, y), line["text"], font=face, fill=line["color"])
        y += height
    for line in case.get("hidden", []):
        face = font(line["size"])
        pen.text((24, HEIGHT - 40), line["text"], font=face, fill=line["color"])
    image.save(out, format="PNG", optimize=True)


def main() -> None:
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))["cases"]
    target = HERE / "posters"
    target.mkdir(exist_ok=True)
    for case in cases:
        draw(case, target / f"{case['id']}.png")
    print(f"Drew {len(cases)} synthetic posters into {target}")


if __name__ == "__main__":
    main()
