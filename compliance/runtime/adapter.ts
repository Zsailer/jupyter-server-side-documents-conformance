import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import type { Capability } from './types';

/** What an adapter gets to work with. */
export interface AdapterContext {
  /** A page of the running JupyterLab, for requests that need its server settings (token, xsrf). */
  admin: IJupyterLabPageFixture;
  baseURL: string;
}

/**
 * The part of the backend the tests cannot reach through JupyterLab and the browser.
 *
 * The tests verify what a person sees: what is in their tab, in a fresh tab, and in the file. They need a backend's
 * help only to cause the events a story describes, and an adapter says which of these it can do. An adapter that does
 * nothing but declare `contents` is a valid adapter: it runs every story that needs nothing more.
 */
export interface BackendAdapter {
  readonly name: string;
  readonly capabilities: ReadonlySet<Capability>;

  /** The cells (sources) of the server's own live copy, or null if the server holds no copy of `path`. */
  serverCells?(ctx: AdapterContext, path: string): Promise<string[] | null>;

  /** The server lets go of the notebook, saving it; the next client to connect makes it build the notebook again. */
  releaseRoom?(ctx: AdapterContext, path: string): Promise<void>;

  /** Kill the server without a save. Every tab loses its connection. */
  crashServer?(ctx: AdapterContext): Promise<void>;
  /** Start the server again after a crash, on the same address, against the same files. */
  restartServer?(ctx: AdapterContext): Promise<void>;

  /** Lose or delay a message between a tab and the server. */
  wireFault?(ctx: AdapterContext, fault: 'lose-reply' | 'late-reply', tab: import('./tab').Tab): Promise<void>;

  /** Let an agent edit the notebook: through the server while it holds the notebook, else through the file. */
  agentEdit?(ctx: AdapterContext, path: string, cells: string[]): Promise<void>;
}

/**
 * Which adapter to use: `COMPLIANCE_ADAPTER` is `generic` (default), `jsd`, or the path of a module whose default
 * export is a BackendAdapter.
 */
export async function loadAdapter(): Promise<BackendAdapter> {
  const which = process.env.COMPLIANCE_ADAPTER || 'generic';
  const path = which === 'generic' || which === 'jsd' ? `../adapters/${which}` : which;
  let adapter: any = await import(path);
  // however the module was loaded (ES module, CommonJS, transpiled), the adapter is the object with `capabilities`
  while (adapter && !adapter.capabilities && adapter.default) {
    adapter = adapter.default;
  }
  if (!adapter || !adapter.capabilities) {
    throw new Error(`COMPLIANCE_ADAPTER=${which}: ${path} does not export a BackendAdapter as its default`);
  }
  return adapter as BackendAdapter;
}
