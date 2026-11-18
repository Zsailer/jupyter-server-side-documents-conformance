// The welcome screen of `jupyter conformance ssd`: what is shown when it is run with nothing to do. A pure function of the
// version and whether to use colour, so it is tested without a terminal.

// The Jupyter logo as an outline in braille (two crescents and three small circles), drawn by scripts/draw-logo.py:
// change the geometry there and paste the new rows here. LOGO_COLORS gives the colour of each character: 0 none,
// 1 the crescents, 2 to 4 the circles.
const LOGO = [
  '⠀⢠⠒⠒⡄⠀⠀⠀⠀⠀⢀⣀⠤⠤⠤⠤⠤⠤⠤⠤⠤⣀⡀⠀⠀⠀⠀⠀⡠⠒⢄⠀⠀',
  '⠀⠱⣀⣀⠎⠀⢀⠤⠒⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠒⠤⡀⠀⠑⠤⠊⠀⠀',
  '⠀⠀⠀⠀⡠⠊⠁⣀⣀⠤⠤⠤⠒⠒⠒⠒⠒⠒⠒⠒⠒⠤⠤⠤⣀⣀⠈⠑⢄⠀⠀⠀⠀',
  '⠀⠀⢀⠮⠔⠒⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠒⠢⠵⡀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠈⢖⠢⠤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠤⠔⡲⠁⠀⠀',
  '⠀⠀⠀⠀⠑⢄⡀⠉⠉⠒⠒⠒⠤⠤⠤⠤⠤⠤⠤⠤⠤⠒⠒⠒⠉⠉⢀⡠⠊⠀⠀⠀⠀',
  '⠀⠀⢠⠒⠒⡄⠈⠒⠤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⠤⠒⠁⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠈⠒⠒⠁⠀⠀⠀⠀⠈⠉⠒⠒⠒⠒⠒⠒⠒⠒⠒⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀'
];
const LOGO_COLORS = [
  '022220000011111111111110000033300',
  '022220111110000000000011111033300',
  '000011111111111111111111111110000',
  '001111100000000000000000001111100',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '001111100000000000000000001111100',
  '000011111111111111111111111110000',
  '004444111110000000000011111000000',
  '004444000011111111111110000000000'
];

// the 256-colour palette entries nearest to the colours of the logo
const COLORS = { 1: 208, 2: 250, 3: 246, 4: 248 };

/**
 * The logo as rows of terminal text: in colour, or the same shape without. `labels` puts text inside the arcs: a row
 * number to { text, paint }, centred.
 */
export function logo({ color = true, labels = {} } = {}) {
  return LOGO.map((row, r) => {
    const cells = [...row].map((ch, c) => {
      const id = +LOGO_COLORS[r][c];
      // an empty braille character is drawn as a space: some fonts draw it as something else
      if (ch === '\u2800') {
        return ' ';
      }
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
    labels: { 5: { text: 'conformance', paint: bold }, 6: { text: `v${version}`, paint: dim } }
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
