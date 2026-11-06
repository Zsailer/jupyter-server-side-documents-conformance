// The welcome screen of `rtc-conformance`: what is shown when it is run with nothing to do. A pure function of the
// version and whether to use colour, so it is tested without a terminal.

// The Jupyter logo, drawn as pixels by scripts/draw-logo.py: two orange crescents around a gray planet, and three moons.
// Two rows of pixels make one row of the terminal (half blocks). 0 is empty, 1 the crescents, 2 the planet, 3-5 the moons.
const LOGO = [
  '033000000000011110000000000400',
  '033300000111111111111000004400',
  '033300011111111111111110000000',
  '000001111111111111111111100000',
  '000011110000000000000011110000',
  '000111000000022220000000111000',
  '000100000002222222200000001000',
  '000000000022222222220000000000',
  '000000000022222222220000000000',
  '000000000222222222222000000000',
  '000000000222222222222000000000',
  '000000000222222222222000000000',
  '000000000222222222222000000000',
  '000000000022222222220000000000',
  '000000000022222222220000000000',
  '000100000002222222200000001000',
  '000111000000022220000000111000',
  '000011110000000000000011110000',
  '000001111111111111111111100000',
  '005500011111111111111110000000',
  '005500000111111111111000000000',
  '005500000000011110000000000000'
];

// the 256-colour palette entries nearest to the colours of the logo
const COLORS = { 1: 208, 2: 243, 3: 250, 4: 240, 5: 246 };

/** The logo as rows of terminal text: half blocks, in colour or, without colour, the same shape. */
export function logo({ color = true } = {}) {
  const rows = [];
  for (let r = 0; r < LOGO.length; r += 2) {
    let line = '';
    for (let c = 0; c < LOGO[r].length; c++) {
      const top = +LOGO[r][c];
      const bottom = +LOGO[r + 1][c];
      if (!top && !bottom) {
        line += ' ';
      } else if (!color) {
        line += top && bottom ? '█' : top ? '▀' : '▄';
      } else if (top === bottom) {
        line += `\u001b[38;5;${COLORS[top]}m█\u001b[0m`;
      } else if (top && bottom) {
        line += `\u001b[38;5;${COLORS[top]};48;5;${COLORS[bottom]}m▀\u001b[0m`;
      } else {
        line += `\u001b[38;5;${COLORS[top || bottom]}m${top ? '▀' : '▄'}\u001b[0m`;
      }
    }
    rows.push(line);
  }
  return rows;
}

/** The lines of the welcome screen. */
export function welcome({ version, color = true } = {}) {
  const paint = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = s => paint('1', s);
  const dim = s => paint('2', s);

  // the name and a line about it sit beside the middle of the planet
  const beside = {
    4: `${bold('rtc-conformance')} ${dim(`v${version}`)}`,
    5: 'Real-time collaboration, held to',
    6: 'what people should experience.'
  };
  const art = logo({ color }).map((row, i) => `  ${row}${beside[i] ? `   ${beside[i]}` : ''}`);

  const commands = [
    ['rtc-conformance pick', 'choose stories from a list, then run them'],
    ['rtc-conformance run Z3', 'run one story'],
    ['rtc-conformance list', 'see every story, and what each needs'],
    ['rtc-conformance help', 'everything it can do']
  ];
  const width = Math.max(...commands.map(([c]) => c.length)) + 2;

  return [
    '',
    ...art,
    '',
    '  Plays a notebook backend through the situations people really meet when',
    '  they share a notebook, and tells you which of them it gets right.',
    '',
    `  ${bold('Try one of these')}`,
    ...commands.map(([command, what]) => `    ${bold(command)}${' '.repeat(width - command.length)}${what}`),
    ''
  ];
}
