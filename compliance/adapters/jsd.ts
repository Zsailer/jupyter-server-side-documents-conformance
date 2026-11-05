import type { AdapterContext, BackendAdapter } from '../runtime/adapter';
import type { Capability } from '../runtime/types';
import { sourceText } from '../runtime/cells';

/**
 * jupyter-server-documents, through the test-only server extension its own UI tests use
 * (`ui-tests/jsd_test_ext.py`, enabled by `ui-tests/jupyter_server_test_config.py`). Never enable that extension in
 * production.
 *
 *   GET  /jsd-test/room-info?path=…       the server's live copy of a notebook, or 404 if it holds none
 *   POST /jsd-test/recreate-room?path=…   the server lets go of the notebook, saving it
 */
const capabilities = new Set<Capability>(['contents', 'serverState', 'releaseRoom']);
if (process.env.COMPLIANCE_ROOT_DIR) {
  capabilities.add('fileSystem');
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
  name: 'jsd',
  capabilities,

  async serverCells(ctx, path) {
    const { status, body } = await call(ctx, `jsd-test/room-info?path=${encodeURIComponent(path)}`, 'GET');
    if (status === 404) {
      return null;
    }
    if (status !== 200) {
      throw new Error(`room-info -> HTTP ${status}`);
    }
    const source = body.source;
    const cells = typeof source === 'string' ? JSON.parse(source).cells : source.cells;
    return cells.map((c: any) => sourceText(c.source));
  },

  async releaseRoom(ctx, path) {
    const { status } = await call(ctx, `jsd-test/recreate-room?path=${encodeURIComponent(path)}`, 'POST');
    if (status !== 200 && status !== 404) {
      throw new Error(`recreate-room -> HTTP ${status}`);
    }
  }
};

export default adapter;
