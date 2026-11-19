#!/usr/bin/env node
// Draw the Jupyter logo as solid blocks, for the welcome screen of `jupyter conformance ssd` (compliance/bin/welcome.mjs).
//
//   node compliance/scripts/draw-logo.mjs [columns]            # prints the rows to paste into welcome.mjs, and a preview
//   node compliance/scripts/draw-logo.mjs 26 preview.png       # also writes the preview as a picture
//
// It traces examples/storyboards/jupyter-logo.svg (the official mark), so the proportions are the real ones: the SVG is
// drawn in a headless browser, each pixel is called orange (the arcs), grey (the planets) or empty, and two pixels, one
// above the other, become one character: ▀ ▄ █ or a space. Needs Playwright (`npm ci --prefix compliance`).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG = fs.readFileSync(path.join(HERE, '..', '..', 'examples', 'storyboards', 'jupyter-logo.svg'), 'utf8');
const COLS = Number(process.argv[2] ?? 24);
const PREVIEW = process.argv[3];
const [VW, VH] = [39, 51]; // the viewBox of the mark
const ROWS = Math.round((COLS * VH) / VW / 2); // a character is about twice as tall as it is wide
const WIDTH = COLS * 2; // sub-pixels: a character is two across and two down
const HEIGHT = ROWS * 2;
const SCALE = 12; // sub-pixels per pixel, to see how much of a pixel a shape covers

const browser = await chromium.launch();
const page = await browser.newPage();
const grid = await page.evaluate(
  async ({ svg, WIDTH, HEIGHT, SCALE }) => {
    const sized = svg.replace(/width="39" height="51"/, `width="${WIDTH * SCALE}" height="${HEIGHT * SCALE}" preserveAspectRatio="none"`);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * SCALE;
    canvas.height = HEIGHT * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rows = [];
    for (let y = 0; y < HEIGHT; y++) {
      const row = [];
      for (let x = 0; x < WIDTH; x++) {
        let orange = 0;
        let grey = 0;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const i = ((y * SCALE + dy) * canvas.width + x * SCALE + dx) * 4;
            if (data[i + 3] < 128) continue;
            if (data[i] > 180 && data[i + 2] < 120) orange++;
            else grey++;
          }
        }
        const area = SCALE * SCALE;
        // a planet is only a pixel or two across, so a small part of a pixel is enough to show it
        row.push(orange / area >= 0.4 ? 1 : grey / area >= 0.2 ? 2 : 0);
      }
      rows.push(row);
    }
    return rows;
  },
  { svg: SVG, WIDTH, HEIGHT, SCALE }
);

// the quadrant blocks: which of the four sub-pixels (top left, top right, bottom left, bottom right) are filled
const QUADRANT = { 0: ' ', 8: '▘', 4: '▝', 2: '▖', 1: '▗', 12: '▀', 3: '▄', 10: '▌', 5: '▐', 9: '▚', 6: '▞', 14: '▛', 13: '▜', 11: '▙', 7: '▟', 15: '█' };
const text = [];
const colors = [];
for (let r = 0; r < ROWS; r++) {
  let t = '';
  let c = '';
  for (let x = 0; x < COLS; x++) {
    const sub = [grid[2 * r][2 * x], grid[2 * r][2 * x + 1], grid[2 * r + 1][2 * x], grid[2 * r + 1][2 * x + 1]];
    t += QUADRANT[sub.reduce((bits, v) => bits * 2 + (v ? 1 : 0), 0)];
    c += sub.includes(1) ? '1' : sub.includes(2) ? '2' : '0'; // orange wins in a character that has both
  }
  text.push(t);
  colors.push(c);
}

console.log('const LOGO = [\n' + text.map(t => `  '${t}'`).join(',\n') + '\n];');
console.log('const LOGO_COLORS = [\n' + colors.map(c => `  '${c}'`).join(',\n') + '\n];');
console.log(`\n${COLS} columns, ${text.length} rows`);

if (PREVIEW) {
  const [cw, ch] = [9, 18]; // a character cell, about twice as tall as it is wide
  const rects = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (grid[y][x]) rects.push(`<rect x="${(x * cw) / 2}" y="${(y * ch) / 2}" width="${cw / 2 + 0.3}" height="${ch / 2 + 0.3}" fill="${grid[y][x] === 1 ? '#f37726' : '#9e9e9e'}"/>`);
    }
  }
  await page.setContent(`<body style="margin:0;background:#1e1e2e"><svg width="${COLS * cw + 24}" height="${ROWS * ch + 24}"><g transform="translate(12 12)">${rects.join('')}</g></svg></body>`);
  await page.setViewportSize({ width: COLS * cw + 24, height: ROWS * ch + 24 });
  await page.screenshot({ path: PREVIEW });
}
await browser.close();
