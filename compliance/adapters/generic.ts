import type { BackendAdapter } from '../runtime/adapter';
import type { Capability } from '../runtime/types';

/**
 * Any JupyterLab with real-time collaboration, and nothing else known about it.
 *
 * It can do what the browser and the Contents API can do, so it runs every story whose steps are people typing,
 * adding, moving and deleting cells, tabs going offline and coming back, and tabs opening and closing. With
 * `COMPLIANCE_ROOT_DIR` (the folder the server serves) it can also change the file from outside.
 */
const capabilities = new Set<Capability>(['contents']);
if (process.env.COMPLIANCE_ROOT_DIR) {
  capabilities.add('fileSystem');
}

const adapter: BackendAdapter = { name: 'generic', capabilities };
export default adapter;
