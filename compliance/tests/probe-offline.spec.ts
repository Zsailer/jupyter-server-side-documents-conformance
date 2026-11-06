// Why was the second browser of W1 so slow to load? W1 opens it while the first browser is offline and just after the
// server let go of the notebook. This measures the first part alone: how long a browser takes to start JupyterLab, with
// the first browser online, and with it offline. It runs only on purpose:
//   COMPLIANCE_PROBE=1 npx playwright test tests/probe-offline.spec.ts     (against a running server)
import { test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OfflineMode, prepareNetwork, setNetwork } from '../runtime/network';

const base = process.env.COMPLIANCE_BASE_URL ?? 'http://localhost:8899';

async function load(browser: Browser, mode: OfflineMode = 'emulate') {
  const context = await browser.newContext();
  await prepareNetwork(context, mode);
  const page = await context.newPage();
  const began = Date.now();
  await page.goto(`${base}/lab?reset`, { timeout: 90000 });
  await page.waitForFunction(() => Boolean((window as any).jupyterapp), undefined, { timeout: 90000 });
  await page.evaluate(async () => {
    await (window as any).jupyterapp.started;
  });
  return { context, page, seconds: (Date.now() - began) / 1000 };
}

const cases: [string, 'online' | OfflineMode, string][] = [
  ['online (control)', 'online', 'the first browser is online'],
  ['OFFLINE, as Playwright emulates it', 'emulate', 'the first browser is offline (setOffline)'],
  ['OFFLINE, cut inside the browser', 'cut', 'the first browser is offline (cut: requests refused, sockets closed)'],
  ['online (control, again)', 'online', 'the first browser is online']
];
for (const [label, how, said] of cases) {
  test(`probe: a second browser starts JupyterLab while the first is ${label}`, async ({ browser }) => {
    test.skip(process.env.COMPLIANCE_PROBE !== '1', 'a probe: run it on purpose with COMPLIANCE_PROBE=1');
    const first = await load(browser, how === 'cut' ? 'cut' : 'emulate');
    if (how !== 'online') {
      await setNetwork(first.context, true, how);
      await first.page.waitForTimeout(1500); // the first browser starts failing its requests
    }
    const second = await load(browser);
    const line = `PROBE  first browser ${first.seconds.toFixed(1)} s · second browser ${second.seconds.toFixed(1)} s · ${said}`;
    console.log(line);
    fs.mkdirSync(test.info().project.outputDir, { recursive: true });
    fs.appendFileSync(path.join(test.info().project.outputDir, 'probe.txt'), line + '\n'); // for the summary of the run
    test.info().annotations.push({ type: 'probe', description: line });
    await second.context.close();
    await first.context.close();
  });
}
