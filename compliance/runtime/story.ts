import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Browser, TestInfo } from '@playwright/test';
import { ALWAYS, Capability, Ending, Expect, StoryMeta } from './types';
import { AdapterContext, BackendAdapter, loadAdapter } from './adapter';
import { matchCells, notebookJSON, showActual, showExpected } from './cells';
import { Tab, TabEnv, WAIT } from './tab';
import { keepLook, Recorder } from './recording';
import { byName, fileNameOf } from './names';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

export { E, typed } from './cells';

/**
 * Which option of a decision to hold the backend to, per story: `COMPLIANCE_DECISIONS='{"conflict/delete-while-typing":1}'`
 * picks the second option of that story (its old name works too). The default is the proposed one (the first).
 */
function chosenOption(meta: StoryMeta, count: number): number {
  const chosen = byName(JSON.parse(process.env.COMPLIANCE_DECISIONS || '{}'), meta);
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
  ) {
    this.recorder = env.recorder;
  }

  private readonly recorder: Recorder;

  /** Create the notebook file the story starts from. `ids: false` makes an older notebook without cell ids. */
  async notebook(sources: string[], opts: { ids?: boolean } = {}): Promise<void> {
    this.path = `${this.dir}/${fileNameOf(this.meta)}.ipynb`;
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
    const name = `${n}. ${who} ${text}`;
    this.recorder.step(name);
    try {
      await test.step(name, body);
    } catch (e) {
      await this.showTabs(`step ${n}`);
      const error = e as Error;
      error.message = `step ${name}\n\n${error.message}`;
      throw error;
    }
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
      // Jupyter Server gives a notebook as an object; a backend that gives it as its JSON text holds the same file
      const notebook = typeof model.content === 'string' ? JSON.parse(model.content) : model.content;
      return notebook.cells.map((c: any) => (Array.isArray(c.source) ? c.source.join('') : c.source));
    }, this.path);
  }

  /** What the server's own copy holds: from the backend if it can say, else what a fresh tab opens with. */
  async serverCells(): Promise<string[] | null> {
    if (this.adapter.capabilities.has('serverState') && this.adapter.serverCells) {
      return this.adapter.serverCells(this.ctx, this.path);
    }
    const probe = new Tab('probe', this.env, this.path, false);
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
  async expectFile(expected: Expect[], opts: { ordered?: boolean; timeout?: number; stable?: number } = {}): Promise<void> {
    await this.expectCells('the file', () => this.fileCells(), expected, { timeout: WAIT.save, ...opts });
  }

  /**
   * Wait until every copy a person could look at (each open tab, and the server if it can be read cheaply) shows the
   * same cells, and keeps showing them for a moment. A tab that was offline has not caught up until it agrees with the
   * others, and a check made before then could pass on the strength of a copy that has not yet been told.
   *
   * Returns what they agree on, or why they never did; `compared` says whether there was more than one copy to compare.
   */
  private async converge(): Promise<{ compared: boolean; agreed: string[] | null; why: string | null }> {
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
      return { compared: false, agreed: null, why: null };
    }
    const started = Date.now();
    let seen: (string[] | null)[] = [];
    let since = 0;
    while (Date.now() - started < WAIT.eventually + WAIT.stable) {
      seen = await Promise.all(readers.map(r => r.read()));
      const same = seen.every(s => s !== null && JSON.stringify(s) === JSON.stringify(seen[0]));
      if (!same) {
        since = 0;
      } else if (since === 0) {
        since = Date.now();
      } else if (Date.now() - since >= WAIT.stable) {
        return { compared: true, agreed: seen[0], why: null };
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return {
      compared: true,
      agreed: null,
      why: 'the copies never agreed with each other:\n' + readers.map((r, i) => `\n${r.name}:\n${showActual(seen[i] ?? [])}`).join('\n')
    };
  }

  /** What every place a person could look holds now, without waiting for it to change. */
  private async observe(): Promise<Record<string, string[] | null>> {
    const seen: Record<string, string[] | null> = {};
    for (const [name, tab] of this.tabs) {
      if (tab.isOpen) {
        seen[name] = await tab.cells();
      }
    }
    if (this.adapter.capabilities.has('serverState') && this.adapter.serverCells) {
      seen.server = await this.serverCells();
    }
    seen.file = await this.fileCells();
    return seen;
  }

  /**
   * Which of the endings the storyboard names the backend actually does, lane by lane: for an open question the useful
   * answer is not pass or fail but "this is the option it implements".
   */
  private implemented(endings: Ending[], seen: Record<string, string[] | null>): string[] {
    const ordered = this.meta.ordered ?? true;
    const lines: string[] = [];
    endings.forEach((ending, i) => {
      const matched: string[] = [];
      const missed: string[] = [];
      for (const [lane, expected] of Object.entries(ending.ends)) {
        const actual = seen[lane];
        if (!expected || actual === undefined) {
          continue; // a place that cannot be looked at
        }
        (actual !== null && matchCells(actual, expected, ordered).ok ? matched : missed).push(lane);
      }
      const what = `option ${i + 1}${i === 0 ? ' (proposed)' : ''}: ${ending.label}`;
      if (matched.length && !missed.length) {
        lines.push(`does   ${what}`);
      } else if (matched.length) {
        lines.push(`partly ${what}  (${matched.join(', ')}; not ${missed.join(', ')})`);
      }
    });
    return lines.length ? lines : ['matches none of the options the storyboard names'];
  }

  /**
   * How the story must end: what every copy holds. `endings[0]` is the proposed answer; if the story is an open
   * question the others are its alternatives, and `COMPLIANCE_DECISIONS` picks which one is held to.
   *
   * It waits for the copies to agree, then reports every copy that is wrong, not only the first. For an open question it
   * also says which of the storyboard's options the backend does.
   */
  async ends(endings: Ending[]): Promise<void> {
    const ends = endings[chosenOption(this.meta, endings.length)].ends;
    this.recorder.step('The end: every copy is compared with what the storyboard says');
    await test.step('the end: every copy holds what the storyboard says', async () => {
      const failures: string[] = [];
      const copies = await this.converge();
      if (copies.why) {
        failures.push(copies.why);
      }
      // Once the copies have agreed and stayed agreed there is nothing left to wait for: look once. (If they have not,
      // say what each holds and move on.) The file is the exception: it is saved a little after the others.
      const look = copies.compared ? { timeout: 1500, stable: 0 } : {};
      for (const [lane, expected] of Object.entries(ends)) {
        if (!expected) {
          continue;
        }
        try {
          if (lane === 'file') {
            const now = await this.fileCells();
            const caughtUp = copies.agreed !== null && now !== null && JSON.stringify(now) === JSON.stringify(copies.agreed);
            await this.expectFile(expected, caughtUp ? { timeout: 1500, stable: 0 } : {});
          } else if (lane === 'server') {
            await this.expectCells('the server', () => this.serverCells(), expected, look);
          } else {
            const tab = this.tabs.get(lane);
            if (tab?.isOpen) {
              await this.expectTabEventually(tab, expected, look);
            }
          }
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      let verdict: string[] = [];
      if (endings.length > 1) {
        verdict = this.implemented(endings, await this.observe());
        const info = test.info();
        info.annotations.push({ type: 'does', description: verdict.join(' | ') });
        fs.mkdirSync(info.project.outputDir, { recursive: true });
        fs.appendFileSync(nodePath.join(info.project.outputDir, 'implements.jsonl'), JSON.stringify({ id: this.meta.id, title: this.meta.title, verdict }) + '\n');
      }
      this.recorder.step(failures.length ? 'The end: a copy is not what the storyboard says' : 'The end: every copy holds what the storyboard says');
      if (failures.length) {
        await this.showTabs('the end');
        const which = verdict.length ? `\n\nOf the options the storyboard names, this backend:\n  ${verdict.join('\n  ')}` : '';
        throw new Error(failures.join('\n\n----\n\n') + which);
      }
    });
  }

  /** Keep a picture of every open tab: what each looked like when something went wrong. */
  private async showTabs(when: string): Promise<void> {
    for (const tab of this.tabs.values()) {
      if (tab.page) {
        await keepLook(this.recorder.dir, tab.name, when, tab.page as any);
      }
    }
  }

  /** What a person would have had to do or seen, worth saying in the summary of the run. */
  private keepNotes(): void {
    const info = test.info();
    for (const note of this.recorder.notes) {
      info.annotations.push({ type: 'a person would have noticed', description: note });
    }
    if (this.recorder.notes.length) {
      fs.mkdirSync(info.project.outputDir, { recursive: true });
      for (const note of this.recorder.notes) {
        fs.appendFileSync(nodePath.join(info.project.outputDir, 'notes.jsonl'), JSON.stringify({ id: this.meta.id, note }) + '\n');
      }
    }
  }

  /** Close every tab, which completes their videos, and put the videos in the report. */
  async closeAll(): Promise<void> {
    for (const tab of this.tabs.values()) {
      await tab.close().catch(() => undefined);
    }
    const info = test.info();
    for (const rec of this.recorder.tabs) {
      if (rec.file) {
        await info.attach(`video: ${rec.name}`, { path: rec.file, contentType: 'video/webm' }).catch(() => undefined);
      }
    }
    this.keepNotes();
    const watch = this.recorder.finish();
    if (watch) {
      await info.attach('watch every tab side by side (open this file)', { path: watch, contentType: 'text/html' }).catch(() => undefined);
      console.log(`watch every tab side by side: ${watch}`);
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
/**
 * The accepted stories a backend is known not to meet yet, with why: the file named by COMPLIANCE_KNOWN_GAPS (so the
 * backend's own repo can keep it), else known-gaps/<adapter>.json.
 */
function knownGaps(adapterName: string): Record<string, string> {
  const file = process.env.COMPLIANCE_KNOWN_GAPS || nodePath.join(__dirname, '..', 'known-gaps', `${adapterName}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

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
      await adapter.discover?.(baseURL!);
      const have = new Set<string>([...adapter.capabilities, ...ALWAYS]);
      const missing = meta.requires.filter((c: Capability) => !have.has(c));
      testInfo.annotations.push({ type: 'needs', description: meta.requires.join(', ') || 'nothing beyond a plain JupyterLab' });
      if (meta.needsAlignment) {
        testInfo.annotations.push({ type: 'needs-alignment', description: 'the storyboard still asks a question; the proposed answer is held to' });
      }
      if (meta.loose?.length) {
        testInfo.annotations.push({ type: 'checked-loosely', description: meta.loose.join('; ') });
      }
      if (meta.proposed) {
        testInfo.annotations.push({ type: 'proposed', description: 'not agreed yet: a miss is reported, not failed' });
      }
      const gap = byName(knownGaps(adapter.name), meta);
      if (gap) {
        testInfo.annotations.push({ type: 'known-gap', description: gap });
        test.fail(true, `known gap in "${adapter.name}": ${gap}`);
      }
      test.skip(Boolean(meta.internal), `not checkable from the user's side: ${meta.internal}`);
      test.skip(missing.length > 0, `adapter "${adapter.name}" cannot: ${missing.join(', ')}`);

      try {
        fs.mkdirSync(testInfo.project.outputDir, { recursive: true });
        fs.writeFileSync(nodePath.join(testInfo.project.outputDir, 'adapter.json'), JSON.stringify({ name: adapter.name, capabilities: [...adapter.capabilities, ...ALWAYS] }));
      } catch {
        /* the summary will not know which adapter ran */
      }
      try {
        // Playwright shortens a long title in the name of the folder, so the folder says which story it is for
        fs.mkdirSync(testInfo.outputDir, { recursive: true });
        fs.writeFileSync(nodePath.join(testInfo.outputDir, 'story.txt'), meta.id);
      } catch {
        /* the summary falls back on the name of the folder */
      }
      const ctx: AdapterContext = { admin: page, baseURL: baseURL! };
      const env: TabEnv = {
        browser,
        baseURL: baseURL!,
        waitForApplication,
        dir: tmpPath,
        recorder: new Recorder(testInfo.outputDir, `${meta.id} · ${meta.title}`)
      };
      const s = new Story(meta, adapter, ctx, env, tmpPath);
      try {
        await body(s);
      } catch (error) {
        if (!meta.proposed) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        testInfo.annotations.push({ type: 'proposed-not-met', description: message.split('\n')[0] });
        fs.writeFileSync(nodePath.join(testInfo.outputDir, 'not-met.txt'), message);
      } finally {
        await s.closeAll();
      }
    }
  ];
}
