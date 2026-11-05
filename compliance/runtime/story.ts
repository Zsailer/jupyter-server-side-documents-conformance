import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Browser, TestInfo } from '@playwright/test';
import { ALWAYS, Capability, Ends, Expect, StoryMeta } from './types';
import { AdapterContext, BackendAdapter, loadAdapter } from './adapter';
import { matchCells, notebookJSON, showActual, showExpected } from './cells';
import { Tab, TabEnv, WAIT } from './tab';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

export { E, typed } from './cells';

/**
 * Which option of a decision to hold the backend to, per story: `COMPLIANCE_DECISIONS='{"Z3":1}'` picks the second
 * option of Z3. The default is the proposed one (the first).
 */
function chosenOption(id: string, count: number): number {
  const chosen = JSON.parse(process.env.COMPLIANCE_DECISIONS || '{}')[id];
  return typeof chosen === 'number' && chosen >= 0 && chosen < count ? chosen : 0;
}

/** What a story's body works with. */
export class Story {
  /** The path of the notebook on the server. */
  path = '';
  private readonly tabs = new Map<string, Tab>();

  constructor(
    readonly meta: StoryMeta,
    readonly adapter: BackendAdapter,
    private readonly ctx: AdapterContext,
    private readonly env: TabEnv,
    private readonly dir: string
  ) {}

  /** Create the notebook file the story starts from. `ids: false` makes an older notebook without cell ids. */
  async notebook(sources: string[], opts: { ids?: boolean } = {}): Promise<void> {
    this.path = `${this.dir}/${this.meta.id.toLowerCase()}.ipynb`;
    await this.ctx.admin.contents.uploadContent(notebookJSON(sources, opts.ids !== false), 'text', this.path);
  }

  /** A tab of the story. It exists from the start, but is not in a browser until it opens the notebook. */
  tab(name: string): Tab {
    let tab = this.tabs.get(name);
    if (!tab) {
      tab = new Tab(name, this.env, this.path);
      this.tabs.set(name, tab);
    }
    return tab;
  }

  /** One step of the storyboard: it shows in the report under the words the storyboard uses. */
  async step(n: number, who: string, text: string, body: () => Promise<void>): Promise<void> {
    await test.step(`${n}. ${who} ${text}`, body);
  }

  // ---- the server and the file ----

  /** The server lets go of the notebook, saving it, and builds it again from the file when it is next needed. */
  async releaseRoom(): Promise<void> {
    await this.adapter.releaseRoom!(this.ctx, this.path);
  }

  async crashServer(): Promise<void> {
    await this.adapter.crashServer!(this.ctx);
  }

  async restartServer(): Promise<void> {
    await this.adapter.restartServer!(this.ctx);
  }

  /** The file is changed from outside Jupyter. */
  async writeFileOutside(sources: string[], opts: { ids?: boolean } = {}): Promise<void> {
    const root = process.env.COMPLIANCE_ROOT_DIR!;
    fs.writeFileSync(nodePath.join(root, this.path), notebookJSON(sources, opts.ids !== false));
  }

  async removeFileOutside(): Promise<void> {
    fs.rmSync(nodePath.join(process.env.COMPLIANCE_ROOT_DIR!, this.path), { force: true });
  }

  /** What the file holds now. */
  async fileCells(): Promise<string[] | null> {
    return this.ctx.admin.evaluate(async (p: string) => {
      const settings = (window as any).jupyterapp.serviceManager.serverSettings;
      const res = await fetch(settings.baseUrl + 'api/contents/' + encodeURI(p) + '?content=1&type=notebook&_=' + Date.now(), {
        headers: settings.token ? { Authorization: `token ${settings.token}` } : {}
      });
      if (!res.ok) {
        return null;
      }
      const model = await res.json();
      return model.content.cells.map((c: any) => (Array.isArray(c.source) ? c.source.join('') : c.source));
    }, this.path);
  }

  /** What the server's own copy holds: from the backend if it can say, else what a fresh tab opens with. */
  async serverCells(): Promise<string[] | null> {
    if (this.adapter.capabilities.has('serverState') && this.adapter.serverCells) {
      return this.adapter.serverCells(this.ctx, this.path);
    }
    const probe = new Tab('probe', this.env, this.path);
    try {
      await probe.open();
      return await probe.cells();
    } finally {
      await probe.close();
    }
  }

  /** A message between a tab and the server is lost or late. */
  async wireFault(fault: 'lose-reply' | 'late-reply', tab: Tab): Promise<void> {
    await this.adapter.wireFault!(this.ctx, fault, tab);
  }

  /** An AI agent edits the notebook so that it reads as `sources`. */
  async agent(_what: string, sources: string[]): Promise<void> {
    await this.adapter.agentEdit!(this.ctx, this.path, sources);
  }

  // ---- waiting for things to settle ----

  /**
   * Wait until what a tab did online has reached the server, so that what happens next (the connection dropping, the
   * server letting go) finds it there. With a backend that can say what the server holds this waits for that; without
   * one it gives the edit a moment.
   */
  async settle(tab: Tab): Promise<void> {
    if (this.adapter.capabilities.has('serverState') && this.adapter.serverCells) {
      const mine = await tab.cells();
      await expect
        .poll(async () => JSON.stringify(await this.adapter.serverCells!(this.ctx, this.path)), {
          timeout: WAIT.eventually,
          message: `${tab.name}: what it did never reached the server`
        })
        .toBe(JSON.stringify(mine));
    } else {
      await tab.page!.waitForTimeout(Number(process.env.COMPLIANCE_SETTLE_MS ?? 750));
    }
  }

  /**
   * Check what a place holds, waiting for it to get there and then for it to stay: a duplicate that arrives late is
   * a failure too.
   */
  async expectCells(
    where: string,
    read: () => Promise<string[] | null>,
    expected: Expect[],
    opts: { ordered?: boolean; timeout?: number; stable?: number } = {}
  ): Promise<void> {
    const ordered = opts.ordered ?? this.meta.ordered ?? true;
    const timeout = opts.timeout ?? WAIT.eventually;
    const stable = opts.stable ?? WAIT.stable;
    const started = Date.now();
    let actual: string[] | null = null;
    let verdict = { ok: false, reason: 'nothing to read' };
    while (Date.now() - started < timeout) {
      actual = await read();
      verdict = actual ? matchCells(actual, expected, ordered) : { ok: false, reason: 'does not hold the notebook' };
      if (verdict.ok) {
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    const fail = (why: string) => {
      throw new Error(`${where}: ${why}\n\nexpected:\n${showExpected(expected)}\n\nactual:\n${showActual(actual ?? [])}`);
    };
    if (!verdict.ok) {
      fail(verdict.reason);
    }
    const settledAt = Date.now();
    while (Date.now() - settledAt < stable) {
      await new Promise(r => setTimeout(r, 250));
      actual = await read();
      const again = actual ? matchCells(actual, expected, ordered) : { ok: false, reason: 'no longer holds the notebook' };
      if (!again.ok) {
        fail(`${again.reason} (it changed after it had settled)`);
      }
    }
  }

  /** What a tab shows, now. */
  async expectTab(tab: Tab, expected: Expect[], opts: { ordered?: boolean; timeout?: number; stable?: number } = {}): Promise<void> {
    await this.expectCells(`tab "${tab.name}"`, () => tab.cells(), expected, { timeout: 5000, stable: 0, ...opts });
  }

  /** What a tab shows once everything has arrived. */
  async expectTabEventually(tab: Tab, expected: Expect[], opts: { ordered?: boolean; timeout?: number; stable?: number } = {}): Promise<void> {
    await this.expectCells(`tab "${tab.name}"`, () => tab.cells(), expected, opts);
  }

  /** What the file holds once it has been saved. */
  async expectFile(expected: Expect[], opts: { ordered?: boolean } = {}): Promise<void> {
    await this.expectCells('the file', () => this.fileCells(), expected, { timeout: WAIT.save, ...opts });
  }

  /**
   * Wait until every copy a person could look at (each open tab, and the server if it can be read cheaply) shows the
   * same cells. A tab that was offline has not caught up until it agrees with the others, and a check made before then
   * could pass on the strength of a copy that has not yet been told. Returns why not, if they never agree.
   */
  private async converge(): Promise<string | null> {
    const readers: { name: string; read: () => Promise<string[] | null> }[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.isOpen) {
        readers.push({ name: `tab "${tab.name}"`, read: () => tab.cells() });
      }
    }
    if (this.adapter.capabilities.has('serverState') && this.adapter.serverCells) {
      readers.push({ name: 'the server', read: () => this.serverCells() });
    }
    if (readers.length < 2) {
      return null;
    }
    const started = Date.now();
    let seen: (string[] | null)[] = [];
    while (Date.now() - started < WAIT.eventually) {
      seen = await Promise.all(readers.map(r => r.read()));
      if (seen.every(s => s !== null && JSON.stringify(s) === JSON.stringify(seen[0]))) {
        return null;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return (
      'the copies never agreed with each other:\n' +
      readers.map((r, i) => `\n${r.name}:\n${showActual(seen[i] ?? [])}`).join('\n')
    );
  }

  /**
   * How the story must end: what every copy holds. `options[0]` is the proposed answer; if the story is an open
   * question the others are its alternatives, and `COMPLIANCE_DECISIONS` picks which one is held to.
   *
   * It waits for the copies to agree, then reports every copy that is wrong, not only the first.
   */
  async ends(options: Ends[]): Promise<void> {
    const ends = options[chosenOption(this.meta.id, options.length)];
    await test.step('the end: every copy holds what the storyboard says', async () => {
      const failures: string[] = [];
      const disagreement = await this.converge();
      if (disagreement) {
        failures.push(disagreement);
      }
      // once the copies have agreed there is nothing to wait for; if they have not, say what each holds and move on
      const quick = disagreement ? { timeout: 2000, stable: 0 } : {};
      for (const [lane, expected] of Object.entries(ends)) {
        if (!expected) {
          continue;
        }
        try {
          if (lane === 'file') {
            await this.expectFile(expected);
          } else if (lane === 'server') {
            await this.expectCells('the server', () => this.serverCells(), expected, quick);
          } else {
            const tab = this.tabs.get(lane);
            if (tab?.isOpen) {
              await this.expectTabEventually(tab, expected, quick);
            }
          }
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      if (failures.length) {
        throw new Error(failures.join('\n\n----\n\n'));
      }
    });
  }

  async closeAll(): Promise<void> {
    for (const tab of this.tabs.values()) {
      await tab.close().catch(() => undefined);
    }
  }
}

interface Fixtures {
  browser: Browser;
  baseURL?: string;
  page: IJupyterLabPageFixture;
  tmpPath: string;
  waitForApplication: TabEnv['waitForApplication'];
}

/**
 * The arguments of `test()` for one storyboard: `test(...story(meta, async s => { ... }))`. The generated file calls
 * `test()` itself, so that Playwright reports each story in the file it is in.
 *
 * The test is skipped, with the reason, if the backend adapter lacks something the story needs.
 */
export function story(
  meta: StoryMeta,
  body: (s: Story) => Promise<void>
): [string, { tag: string[] }, (fixtures: Fixtures, testInfo: TestInfo) => Promise<void>] {
  const tag = ['@compliance', `@group-${meta.group}`].concat(meta.needsAlignment ? ['@needs-alignment'] : []);
  return [
    `${meta.id} · ${meta.title}`,
    { tag },
    async ({ browser, baseURL, page, tmpPath, waitForApplication }, testInfo) => {
      const adapter = await loadAdapter();
      const have = new Set<string>([...adapter.capabilities, ...ALWAYS]);
      const missing = meta.requires.filter((c: Capability) => !have.has(c));
      testInfo.annotations.push({ type: 'needs', description: meta.requires.join(', ') || 'nothing beyond a plain JupyterLab' });
      if (meta.needsAlignment) {
        testInfo.annotations.push({ type: 'needs-alignment', description: 'the storyboard still asks a question; the proposed answer is held to' });
      }
      if (meta.loose?.length) {
        testInfo.annotations.push({ type: 'checked-loosely', description: meta.loose.join('; ') });
      }
      test.skip(missing.length > 0, `adapter "${adapter.name}" cannot: ${missing.join(', ')}`);

      const ctx: AdapterContext = { admin: page, baseURL: baseURL! };
      const env: TabEnv = { browser, baseURL: baseURL!, waitForApplication, dir: tmpPath };
      const s = new Story(meta, adapter, ctx, env, tmpPath);
      try {
        await body(s);
      } finally {
        await s.closeAll();
      }
    }
  ];
}
