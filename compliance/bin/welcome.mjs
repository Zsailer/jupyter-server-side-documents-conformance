// The welcome screen of `rtc-conformance`: what is shown when it is run with nothing to do. A pure function of the
// version and whether to use colour, so it is tested without a terminal.

// The Jupyter logo as an outline in braille (two crescents around a planet, with three moons), drawn by
// scripts/draw-logo.py: change the geometry there and paste the new rows here. LOGO_COLORS gives the colour of each
// character: 0 none, 1 the crescents, 2 the planet, 3 to 5 the moons.
const LOGO = [
  '⠀⢠⠒⠒⡄⠀⠀⠀⠀⠀⢀⣀⠤⠤⠤⠤⠤⠤⠤⠤⠤⣀⡀⠀⠀⠀⠀⠀⡠⠒⢄⠀⠀',
  '⠀⠱⣀⣀⠎⠀⢀⠤⠒⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠒⠤⡀⠀⠑⠤⠊⠀⠀',
  '⠀⠀⠀⠀⡠⠊⠁⣀⣀⠤⠤⠤⠒⠒⠒⠒⠒⠒⠒⠒⠒⠤⠤⠤⣀⣀⠈⠑⢄⠀⠀⠀⠀',
  '⠀⠀⢀⠮⠔⠒⠉⠀⠀⠀⠀⠀⡠⠒⠉⠉⠉⠉⠉⠒⢄⠀⠀⠀⠀⠀⠉⠒⠢⠵⡀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠎⠀⠀⠀⠀⠀⠀⠀⠀⠀⠱⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⡰⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠈⢖⠢⠤⣀⠀⠀⠀⠀⠀⠑⠤⣀⣀⣀⣀⣀⠤⠊⠀⠀⠀⠀⠀⣀⠤⠔⡲⠁⠀⠀',
  '⠀⠀⠀⠀⠑⢄⡀⠉⠉⠒⠒⠒⠤⠤⠤⠤⠤⠤⠤⠤⠤⠒⠒⠒⠉⠉⢀⡠⠊⠀⠀⠀⠀',
  '⠀⠀⢠⠒⠒⡄⠈⠒⠤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⠤⠒⠁⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠈⠒⠒⠁⠀⠀⠀⠀⠈⠉⠒⠒⠒⠒⠒⠒⠒⠒⠒⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀'
];
const LOGO_COLORS = [
  '033330000011111111111110000044400',
  '033330111110000000000011111044400',
  '000011111111111111111111111110000',
  '001111100000222222222000001111100',
  '000000000022000000000220000000000',
  '000000000020000000000020000000000',
  '000000000020000000000020000000000',
  '000000000022000000000220000000000',
  '001111100000222222222000001111100',
  '000011111111111111111111111110000',
  '005555111110000000000011111000000',
  '005555000011111111111110000000000'
];

// the 256-colour palette entries nearest to the colours of the logo
const COLORS = { 1: 208, 2: 243, 3: 250, 4: 246, 5: 248 };

/** The logo as rows of terminal text: in colour, or the same shape without. */
export function logo({ color = true } = {}) {
  return LOGO.map((row, r) =>
    [...row]
      .map((ch, c) => {
        const id = +LOGO_COLORS[r][c];
        // an empty braille character is drawn as a space: some fonts draw it as something else
        if (ch === '\u2800') {
          return ' ';
        }
        return color && id ? `\u001b[38;5;${COLORS[id]}m${ch}\u001b[0m` : ch;
      })
      .join('')
  );
}

/** The lines of the welcome screen. */
export function welcome({ version, color = true } = {}) {
  const paint = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = s => paint('1', s);
  const dim = s => paint('2', s);

  // the name and a line about it sit beside the middle of the planet
  const beside = {
    5: `${bold('rtc-conformance')} ${dim(`v${version}`)}`,
    6: 'Real-time collaboration, held to',
    7: 'what people should experience.'
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
