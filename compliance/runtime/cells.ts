import type { Expect } from './types';

/** A cell source as the Contents API and the shared model give it: a string, or a list of lines. */
export function sourceText(source: unknown): string {
  return Array.isArray(source) ? source.join('') : String(source ?? '');
}

const norm = (s: string): string => s.replace(/\r\n/g, '\n').trim();

/** Whether one cell reads as expected. */
export function cellMatches(actual: string, expected: Expect): boolean {
  const a = norm(actual);
  if (typeof expected === 'string') {
    return a === norm(expected);
  }
  if ('contains' in expected) {
    return expected.contains.every(part => a.includes(part));
  }
  return a.startsWith(norm(expected.base)) && expected.parts.every(part => a.includes(part));
}

export function describeExpect(e: Expect): string {
  if (typeof e === 'string') {
    return JSON.stringify(e);
  }
  if ('contains' in e) {
    return `a cell holding ${e.contains.map(p => JSON.stringify(p)).join(' and ')}`;
  }
  return `${JSON.stringify(e.base)} followed by ${e.parts.map(p => JSON.stringify(p)).join(' and ')} (any order)`;
}

export interface IMatch {
  ok: boolean;
  /** Why not, in the words of a person comparing two notebooks. */
  reason: string;
}

/**
 * Whether the cells of a notebook are the expected ones. Ordered, unless `ordered` is false (then any assignment of
 * the expected cells to the actual ones will do).
 */
export function matchCells(actual: string[], expected: Expect[], ordered = true): IMatch {
  if (actual.length !== expected.length) {
    return { ok: false, reason: `${actual.length} cells, expected ${expected.length}` };
  }
  if (ordered) {
    for (let i = 0; i < expected.length; i++) {
      if (!cellMatches(actual[i], expected[i])) {
        return { ok: false, reason: `cell ${i + 1} reads ${JSON.stringify(norm(actual[i]))}, expected ${describeExpect(expected[i])}` };
      }
    }
    return { ok: true, reason: '' };
  }
  const left = actual.slice();
  for (const e of expected) {
    const at = left.findIndex(a => cellMatches(a, e));
    if (at < 0) {
      return { ok: false, reason: `no cell reads as ${describeExpect(e)}` };
    }
    left.splice(at, 1);
  }
  return { ok: true, reason: '' };
}

/** The expected cells, for a message: one per line. */
export function showExpected(expected: Expect[]): string {
  return expected.map((e, i) => `  ${i + 1}. ${describeExpect(e)}`).join('\n');
}

export function showActual(actual: string[]): string {
  return actual.map((a, i) => `  ${i + 1}. ${JSON.stringify(norm(a))}`).join('\n') || '  (no cells)';
}

/** Helpers the generated tests use to say what a cell holds. */
export const E = {
  /** Starts with `base`, then holds every part in any order. */
  parts: (base: string, ...parts: string[]): Expect => ({ base, parts }),
  /** Holds every one of these. */
  contains: (...contains: string[]): Expect => ({ contains })
};

/**
 * The text a person types to add `piece` at the end of a cell. Typed text is separated from what is there by a space,
 * so a typed piece never glues itself to the code before it.
 */
export const typed = (piece: string): string => ' ' + piece;

/** A notebook (nbformat 4) holding code cells with these sources. `ids: false` gives the older format without cell ids. */
export function notebookJSON(sources: string[], ids = true): string {
  const cells = sources.map((source, i) => ({
    cell_type: 'code',
    ...(ids ? { id: `cell-${i}-${Math.random().toString(36).slice(2, 8)}` } : {}),
    metadata: {},
    source,
    outputs: [],
    execution_count: null
  }));
  return JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: ids ? 5 : 4 }, null, 1);
}
