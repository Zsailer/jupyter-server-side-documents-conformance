#!/usr/bin/env python3
"""Draw the Jupyter logo as pixels, for the welcome screen of rtc-conformance (compliance/bin/welcome.mjs).

    python3 -I compliance/scripts/draw-logo.py            # prints the rows to paste into welcome.mjs, and a preview
    python3 -I compliance/scripts/draw-logo.py logo.ppm   # also writes the preview as an image (ffmpeg -i logo.ppm logo.png)

The logo is a gray planet between two orange crescents, with three small moons. It is drawn from its geometry, so the
size and the proportions can be changed here and the rows made again, instead of editing characters by hand. Two rows
of pixels make one row of the terminal (half blocks), and a pixel is about as wide as it is tall.

Colours: 1 the crescents, 2 the planet, 3 to 5 the moons; 0 is empty.
"""
import math
import sys

W, H = 30, 24
CX, CY = (W - 1) / 2, (H - 1) / 2
RX, RY = 13.6, 10.6    # the outer edge of the crescents
START, END = 22, 158   # degrees, from the right and over the top: where the upper crescent begins and ends
THICK = 0.30           # the thickest part of a crescent, as a fraction of the radius
PLANET_RADIUS = 6.0

RGB = {0: (30, 30, 46), 1: (243, 119, 38), 2: (118, 118, 119), 3: (190, 190, 192), 4: (96, 96, 98), 5: (150, 150, 152)}
MOONS = [  # (x, y, radius, colour), relative to the centre
    (-12.8, -9.4, 1.6, 3),
    (12.3, -9.6, 1.1, 4),
    (-12.0, 9.4, 1.3, 5),
]


def crescent(x, y, upper):
    """The crescent above (or below) the planet: thick in the middle, a point at each end."""
    dx, dy = (x - CX) / RX, (y - CY) / RY
    r = math.hypot(dx, dy)
    theta = math.degrees(math.atan2(-dy if upper else dy, dx)) % 360
    if not START <= theta <= END:
        return False
    t = THICK * math.sin(math.pi * (theta - START) / (END - START)) ** 0.7
    return 1 - t <= r <= 1.0


def circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x, y):
    if crescent(x, y, True) or crescent(x, y, False):
        return 1
    if circle(x, y, CX, CY, PLANET_RADIUS):
        return 2
    for dx, dy, r, colour in MOONS:
        if circle(x, y, CX + dx, CY + dy, r):
            return colour
    return 0


def grid(samples=4, threshold=0.45):
    """Each pixel gets the colour that covers most of it, if that is at least `threshold` of it."""
    out = []
    for j in range(H):
        row = []
        for i in range(W):
            counts = {}
            for sj in range(samples):
                for si in range(samples):
                    c = pixel(i + (si + 0.5) / samples - 0.5, j + (sj + 0.5) / samples - 0.5)
                    if c:
                        counts[c] = counts.get(c, 0) + 1
            best = max(counts, key=lambda k: counts[k]) if counts else 0
            row.append(best if best and counts[best] >= threshold * samples * samples else 0)
        out.append(row)
    # an empty row at the top or the bottom is not part of the logo, and the rows come in pairs
    while not any(out[0]) and not any(out[-1]) and len(out) > 2:
        out = out[1:-1]
    return out


def main():
    g = grid()
    print('const LOGO = [')
    print(',\n'.join("  '" + ''.join(map(str, row)) + "'" for row in g))
    print('];')
    if len(sys.argv) > 1:
        scale = 20
        with open(sys.argv[1], 'w') as f:
            f.write(f'P3\n{W * scale} {len(g) * scale}\n255\n')
            for row in g:
                line = ' '.join(' '.join(map(str, RGB[c])) for c in row for _ in range(scale))
                for _ in range(scale):
                    f.write(line + '\n')


if __name__ == '__main__':
    main()
