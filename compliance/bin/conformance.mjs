#!/usr/bin/env node
// `conformance`: run the real-time collaboration conformance tests against a backend. See --help.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grepFor, HELP, parse } from './args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
const dim = s => paint('2', s);
const bold = s => paint('1', s);
const red = s => paint('31', s);

function fail(message, hint) {
  console.error(`\n  ${red('✗')} ${message}`);
  if (hint) {
    console.error(`\n${hint.split('\n').map(l => `    ${dim(l)}`).join('\n')}`);
  }
  console.error('');
  process.exit(2);
}

/**
 * Playwright does not compile TypeScript inside node_modules, so a copy installed there (npx, npm install) is unpacked
 * once into a cache and run from there.
 */
function suiteDir() {
  if (!PACKAGE_ROOT.includes(`${path.sep}node_modules${path.sep}`)) {
    return PACKAGE_ROOT;
  }
  const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'jupyter-server-side-documents-conformance', VERSION);
  if (!fs.existsSync(path.join(cache, 'package.json'))) {
    fs.mkdirSync(cache, { recursive: true });
    fs.cpSync(PACKAGE_ROOT, cache, { recursive: true, filter: src => !path.relative(PACKAGE_ROOT, src).split(path.sep).includes('node_modules') });
  }
  if (!fs.existsSync(path.join(cache, 'node_modules'))) {
    console.log(`\n  ${dim('Setting up the tests (first run only)…')}`);
    if (spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: cache, stdio: 'inherit' }).status !== 0) {
      fail('npm install failed while setting up the tests', `Look in ${cache}`);
    }
  }
  return cache;
}

function list(suite) {
  const stories = JSON.parse(fs.readFileSync(path.join(suite, 'stories.json'), 'utf8'));
  console.log('');
  for (const s of stories) {
    const needs = s.internal ? 'not checkable from outside' : s.requires.length ? `needs ${s.requires.join(', ')}` : 'needs nothing special';
    const tags = [s.proposed ? 'proposed' : '', s.needsAlignment ? 'open question' : ''].filter(Boolean).join(', ');
    console.log(`  ${bold(s.id.padEnd(5))} ${s.title}`);
    console.log(`        ${dim(`${s.group} · ${needs}${tags ? ` · ${tags}` : ''}`)}`);
  }
  console.log(`\n  ${dim(`${stories.length} stories`)}\n`);
}

async function serving(url) {
  try {
    return (await fetch(`${url}/lab`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

function findPythonEnv() {
  const found = spawnSync('python3', ['-c', 'import jupyter_server_documents, sys; print(sys.prefix)'], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

/** Start a JupyterLab with jupyter-server-documents the way its own UI tests do. */
async function startJsd(suite, options, port, out) {
  const env = options.env ?? process.env.JSD_ENV ?? findPythonEnv();
  const uiTests = path.resolve(options['ui-tests'] ?? process.env.JSD_UI_TESTS ?? 'ui-tests');
  if (!env) {
    fail("Can't find a Python environment with jupyter_server_documents", 'Run this inside the environment you develop it in, or point at one:\n  conformance run --env /path/to/env');
  }
  if (!fs.existsSync(path.join(uiTests, 'jupyter_server_test_config.py'))) {
    fail(`Can't find the ui-tests folder of jupyter-server-documents (looked in ${uiTests})`, 'Run this from the root of a checkout, or point at it:\n  conformance run --ui-tests /path/to/jupyter-server-documents/ui-tests');
  }
  fs.mkdirSync(out, { recursive: true });
  const log = fs.openSync(path.join(out, 'server.log'), 'w');
  const server = spawn('sh', [path.join(suite, 'scripts', 'start-jsd-server.sh')], {
    env: { ...process.env, JSD_ENV: env, JSD_UI_TESTS: uiTests, COMPLIANCE_PORT: String(port), COMPLIANCE_ROOT_DIR: options['root-dir'] ?? path.join(os.tmpdir(), 'conformance-root') },
    stdio: ['ignore', log, log],
    detached: true
  });
  let exited = false;
  server.on('exit', () => (exited = true));

  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  for (let i = 0; i < 900; i++) {
    if (await serving(`http://localhost:${port}`)) {
      process.stdout.write('\r\u001b[2K');
      return server;
    }
    if (exited) {
      stop(server);
      const tail = fs.readFileSync(path.join(out, 'server.log'), 'utf8').trim().split('\n').slice(-12).join('\n');
      fail('The server stopped before it was ready', tail);
    }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  ${dim(`${frames[i % frames.length]} Starting the server…`)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  stop(server);
  fail('The server did not come up in 3 minutes', `Its log is ${path.join(out, 'server.log')}`);
}

function stop(server) {
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
}

function open(file) {
  spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { stdio: 'ignore' });
}

function watchPages(results) {
  const pages = [];
  if (!fs.existsSync(results)) {
    return pages;
  }
  for (const dir of fs.readdirSync(results)) {
    const folder = path.join(results, dir);
    if (fs.existsSync(path.join(folder, 'error-context.md')) && fs.existsSync(path.join(folder, 'watch.html'))) {
      pages.push(path.join(folder, 'watch.html'));
    }
  }
  return pages;
}

async function run(suite, stories, options) {
  const out = path.resolve(options.out ?? 'conformance-results');
  const results = path.join(out, 'results');
  const backend = options.backend ?? 'jsd';
  const port = Number(process.env.COMPLIANCE_PORT ?? 8899);
  let baseURL = options.url?.replace(/\/$/, '');

  console.log(`\n  ${bold('conformance')} ${dim(`v${VERSION}`)}`);

  let server;
  if (!baseURL) {
    if (backend !== 'jsd') {
      fail(`The "${backend}" backend needs a running server`, 'conformance run --backend generic --url http://localhost:8888');
    }
    baseURL = `http://localhost:${port}`;
    if (await serving(baseURL)) {
      fail(`Something is already serving ${baseURL}`, 'Stop it, or run the tests against it:\n  conformance run --url ' + baseURL);
    }
    console.log(`  ${dim(backend)}\n`);
    server = await startJsd(suite, options, port, out);
  } else {
    console.log(`  ${dim(`${backend} · ${baseURL}`)}\n`);
  }
  const quit = () => server && stop(server);
  process.on('SIGINT', () => (quit(), process.exit(130)));
  process.on('SIGTERM', () => (quit(), process.exit(143)));

  spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: suite, stdio: 'ignore' });

  const knownGaps = path.resolve(options['known-gaps'] ?? 'conformance-known-gaps.json');
  const grep = grepFor(stories, options.group);
  const args = ['playwright', 'test', '--reporter', path.join(suite, 'runtime', 'reporter.ts'), '--output', results];
  if (grep) {
    args.push('--grep', grep);
  }
  if (options.headed) {
    args.push('--headed');
  }
  const child = spawn('npx', args, {
    cwd: suite,
    stdio: 'inherit',
    env: {
      ...process.env,
      COMPLIANCE_BASE_URL: baseURL,
      COMPLIANCE_ADAPTER: backend,
      COMPLIANCE_ROOT_DIR: options['root-dir'] ?? process.env.COMPLIANCE_ROOT_DIR ?? path.join(os.tmpdir(), 'conformance-root'),
      ...(fs.existsSync(knownGaps) ? { COMPLIANCE_KNOWN_GAPS: knownGaps } : {}),
      PLAYWRIGHT_HTML_OPEN: 'never'
    }
  });
  const code = await new Promise(resolve => child.on('exit', c => resolve(c ?? 1)));
  quit();

  const pages = watchPages(results);
  if (pages.length) {
    console.log(`\n  ${dim('Watch the tabs of a failed story side by side:')}`);
    for (const page of pages.slice(0, 5)) {
      console.log(`  ${dim(path.relative(process.cwd(), page))}`);
    }
    if (options.open) {
      pages.slice(0, 5).forEach(open);
    } else {
      console.log(`  ${dim('(--open opens them)')}`);
    }
  }
  console.log('');
  process.exit(code);
}

let parsed;
try {
  parsed = parse(process.argv.slice(2));
} catch (error) {
  fail(error.message, 'conformance --help');
}
const { command, stories, options } = parsed;
if (command === 'help') {
  console.log(`\n${HELP}`);
} else if (command === 'version') {
  console.log(VERSION);
} else if (command === 'list') {
  list(suiteDir());
} else {
  await run(suiteDir(), stories, options);
}
