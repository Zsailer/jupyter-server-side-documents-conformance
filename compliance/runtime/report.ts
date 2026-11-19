/**
 * What a run looks like to a person: one line per story as it finishes, then a short summary. Pure functions, so they can
 * be tested without a browser; reporter.ts is the thin Playwright part.
 */

export type Kind = 'pass' | 'fail' | 'gap' | 'miss' | 'skip';

export interface Row {
  id: string;
  title: string;
  kind: Kind;
  /** Why: the first line of a failure, the reason for a skip, what a known gap or a miss says. */
  detail: string;
  ms: number;
}

/** The parts of Playwright's TestCase and TestResult that a row is made from. */
export interface TestLike {
  title: string;
  annotations: { type: string; description?: string }[];
  expectedStatus: string;
}
export interface ResultLike {
  status: string;
  duration: number;
  error?: { message?: string };
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** The first line of an error that tells a person what went wrong: for a step, which step and then why. */
export function reason(message: string | undefined): string {
  const lines = (message ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^(\w*Error: )/, ''));
  if (!lines.length) {
    return 'failed';
  }
  const first = lines[0].startsWith('step ') && lines[1] ? `${lines[0]} — ${lines[1]}` : lines[0];
  return first.length > 150 ? `${first.slice(0, 149)}…` : first;
}

export function rowOf(test: TestLike, result: ResultLike): Row {
  const m = /^(\S+) · (.*)$/.exec(test.title);
  const id = m ? m[1] : test.title;
  const title = m ? m[2] : '';
  const note = (type: string): string | undefined => test.annotations.find(a => a.type === type)?.description;
  const base = { id, title, ms: result.duration };

  if (result.status === 'skipped') {
    return { ...base, kind: 'skip', detail: note('skip') ?? 'skipped' };
  }
  const missed = note('proposed-not-met');
  if (missed !== undefined) {
    return { ...base, kind: 'miss', detail: missed };
  }
  const failed = result.status !== 'passed';
  if (test.expectedStatus === 'failed') {
    // a known gap is expected to fail: it failing is fine, and it passing means the entry is stale
    return failed
      ? { ...base, kind: 'gap', detail: note('known-gap') ?? 'known gap' }
      : { ...base, kind: 'fail', detail: 'now passes: remove it from the known gaps' };
  }
  return failed ? { ...base, kind: 'fail', detail: reason(result.error?.message) } : { ...base, kind: 'pass', detail: '' };
}

export interface Style {
  color: boolean;
}

const paint = (style: Style, code: string, text: string): string => (style.color ? `\u001b[${code}m${text}\u001b[0m` : text);
export const dim = (s: Style, t: string) => paint(s, '2', t);
export const bold = (s: Style, t: string) => paint(s, '1', t);
const green = (s: Style, t: string) => paint(s, '32', t);
const red = (s: Style, t: string) => paint(s, '31', t);
const yellow = (s: Style, t: string) => paint(s, '33', t);

export function seconds(ms: number): string {
  if (ms < 10000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const MARK: Record<Kind, (s: Style) => string> = {
  pass: s => green(s, '✓'),
  fail: s => red(s, '✗'),
  gap: s => yellow(s, '◐'),
  miss: s => yellow(s, '◇'),
  skip: s => dim(s, '○')
};

/** The width of the name column: the longest name a story has today, so that the times line up. */
export const NAME_WIDTH = 42;

/**
 * The line printed when a story finishes: its name says what it is about, so a pass is that and the time. Anything else
 * says under it which story that is in words, and why.
 */
export function rowLines(row: Row, style: Style): string[] {
  const time = dim(style, seconds(row.ms));
  const head = `  ${MARK[row.kind](style)} ${bold(style, row.id.padEnd(NAME_WIDTH))} ${time}`;
  if (row.kind === 'pass') {
    return [head];
  }
  const why = row.kind === 'fail' ? red(style, row.detail) : dim(style, row.kind === 'gap' ? `known gap: ${row.detail}` : `proposed, not met: ${row.detail}`);
  return [head, `    ${dim(style, row.title)}`, `    ${why}`];
}

/** Names joined with commas, on as many lines as it takes to keep each within `width`. */
export function wrapList(names: string[], width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const name of names) {
    const next = line ? `${line}, ${name}` : name;
    if (line && next.length > width) {
      lines.push(`${line},`);
      line = name;
    } else {
      line = next;
    }
  }
  return line ? [...lines, line] : lines;
}

/** The end of a run: the counts, why stories were skipped, and what to do next. */
export function summaryLines(rows: Row[], ms: number, style: Style): string[] {
  const count = (k: Kind) => rows.filter(r => r.kind === k).length;
  const parts = [
    green(style, `${count('pass')} passed`),
    count('fail') ? red(style, `${count('fail')} failed`) : undefined,
    count('gap') ? yellow(style, `${count('gap')} known ${count('gap') === 1 ? 'gap' : 'gaps'}`) : undefined,
    count('miss') ? yellow(style, `${count('miss')} proposed, not met`) : undefined,
    count('skip') ? dim(style, `${count('skip')} skipped`) : undefined
  ].filter(Boolean) as string[];

  const lines = ['', `  ${parts.join(dim(style, '  ·  '))}   ${dim(style, seconds(ms))}`];

  const skipped = new Map<string, string[]>();
  for (const r of rows.filter(r => r.kind === 'skip')) {
    skipped.set(r.detail, [...(skipped.get(r.detail) ?? []), r.id]);
  }
  if (skipped.size) {
    lines.push('', `  ${dim(style, 'Skipped')}`);
    for (const [why, ids] of [...skipped].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`  ${dim(style, `${String(ids.length).padStart(3)}  ${why}`)}`);
      for (const line of wrapList(ids, 88)) {
        lines.push(`        ${dim(style, line)}`);
      }
    }
  }
  return lines;
}
