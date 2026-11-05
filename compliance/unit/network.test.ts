// The part of "offline" that lives in the page: the WebSocket shim. No browser: a stand-in WebSocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_SHIM } from '../runtime/network.ts';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  closed = false;
  listeners: Record<string, Array<() => void>> = {};
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ||= []).push(fn);
  }
  close(): void {
    this.closed = true;
    (this.listeners.close || []).forEach(fn => fn());
  }
}

function page(): any {
  const window: any = { WebSocket: FakeSocket };
  new Function('window', NETWORK_SHIM)(window);
  return window;
}

test('online, a WebSocket is the page\'s own, and is looked after', () => {
  const w = page();
  const ws = new w.WebSocket('ws://server/api/room');
  assert.equal(ws.url, 'ws://server/api/room');
  assert.ok(ws instanceof FakeSocket, 'still a WebSocket to the page');
  assert.equal(w.__nbs.sockets.size, 1);
  ws.close();
  assert.equal(w.__nbs.sockets.size, 0, 'a closed socket is forgotten');
});

test('cutting the browser off closes every WebSocket', () => {
  const w = page();
  const a = new w.WebSocket('ws://server/a');
  const b = new w.WebSocket('ws://server/b');
  w.__nbs.offline = true;
  for (const s of Array.from(w.__nbs.sockets) as FakeSocket[]) s.close();
  assert.ok(a.closed && b.closed);
});

test('while it is cut, a WebSocket the page opens goes nowhere', () => {
  const w = page();
  w.__nbs.offline = true;
  const ws = new w.WebSocket('ws://server/room');
  assert.match(ws.url, /127\.0\.0\.1:9/, 'to a port nothing listens on, so it fails at once');
  w.__nbs.offline = false;
  assert.equal(new w.WebSocket('ws://server/room').url, 'ws://server/room', 'and normally again when it is back');
});
