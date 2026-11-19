import type { AdapterContext, BackendAdapter } from '../runtime/adapter';
import { ask, supervised } from '../runtime/supervisor';
import type { Capability } from '../runtime/types';

/**
 * Any backend that implements the conformance control contract (docs/backend-contract.md): three endpoints under
 * `/conformance/` that let a test ask what the server holds for a notebook and make it let go of one. What the backend
 * can do is not written here: the server says so (`GET /conformance/capabilities`), and a server without the
 * endpoints is a backend that can do nothing beyond what a browser and the Contents API can.
 *
 *   GET  /conformance/capabilities            { backend, capabilities: [...] }
 *   GET  /conformance/room?path=…             { cells: [source, ...] }, or 404 if the server holds no copy
 *   POST /conformance/release-room?path=…     the server saves the notebook and lets go of it
 */
const KNOWN: ReadonlySet<string> = new Set(['serverState', 'releaseRoom']);

const capabilities = new Set<Capability>(['contents']);
if (process.env.COMPLIANCE_ROOT_DIR) {
  capabilities.add('fileSystem');
}
// the command that runs the tests started the server, so it can kill it and start it again (runtime/supervisor.ts)
if (supervised()) {
  capabilities.add('crashServer');
}

/** Ask the server what it offers. A server that does not answer offers nothing. */
export async function discover(baseURL: string, fetchImpl: typeof fetch = fetch): Promise<{ backend?: string; offered: Capability[] }> {
  try {
    const res = await fetchImpl(`${baseURL.replace(/\/$/, '')}/conformance/capabilities`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { offered: [] };
    }
    const body: any = await res.json();
    const offered = (Array.isArray(body.capabilities) ? body.capabilities : []).filter((c: unknown) => typeof c === 'string' && KNOWN.has(c));
    return { backend: typeof body.backend === 'string' ? body.backend : undefined, offered: offered as Capability[] };
  } catch {
    return { offered: [] };
  }
}

async function call(ctx: AdapterContext, subpath: string, method: 'GET' | 'POST'): Promise<{ status: number; body: any }> {
  return ctx.admin.evaluate(
    async ({ subpath, method }) => {
      const settings = (window as any).jupyterapp.serviceManager.serverSettings;
      const xsrf = document.cookie.match(/\b_xsrf=([^;]+)/)?.[1] ?? '';
      const headers: Record<string, string> = { 'X-XSRFToken': xsrf };
      if (settings.token) {
        headers['Authorization'] = `token ${settings.token}`;
      }
      const res = await fetch(settings.baseUrl + subpath, { method, headers });
      return { status: res.status, body: res.ok ? await res.json() : null };
    },
    { subpath, method }
  );
}

const adapter: BackendAdapter = {
  // the backend's own name, once the server has said it: known-gaps/<name>.json is looked up by it
  name: 'unknown',
  capabilities,

  async discover(baseURL) {
    const { backend, offered } = await discover(baseURL);
    if (backend) {
      (adapter as { name: string }).name = backend;
    }
    offered.forEach(c => capabilities.add(c));
  },

  async serverCells(ctx, path) {
    const { status, body } = await call(ctx, `conformance/room?path=${encodeURIComponent(path)}`, 'GET');
    if (status === 404) {
      return null;
    }
    if (status !== 200) {
      throw new Error(`conformance/room -> HTTP ${status}`);
    }
    return body.cells as string[];
  },

  async releaseRoom(ctx, path) {
    const { status } = await call(ctx, `conformance/release-room?path=${encodeURIComponent(path)}`, 'POST');
    if (status !== 200 && status !== 404) {
      throw new Error(`conformance/release-room -> HTTP ${status}`);
    }
  },

  async crashServer() {
    await ask('crash', 'crashed', 30_000);
  },

  async restartServer() {
    await ask('restart', 'restarted', 200_000);
  }
};

export default adapter;
