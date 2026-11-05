import type { BrowserContext, Page } from '@playwright/test';

/**
 * Two ways to take one browser off the network.
 *
 * `emulate` is Playwright's own `context.setOffline()`. It is the simplest, but in Chromium it slows the start of every
 * other browser opened while it is on (a second browser took 6 s to start JupyterLab instead of 1 s), and a story with
 * several tabs opens browsers at all times.
 *
 * `cut` keeps the outage inside the one browser: its HTTP requests are refused (as ERR_INTERNET_DISCONNECTED, the error
 * a real outage gives) and its WebSockets are closed, and while it is cut every WebSocket it tries to open fails at once.
 */
export type OfflineMode = 'emulate' | 'cut';

export const OFFLINE_MODE: OfflineMode = process.env.COMPLIANCE_OFFLINE === 'cut' ? 'cut' : 'emulate';

/** Installed in every page of the browser before the page's own scripts run: it keeps track of the WebSockets. */
export const NETWORK_SHIM = `(() => {
  if (window.__nbs) return;
  const Native = window.WebSocket;
  const state = { offline: false, sockets: new Set() };
  window.__nbs = state;
  function Shim(url, protocols) {
    const target = state.offline ? 'ws://127.0.0.1:9/offline' : url;
    const ws = protocols === undefined ? new Native(target) : new Native(target, protocols);
    state.sockets.add(ws);
    ws.addEventListener('close', () => state.sockets.delete(ws));
    return ws;
  }
  Shim.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Shim[k] = Native[k];
  window.WebSocket = Shim;
})();`;

const cut = new WeakMap<BrowserContext, { offline: boolean; routed: boolean }>();

/** Call once, when the browser is made, before any page loads. Does nothing in `emulate` mode. */
export async function prepareNetwork(context: BrowserContext, mode: OfflineMode = OFFLINE_MODE): Promise<void> {
  if (mode !== 'cut') {
    return;
  }
  cut.set(context, { offline: false, routed: false });
  await context.addInitScript(NETWORK_SHIM);
}

/** Take the browser off the network, or put it back. */
export async function setNetwork(context: BrowserContext, offline: boolean, mode: OfflineMode = OFFLINE_MODE): Promise<void> {
  if (mode !== 'cut') {
    await context.setOffline(offline);
    return;
  }
  const state = cut.get(context);
  if (!state) {
    throw new Error('prepareNetwork() was not called when this browser was made');
  }
  state.offline = offline;
  if (!state.routed) {
    state.routed = true;
    await context.route('**/*', route => (state.offline ? route.abort('internetdisconnected') : route.fallback()));
  }
  await Promise.all(context.pages().map(page => apply(page, offline)));
}

async function apply(page: Page, offline: boolean): Promise<void> {
  await page
    .evaluate((off: boolean) => {
      const nbs = (window as any).__nbs;
      if (!nbs) {
        return;
      }
      nbs.offline = off;
      if (off) {
        for (const socket of Array.from(nbs.sockets as Set<WebSocket>)) {
          try {
            socket.close();
          } catch {
            /* already closed */
          }
        }
      }
    }, offline)
    .catch(() => undefined);
}
