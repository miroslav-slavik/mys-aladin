#!/usr/bin/env python
"""Generate the PWA icons.

The environment carries no imaging library, so the glyph is rasterised with
numpy at 4x and written through a minimal PNG encoder. Shapes are analytic,
which keeps the icons reproducible: rerunning this script yields byte-identical
files.

Usage: python scripts/make-icons.py [output_dir]
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

import numpy as np

SUPERSAMPLE = 4

BACKGROUND = (26, 72, 130)  # deep blue, the app's chrome colour
CLOUD = (252, 252, 251)
SUN = (237, 161, 0)


def write_png(path: Path, rgb: np.ndarray) -> None:
    """Write an 8-bit RGB image without any third-party encoder."""
    height, width, _ = rgb.shape
    raw = b"".join(
        b"\x00" + rgb[row].astype(np.uint8).tobytes() for row in range(height)
    )

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def coordinates(size: int) -> tuple[np.ndarray, np.ndarray]:
    axis = (np.arange(size) + 0.5) / size
    return np.meshgrid(axis, axis)


def disc(xs: np.ndarray, ys: np.ndarray, cx: float, cy: float, r: float) -> np.ndarray:
    return (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r


def rounded_rect(xs, ys, x0, y0, x1, y1, r) -> np.ndarray:
    inner_x = np.clip(xs, x0 + r, x1 - r)
    inner_y = np.clip(ys, y0 + r, y1 - r)
    within = (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)
    return within & (((xs - inner_x) ** 2 + (ys - inner_y) ** 2) <= r * r + 1e-12)


def render(size: int, glyph_scale: float) -> np.ndarray:
    """A sun behind a cloud, on the app's blue plane.

    glyph_scale shrinks the drawing towards the centre so the maskable variant
    keeps its content inside the safe zone.
    """
    hi = size * SUPERSAMPLE
    xs, ys = coordinates(hi)

    def s(value: float) -> float:
        return 0.5 + (value - 0.5) * glyph_scale

    image = np.zeros((hi, hi, 3), dtype=np.float64)
    image[:] = BACKGROUND

    sun = disc(xs, ys, s(0.63), s(0.36), 0.15 * glyph_scale)
    image[sun] = SUN

    cloud = (
        disc(xs, ys, s(0.40), s(0.52), 0.17 * glyph_scale)
        | disc(xs, ys, s(0.60), s(0.55), 0.14 * glyph_scale)
        | rounded_rect(xs, ys, s(0.26), s(0.55), s(0.72), s(0.70), 0.075 * glyph_scale)
    )
    image[cloud] = CLOUD

    # Three rain strokes below the cloud, the app's subject in one glyph.
    for cx in (0.38, 0.50, 0.62):
        streak = rounded_rect(xs, ys, s(cx - 0.022), s(0.74), s(cx + 0.022), s(0.86), 0.022 * glyph_scale)
        image[streak] = CLOUD

    # Box-average the supersampled buffer down to the requested size.
    return image.reshape(size, SUPERSAMPLE, size, SUPERSAMPLE, 3).mean(axis=(1, 3)).round()


def main(argv: list[str]) -> int:
    out_dir = Path(argv[1] if len(argv) > 1 else "web/icons")
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, size, scale in [
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("apple-touch-icon-180.png", 180, 1.0),
        ("icon-maskable-512.png", 512, 0.72),
    ]:
        write_png(out_dir / name, render(size, scale))
        print(f"{out_dir / name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
