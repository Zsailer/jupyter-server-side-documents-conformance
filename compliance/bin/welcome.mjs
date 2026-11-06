// The welcome screen of `jupyter conformance`: what is shown when it is run with nothing to do. A pure function of the
// version and whether to use colour, so it is tested without a terminal.

const ORANGE = '38;5;208'; // the planet of the Jupyter logo
const GRAY = '38;5;244'; // its orbits and moons

/** The lines of the welcome screen. */
export function welcome({ version, color = true } = {}) {
  const paint = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const orbit = s => paint(GRAY, s);
  const planet = s => paint(ORANGE, s);
  const bold = s => paint('1', s);
  const dim = s => paint('2', s);

  // the logo: a planet between two orbits, with its moons
  return [
    '',
    `              ${orbit('•')}`,
    `     ${orbit('╭────────────────╮')}`,
    `          ${planet('▄██████▄')}           ${bold('jupyter conformance')} ${dim(`v${version}`)}`,
    `          ${planet('████████')}           Real-time collaboration, held to`,
    `          ${planet('▀██████▀')}           what people should experience.`,
    `     ${orbit('╰────────────────╯')}`,
    `     ${orbit('•')}`,
    '',
    '  Welcome! This plays a notebook backend through the situations people',
    '  really meet when they share a notebook: a tab goes offline and keeps',
    '  typing, the server lets go of a notebook, a file changes underneath.',
    '  Then it tells you which of them your backend gets right.',
    '',
    `  ${bold('Try one of these')}`,
    `    ${bold('jupyter conformance pick')}        choose stories from a list, then run them`,
    `    ${bold('jupyter conformance run Z3')}      run one story`,
    `    ${bold('jupyter conformance list')}        see every story, and what each needs`,
    `    ${bold('jupyter conformance help')}        everything it can do`,
    ''
  ];
}
