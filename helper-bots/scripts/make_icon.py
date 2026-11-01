"""Draws Helper's icon (the two-dot face on a blue rounded square) and writes helper.ico and helper.png.
Standard library only. Used by the Windows build: python scripts/make_icon.py OUT_DIR"""

import struct
import sys
import zlib
from pathlib import Path

BG, FACE = (82, 136, 193), (14, 22, 33)


def draw(n: int) -> bytes:
    rows = []
    r_corner, dot_r = n * 0.22, n * 0.085
    eyes = [(n * 0.36, n * 0.44), (n * 0.64, n * 0.44)]
    for y in range(n):
        row = bytearray(b"\x00")
        for x in range(n):
            cx = min(max(x + 0.5, r_corner), n - r_corner)
            cy = min(max(y + 0.5, r_corner), n - r_corner)
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            a = max(0.0, min(1.0, r_corner - d + 0.5))
            col = BG
            for ex, ey in eyes:
                if ((x + 0.5 - ex) ** 2 + (y + 0.5 - ey) ** 2) ** 0.5 < dot_r:
                    col = FACE
            # smile: a thin arc
            sx, sy = x + 0.5 - n / 2, y + 0.5 - n * 0.52
            rr = (sx * sx + sy * sy) ** 0.5
            if sy > n * 0.06 and abs(rr - n * 0.17) < n * 0.025:
                col = FACE
            row += bytes((*col, int(a * 255)))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico(pngs: list[tuple[int, bytes]]) -> bytes:
    head = struct.pack("<HHH", 0, 1, len(pngs))
    off = 6 + 16 * len(pngs)
    dirs, data = b"", b""
    for size, png in pngs:
        dirs += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), off + len(data))
        data += png
    return head + dirs + data


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    pngs = [(s, draw(s)) for s in (16, 32, 48, 256)]
    (out / "helper.ico").write_bytes(ico(pngs))
    (out / "helper.png").write_bytes(pngs[-1][1])
    print(f"wrote {out / 'helper.ico'}")
