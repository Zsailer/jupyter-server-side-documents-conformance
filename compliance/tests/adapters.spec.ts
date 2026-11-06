// The adapters load, however Playwright loads TypeScript, and say what they can do. No server, no browser.
import { expect, test } from '@playwright/test';
import { loadAdapter } from '../runtime/adapter';
import { discover } from '../adapters/http';

// these tests choose an adapter by changing the environment of the worker they run in: leave it as it was found, or
// the next test in the same worker would run with the wrong adapter
const before = process.env.COMPLIANCE_ADAPTER;
test.afterEach(() => {
  if (before === undefined) {
    delete process.env.COMPLIANCE_ADAPTER;
  } else {
    process.env.COMPLIANCE_ADAPTER = before;
  }
});

for (const name of ['generic', 'http']) {
  test(`the ${name} adapter loads and declares what it can do`, async () => {
    process.env.COMPLIANCE_ADAPTER = name;
    const adapter = await loadAdapter();
    expect(adapter.capabilities.has('contents')).toBe(true);
  });
}

test('the http adapter is the default, and offers nothing until the server says what it can do', async () => {
  delete process.env.COMPLIANCE_ADAPTER;
  const adapter = await loadAdapter();
  expect(adapter.name).toBe('unknown');
  expect(adapter.capabilities.has('releaseRoom')).toBe(false);
  expect(adapter.capabilities.has('serverState')).toBe(false);
});

const answering = (status: number, body?: unknown) => (async () => ({ ok: status === 200, status, json: async () => body })) as unknown as typeof fetch;

test('a server that implements the contract says what it can do', async () => {
  const got = await discover('http://x:1/', answering(200, { backend: 'jsd', capabilities: ['serverState', 'releaseRoom', 'telepathy'] }));
  expect(got.backend).toBe('jsd');
  expect(got.offered).toEqual(['serverState', 'releaseRoom']); // what the tests do not know is ignored
});

test('a server without the endpoints, or that is not there, offers nothing', async () => {
  expect((await discover('http://x:1', answering(404))).offered).toEqual([]);
  const refused = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  expect((await discover('http://x:1', refused)).offered).toEqual([]);
});

test('an adapter that is not one is refused, with a message', async () => {
  process.env.COMPLIANCE_ADAPTER = '../runtime/types';
  await expect(loadAdapter()).rejects.toThrow(/does not export a BackendAdapter/);
});
