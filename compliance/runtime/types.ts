/**
 * What a backend can do for the compliance tests, beyond what any JupyterLab with real-time collaboration offers.
 *
 * Every story states what it needs (from the kinds of its steps). A story whose needs the adapter does not meet is
 * skipped, with the missing capabilities in the reason, so a report says what was verified and what was not.
 */
export type Capability =
  /** Read and write notebooks through the Contents API. Every adapter has this. */
  | 'contents'
  /** Read the cells of the server's own live copy of a notebook (otherwise a fresh tab is opened to see it). */
  | 'serverState'
  /** Make the server let go of a notebook (saving it); the next client rebuilds it from the file. */
  | 'releaseRoom'
  /** Kill the server without letting it save, and start it again. */
  | 'crashServer'
  /** Change the notebook file the way something outside Jupyter does (git, a sync tool, an editor, a restore). */
  | 'fileSystem'
  /** Lose or delay a message on the wire between a tab and the server. */
  | 'wireFaults'
  /** Let an AI agent edit the notebook, through the server or through the file. */
  | 'agent'
  /** The server keeps a history record of each notebook next to the file. */
  | 'historyRecord';

/** What the tests can do whatever the adapter: Playwright toggles the network of a tab. */
export const ALWAYS: ReadonlyArray<string> = ['network'];

/** How a cell is expected to read. A string is an exact match (surrounding whitespace ignored). */
export type Expect =
  | string
  | { /** the cell starts with `base` and holds every part, in any order (typing from two people) */ base: string; parts: string[] }
  | { /** the cell holds every one of these */ contains: string[] };

/** What a story says about itself. Generated; see compliance/generate.py. */
export interface StoryMeta {
  id: string;
  group: string;
  title: string;
  /** What the story needs from the backend, beyond the always-available. */
  requires: Capability[];
  /** The story's answer is still an open question: see `decisions`. */
  needsAlignment?: boolean;
  /** Applies only if the backend does something optional (e.g. keeps a history record). */
  appliesIf?: string[];
  /** The cells the notebook file holds at the start (names; see cells.ts). */
  /** Whether the order of the cells at the end is part of the answer. */
  ordered?: boolean;
  /** Notes the generator could not turn into an exact expectation: the story is checked more loosely. */
  loose?: string[];
}

/** What every copy must hold at the end, per lane. */
export type Ends = Partial<Record<'file' | 'server' | string, Expect[]>>;
