// The adapters load, however Playwright loads TypeScript, and say what they can do. No server, no browser.
import { expect, test } from '@playwright/test';
import { loadAdapter } from '../runtime/adapter';

for (const name of ['generic', 'jsd']) {
  test(`the ${name} adapter loads and declares what it can do`, async () => {
    process.env.COMPLIANCE_ADAPTER = name;
    const adapter = await loadAdapter();
    expect(adapter.name).toBe(name);
    expect(adapter.capabilities.has('contents')).toBe(true);
  });
}

test('the jsd adapter can release a room and say what the server holds; the generic one cannot', async () => {
  process.env.COMPLIANCE_ADAPTER = 'jsd';
  const jsd = await loadAdapter();
  expect(jsd.capabilities.has('releaseRoom')).toBe(true);
  expect(jsd.capabilities.has('serverState')).toBe(true);
  process.env.COMPLIANCE_ADAPTER = 'generic';
  const generic = await loadAdapter();
  expect(generic.capabilities.has('releaseRoom')).toBe(false);
});

test('an adapter that is not one is refused, with a message', async () => {
  process.env.COMPLIANCE_ADAPTER = '../runtime/types';
  await expect(loadAdapter()).rejects.toThrow(/does not export a BackendAdapter/);
});
