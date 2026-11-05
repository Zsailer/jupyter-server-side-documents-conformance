import { expect, galata, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import * as nodePath from 'node:path';
import { keepLook, Recorder } from './recording';
import { sourceText } from './cells';

export interface TabEnv {
  browser: Browser;
  baseURL: string;
  waitForApplication: (page: Page, helpers: any) => Promise<void>;
  /** The folder on the server the story works in: a tab opens JupyterLab there (Galata opens `/lab/tree/<dir>`). */
  dir: string;
  /** Keeps a video of every tab, and when each step happened. */
  recorder: Recorder;
}

/** The size of every tab's browser, and of its video. */
const VIEW = { width: 1280, height: 720 };

/** Waits that every test shares. Milliseconds. */
export const WAIT = {
  /** How long a tab may take to show what it should (a sync, a reconnect). */
  eventually: Number(process.env.COMPLIANCE_TIMEOUT_MS ?? 20000),
  /** How long the file may take to be saved. */
  save: Number(process.env.COMPLIANCE_SAVE_TIMEOUT_MS ?? 40000),
  /** How long a notebook must stay as it is before it counts as settled (catches a late duplicate). */
  stable: Number(process.env.COMPLIANCE_STABLE_MS ?? 1500)
};

/**
 * Whether a JupyterLab page is ready to be driven: its splash screen is gone and the application has restored.
 *
 * Galata's own check also waits for the Launcher tab to be active, which a tab that goes straight to a notebook neither
 * needs nor always gets.
 */
async function waitForLab(page: Page): Promise<void> {
  await page.locator('#jupyterlab-splash').waitFor({ state: 'detached', timeout: WAIT.eventually });
  await page.waitForFunction(() => Boolean((window as any).jupyterapp), undefined, { timeout: WAIT.eventually });
  await page.evaluate(async () => {
    await (window as any).jupyterapp.restored;
  });
}

/** When a tab cannot be set up, say what it looked like: a picture and the page as text, kept in the results folder. */
async function explain(page: Page | null, name: string, dir: string): Promise<void> {
  if (page) {
    await keepLook(dir, name, 'could not be set up', page as any);
  }
}

/**
 * One browser tab with JupyterLab in it: its own browser context, so it has its own connection (it can go offline on
 * its own) and its own storage, the way another person's browser would.
 *
 * It does what a person does, with real keystrokes, and reports what the person would see.
 */
export class Tab {
  page: IJupyterLabPageFixture | null = null;
  private context: BrowserContext | null = null;
  private lead: Page | null = null;
  private startedAt = 0;
  private opened = 0;

  constructor(
    readonly name: string,
    private readonly env: TabEnv,
    /** The path of the notebook, on the server. */
    private readonly path: string,
    /** Whether to keep a video of this tab (a fresh tab opened only to look is not worth one). */
    private readonly record = true
  ) {}

  get isOpen(): boolean {
    return this.page !== null;
  }

  private get p(): IJupyterLabPageFixture {
    if (!this.page) {
      throw new Error(`The tab "${this.name}" is not open`);
    }
    return this.page;
  }

  /** Open JupyterLab in a new browser, and the notebook in it. */
  async open(): Promise<void> {
    try {
      // The browser is made here, not by Galata, so that it can be recorded: Playwright films only the pages it makes.
      this.startedAt = Date.now();
      this.opened++;
      this.context = await this.env.browser.newContext(
        this.record
          ? { viewport: VIEW, recordVideo: { dir: nodePath.join(this.env.recorder.dir, 'videos'), size: VIEW } }
          : { viewport: VIEW }
      );
      this.lead = await this.context.newPage();
      const page = await galata.initTestPage(
        '/lab',
        true,
        this.env.baseURL,
        true,
        galata.DEFAULT_SETTINGS,
        true,
        true,
        this.lead,
        new Map(),
        new Map(),
        this.env.dir,
        async p => waitForLab(p),
        new Map(),
        true
      );
      this.page = page;
      await page.evaluate(async (p: string) => {
        await (window as any).jupyterapp.commands.execute('docmanager:open', { path: p });
      }, this.path);
      await dismissKernelDialogIfPresent(page);
      await expect
        .poll(async () => (await this.cells())?.length ?? 0, {
          timeout: WAIT.eventually,
          message: `${this.name}: the notebook never appeared`
        })
        .toBeGreaterThan(0);
    } catch (e) {
      await explain(this.lead, this.name, this.env.recorder.dir);
      throw e;
    }
  }

  /** The person closes the tab: the connection goes with it. The video is complete once it has closed. */
  async close(): Promise<void> {
    if (!this.context) {
      return;
    }
    const video = this.record ? this.lead?.video() : null;
    await this.context.close().catch(() => undefined);
    if (this.record) {
      const file = video ? await video.path().catch(() => null) : null;
      this.env.recorder.tabs.push({ name: this.opened > 1 ? `${this.name} (${this.opened})` : this.name, startedAt: this.startedAt, file });
    }
    this.context = null;
    this.lead = null;
    this.page = null;
  }

  /** The connection drops (a laptop lid closed). The tab keeps working on what it has. */
  async goOffline(): Promise<void> {
    await this.p.context().setOffline(true);
  }

  /** The connection comes back. */
  async goOnline(): Promise<void> {
    await this.p.context().setOffline(false);
  }

  /** The sources of the cells the tab shows, or null if the notebook is not open in it. */
  async cells(): Promise<string[] | null> {
    if (!this.page) {
      return null;
    }
    const raw = await this.page.evaluate((p: string) => {
      const app = (window as any).jupyterapp;
      for (const widget of app.shell.widgets('main')) {
        const context = (widget as any).context;
        if (context?.path === p && context.model?.sharedModel) {
          return context.model.sharedModel.toJSON().cells.map((c: any) => c.source);
        }
      }
      return null;
    }, this.path);
    return raw === null ? null : raw.map(sourceText);
  }

  /** Type `text` at the end of cell `index`, key by key. */
  async type(index: number, text: string): Promise<void> {
    const page = this.p;
    await page.notebook.enterCellEditingMode(index);
    await page.keyboard.press('End');
    await page.keyboard.type(text);
    await page.notebook.leaveCellEditingMode(index);
  }

  /** Replace everything in cell `index` with `text`. */
  async rewrite(index: number, text: string): Promise<void> {
    const page = this.p;
    await page.notebook.enterCellEditingMode(index);
    // select all: Control+A moves the cursor to the start of the line on a Mac, so ask for the key the platform uses
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
    await page.notebook.leaveCellEditingMode(index);
  }

  /** Add a cell so that it ends up at `index`, and type `text` into it. */
  async addCell(index: number, text: string): Promise<void> {
    const page = this.p;
    const before = (await page.notebook.getCellCount()) ?? 0;
    index = Math.min(index, before); // a tab that has not yet seen every cell adds at the end of what it has
    if (index === 0) {
      await page.notebook.selectCells(0);
      await this.command('notebook:insert-cell-above');
    } else {
      await page.notebook.selectCells(Math.min(index - 1, before - 1));
      await this.command('notebook:insert-cell-below');
    }
    await expect.poll(async () => page.notebook.getCellCount()).toBe(before + 1);
    await page.notebook.setCell(index, 'code', text);
  }

  /** Delete cell `index`. */
  async deleteCell(index: number): Promise<void> {
    const page = this.p;
    const before = await page.notebook.getCellCount();
    await page.notebook.selectCells(index);
    await page.notebook.deleteCells();
    await expect.poll(async () => page.notebook.getCellCount()).toBe(before - 1);
  }

  /** Move cell `from` so that it ends up at `to`. */
  async moveCell(from: number, to: number): Promise<void> {
    const page = this.p;
    await page.notebook.selectCells(from);
    const command = to > from ? 'notebook:move-cell-down' : 'notebook:move-cell-up';
    for (let i = 0; i < Math.abs(to - from); i++) {
      await this.command(command);
    }
  }

  private async command(id: string): Promise<void> {
    await this.p.evaluate(async (c: string) => {
      await (window as any).jupyterapp.commands.execute(c);
    }, id);
  }
}

/**
 * Dismiss the "Select Kernel" dialog that opens with a notebook, choosing "No Kernel": these tests are about the
 * document, not about running code. Nothing happens if the dialog does not appear.
 */
export async function dismissKernelDialogIfPresent(page: IJupyterLabPageFixture): Promise<void> {
  const dialog = page.locator('.jp-Dialog');
  try {
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    return;
  }
  const combobox = dialog.getByRole('combobox');
  if (await combobox.count()) {
    await combobox.selectOption('null').catch(() => undefined);
  }
  await dialog.locator('.jp-mod-accept').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
}
