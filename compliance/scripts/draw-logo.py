#!/usr/bin/env python3
"""Draw the Jupyter logo as an outline in braille, for the welcome screen of rtc-conformance (compliance/bin/welcome.mjs).

    python3 -I compliance/scripts/draw-logo.py            # prints the text to paste into welcome.mjs, and a preview
    python3 -I compliance/scripts/draw-logo.py logo.ppm   # also writes the dots as an image (ffmpeg -i logo.ppm logo.png)

The logo is a planet between two crescents, with three small moons. Only the outlines are drawn, never the insides. It is
made from the geometry of the shapes, so its size and proportions can be changed here and the text made again.

A braille character is a block of 2 by 4 dots, so a thin line can follow a curve. Every character has one colour: the one
that most of its dots belong to (1 the crescents, 2 the planet, 3 to 5 the moons).
"""
import math
import sys

COLS, ROWS = 33, 12
W, H = COLS * 2, ROWS * 4          # dots; a dot is about as wide as it is tall
CX, CY = (W - 1) / 2, (H - 1) / 2
RX, RY = 30.0, 22.5                # the outer edge of the crescents
START, END = 22, 158               # degrees, from the right and over the top: where the upper crescent begins and ends
THICK = 0.38                       # the thickest part of a crescent, as a fraction of the radius
PLANET_RADIUS = 12.5
MOONS = [  # (x, y, radius, colour), relative to the centre
    (-27.0, -19.5, 3.6, 3),
    (26.0, -20.0, 2.6, 4),
    (-25.0, 19.5, 3.0, 5),
]
RGB = {0: (30, 30, 46), 1: (243, 119, 38), 2: (118, 118, 119), 3: (190, 190, 192), 4: (150, 150, 152), 5: (170, 170, 172)}


def crescent(x, y, upper):
    dx, dy = (x - CX) / RX, (y - CY) / RY
    r = math.hypot(dx, dy)
    theta = math.degrees(math.atan2(-dy if upper else dy, dx)) % 360
    if not START <= theta <= END:
        return False
    t = THICK * math.sin(math.pi * (theta - START) / (END - START)) ** 0.7
    return 1 - t <= r <= 1.0


def circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shape(x, y):
    """Which shape a dot is inside: 0 for none."""
    if crescent(x, y, True) or crescent(x, y, False):
        return 1
    if circle(x, y, CX, CY, PLANET_RADIUS):
        return 2
    for dx, dy, r, colour in MOONS:
        if circle(x, y, CX + dx, CY + dy, r):
            return colour
    return 0


def outline():
    """The dots on the edge of a shape: inside it, with a neighbour that is not."""
    inside = [[shape(x, y) for x in range(W)] for y in range(H)]
    edge = [[0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            s = inside[y][x]
            if not s:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < W and 0 <= ny < H) or inside[ny][nx] != s:
                    edge[y][x] = s
                    break
    return edge


BITS = {(0, 0): 0x01, (0, 1): 0x02, (0, 2): 0x04, (1, 0): 0x08, (1, 1): 0x10, (1, 2): 0x20, (0, 3): 0x40, (1, 3): 0x80}


def braille(edge):
    """(text rows, colour rows): a braille character per 2 by 4 dots, and the colour most of its dots have."""
    text, colours = [], []
    for r in range(ROWS):
        t, c = '', ''
        for col in range(COLS):
            bits, votes = 0, {}
            for (dx, dy), bit in BITS.items():
                s = edge[r * 4 + dy][col * 2 + dx]
                if s:
                    bits |= bit
                    votes[s] = votes.get(s, 0) + 1
            t += chr(0x2800 + bits)
            c += str(max(votes, key=lambda k: votes[k])) if votes else '0'
        text.append(t)
        colours.append(c)
    return text, colours


def main():
    edge = outline()
    text, colours = braille(edge)
    print('const LOGO = [')
    print(',\n'.join(f"  '{row}'" for row in text))
    print('];')
    print('const LOGO_COLORS = [')
    print(',\n'.join(f"  '{row}'" for row in colours))
    print('];')
    if len(sys.argv) > 1:
        scale = 12
        with open(sys.argv[1], 'w') as f:
            f.write(f'P3\n{W * scale} {H * scale}\n255\n')
            for row in edge:
                line = ' '.join(' '.join(map(str, RGB[c] if c else RGB[0])) for c in row for _ in range(scale))
                for _ in range(scale):
                    f.write(line + '\n')


if __name__ == '__main__':
    main()
