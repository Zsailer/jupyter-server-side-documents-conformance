// The welcome screen of `jupyter conformance ssd`: what is shown when it is run with nothing to do. A pure function of the
// version and whether to use colour, so it is tested without a terminal.

// The Jupyter logo, solid: two crescents and three small circles, in blocks (▀ ▄ ▌ ▐ ▘ ▝ ▖ ▗ ▚ ▞ ▛ ▜ ▙ ▟ █), traced from the
// official mark by scripts/draw-logo.mjs: change the size there and paste the new rows here. LOGO_COLORS gives the colour
// of each character: 0 none, 1 the crescents, 2 the circles.
const LOGO = [
  '                   ▟██▙ ',
  '▗▄▖     ▄▄▄▄▄▄▄▄▖  ▜██▛ ',
  '▜██ ▗▄████████████▙▄    ',
  '   ▟██▛▀▀▀▀▀▀▀▀▀▀▀███▄  ',
  ' ▗█▀▘               ▀▀▙ ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  ' ▝▄▖                 ▄▞ ',
  '  ▝▜█▙▄▄▄      ▗▄▄▄██▛  ',
  '    ▝▜█████████████▀▘   ',
  ' ▗▄▄▄  ▀▀▀████▛▀▀▘      ',
  ' ████▙                  ',
  ' ▝██▛▘                  '
];
const LOGO_COLORS = [
  '000000000000000000022220',
  '222000001111111110022220',
  '222011111111111111110000',
  '000111111111111111111100',
  '011110000000000000001110',
  '000000000000000000000000',
  '000000000000000000000000',
  '000000000000000000000000',
  '000000000000000000000000',
  '000000000000000000000000',
  '011100000000000000000110',
  '001111111000000111111100',
  '000011111111111111111000',
  '022220011111111111000000',
  '022222000000000000000000',
  '022222000000000000000000'
];

// the empty rows between the arcs, and the one in the middle of them: where the name and the version go
const EMPTY_ROWS = LOGO.flatMap((row, i) => (row.trim() === '' ? [i] : []));
const MIDDLE = EMPTY_ROWS[Math.floor(EMPTY_ROWS.length / 2)];

// the 256-colour palette entries nearest to the colours of the logo
const COLORS = { 1: 208, 2: 245 };

/**
 * The logo as rows of terminal text: in colour, or the same shape without. `labels` puts text inside the arcs: a row
 * number to { text, paint }, centred.
 */
export function logo({ color = true, labels = {} } = {}) {
  return LOGO.map((row, r) => {
    const cells = [...row].map((ch, c) => {
      const id = +LOGO_COLORS[r][c];
      return color && id ? `\u001b[38;5;${COLORS[id]}m${ch}\u001b[0m` : ch;
    });
    const label = labels[r];
    if (label) {
      const start = Math.floor((cells.length - label.text.length) / 2);
      [...label.text].forEach((ch, i) => (cells[start + i] = color ? label.paint(ch) : ch));
    }
    return cells.join('');
  });
}

/** The lines of the welcome screen. */
export function welcome({ version, color = true } = {}) {
  const paint = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = s => paint('1', s);
  const dim = s => paint('2', s);

  // the name sits inside the arcs, like a wordmark
  const art = logo({
    color,
    labels: { [MIDDLE - 1]: { text: 'conformance', paint: bold }, [MIDDLE]: { text: `v${version}`, paint: dim } }
  }).map(row => `  ${row}`);

  const commands = [
    ['jupyter conformance ssd pick', 'choose stories from a list, then run them'],
    ['jupyter conformance ssd run Z3', 'run one story'],
    ['jupyter conformance ssd list', 'see every story, and what each needs'],
    ['jupyter conformance ssd help', 'everything it can do']
  ];
  const width = Math.max(...commands.map(([c]) => c.length)) + 2;

  return [
    '',
    ...art,
    '',
    '  Real-time collaboration, held to what people should experience.',
    '',
    '  Plays a notebook backend through the situations people really meet when',
    '  they share a notebook, and tells you which of them it gets right.',
    '',
    `  ${bold('Try one of these')}`,
    ...commands.map(([command, what]) => `    ${bold(command)}${' '.repeat(width - command.length)}${what}`),
    ''
  ];
}
