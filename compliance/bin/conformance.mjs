#!/usr/bin/env node
// `jupyter conformance ssd`: run the real-time collaboration conformance tests against a backend. See --help.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grepFor, helpFor, parse } from './args.mjs';
import { pick } from './picker.mjs';
import { welcome } from './welcome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
// in a checkout the version is the repo's; in the published package it is the package's own
const VERSION = (() => {
  const read = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const repo = read(path.join(PACKAGE_ROOT, '..', 'package.json'));
  return (repo.name === 'notebook-scenario-docs' ? repo : read(path.join(PACKAGE_ROOT, 'package.json'))).version;
})();

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

function loadStories(suite) {
  return JSON.parse(fs.readFileSync(path.join(suite, 'stories.json'), 'utf8'));
}

function needsOf(s) {
  return s.internal ? 'not checkable from outside' : s.requires.length ? `needs ${s.requires.join(', ')}` : 'needs nothing special';
}

function list(suite, options) {
  const all = loadStories(suite);
  const groups = [...new Set(all.map(s => s.group))];
  if (options.group && !groups.includes(options.group)) {
    fail(`No group called "${options.group}"`, `The groups are: ${groups.join(', ')}`);
  }
  const q = options.filter?.toLowerCase();
  const stories = all
    .filter(s => !options.group || s.group === options.group)
    .filter(s => !q || [s.id, s.title, s.group, ...s.requires].join(' ').toLowerCase().includes(q));
  if (!stories.length) {
    fail(`No story matches "${options.filter}"`, 'Try a word from a title, an id, or a need such as releaseRoom.');
  }
  console.log('');
  let group;
  for (const s of stories) {
    if (s.group !== group) {
      if (group !== undefined) {
        console.log('');
      }
      group = s.group;
      console.log(`  ${bold((s.groupTitle ?? group).toUpperCase())}  ${dim(`${stories.filter(x => x.group === group).length} · ${group}`)}`);
    }
    const tags = [s.proposed ? 'proposed' : '', s.needsAlignment ? 'open question' : ''].filter(Boolean);
    console.log(`    ${bold(s.id.padEnd(5))} ${s.title}`);
    console.log(`          ${dim([needsOf(s), ...tags].join(' · '))}`);
  }
  const free = stories.filter(s => !s.internal && !s.requires.length).length;
  console.log(`\n  ${dim(`${stories.length} stories · ${free} need nothing special from a backend`)}`);
  console.log(`  ${dim('jupyter conformance ssd pick  to choose some   ·   jupyter conformance ssd run <id>  to run one')}\n`);
}

/** The interactive way in: a list to choose from. Resolves with the ids chosen, or exits if the person leaves. */
async function choose(suite) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('Picking stories needs a terminal', 'Name the stories instead:\n  jupyter conformance ssd run Z3 C2\nor see them with:\n  jupyter conformance ssd list');
  }
  const chosen = await pick(loadStories(suite));
  if (!chosen) {
    console.log(`\n  ${dim('Nothing run.')}\n`);
    process.exit(0);
  }
  console.log(`\n  ${dim(`Running ${chosen.length === 1 ? chosen[0] : `${chosen.length} stories: ${chosen.join(', ')}`}`)}`);
  return chosen;
}

async function serving(url) {
  try {
    return (await fetch(`${url}/lab`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/**
 * The backends the suite knows how to start: the Python package that tells an environment has it, the variable that
 * names an environment, and the module in server/ that is the backend's side of the control contract.
 */
const BACKENDS = {
  jsd: { label: 'jupyter-server-documents', module: 'jupyter_server_documents', envVar: 'JSD_ENV', control: 'jsd_control' },
  jcollab: { label: 'jupyter-collaboration', module: 'jupyter_server_ydoc', envVar: 'JCOLLAB_ENV', control: 'jcollab_control' }
};

function findPythonEnv(backend) {
  const found = spawnSync('python3', ['-c', `import ${backend.module}, sys; print(sys.prefix)`], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

/**
 * Start the server the tests run against: the command the person gave (--start), or a JupyterLab with
 * jupyter-server-documents, set up by the suite's own config (server/conformance_config.py) with the suite's own copy of
 * the backend's side of the control contract (server/jsd_control.py). Nothing is taken from the backend's repo.
 */
async function startServer(suite, options, port, out) {
  fs.mkdirSync(out, { recursive: true });
  const logFile = path.join(out, 'server.log');
  const log = fs.openSync(logFile, 'w');
  const env = { ...process.env, CONFORMANCE_PORT: String(port) };
  let rootDir = options['root-dir'];
  let command;
  let args;
  if (options.start) {
    command = 'sh';
    args = ['-c', options.start.replaceAll('{port}', String(port))];
  } else {
    const backend = BACKENDS[options.backend];
    const given = options.env ?? process.env[backend.envVar];
    // the server starts in a folder of its own, so a relative path to the environment would no longer lead to it
    const pythonEnv = given ? path.resolve(given) : findPythonEnv(backend);
    if (!pythonEnv) {
      fail(`Can't find a Python environment with ${backend.module}`, `Run this inside the environment you develop it in, or point at one:\n  jupyter conformance ssd run --backend ${options.backend} --env /path/to/env`);
    }
    rootDir ??= path.join(os.tmpdir(), 'conformance-root');
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.mkdirSync(rootDir, { recursive: true });
    env.CONFORMANCE_CONTROL = backend.control;
    command = path.join(pythonEnv, 'bin', 'jupyter');
    args = ['lab', '--config', path.join(suite, 'server', 'conformance_config.py'), `--port=${port}`, '--no-browser', `--ServerApp.root_dir=${rootDir}`];
  }
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-server-'));
  // one process at a time; `server.pid` is the current one, so everything that stops the server stops the right one
  let current;
  let exited = false;
  const launch = () => {
    exited = false;
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', log, log], detached: true });
    child.on('exit', () => child === current && (exited = true));
    current = child;
  };
  const server = {
    get pid() {
      return current.pid;
    }
  };
  launch();
  // from the moment it exists, the server goes when this command does, however that happens (also during start-up)
  process.once('exit', () => stop(server));
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
      stop(server);
      process.exit(code);
    });
  }

  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const ready = async spin => {
    for (let i = 0; i < 900; i++) {
      if (await serving(`http://localhost:${port}`)) {
        spin && process.stdout.write('\r\u001b[2K');
        return;
      }
      if (exited) {
        stop(server);
        const tail = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-12).join('\n');
        throw new Error(`The server stopped before it was ready\n${tail}`);
      }
      if (spin && process.stdout.isTTY) {
        process.stdout.write(`\r  ${dim(`${frames[i % frames.length]} Starting the server…`)}`);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    stop(server);
    throw new Error(`The server did not come up in 3 minutes. Its log is ${logFile}`);
  };
  try {
    await ready(true);
  } catch (error) {
    const [what, ...rest] = error.message.split('\n');
    fail(what, rest.join('\n') || undefined);
  }

  // what a story asks of the command: kill the server without a save, and start it again on the same port and files
  const gone = () => new Promise(resolve => (exited ? resolve() : current.once('exit', resolve)));
  const crash = async () => {
    stop(server, 'SIGKILL');
    await gone();
  };
  const restart = async () => {
    if (!exited) {
      await crash();
    }
    launch();
    await ready(false);
  };
  return { server, rootDir, crash, restart };
}

function stop(server, signal = 'SIGTERM') {
  try {
    process.kill(-server.pid, signal);
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
  const backend = options.backend;
  const port = Number(process.env.COMPLIANCE_PORT ?? 8899);
  let baseURL = options.url?.replace(/\/$/, '');

  console.log(`\n  ${bold('jupyter conformance ssd')} ${dim(`v${VERSION}`)}`);

  let server;
  let controlDir;
  let stopControl;
  let rootDir = options['root-dir'];
  if (!baseURL) {
    if (!options.start && !backend) {
      fail('Say which backend to run against', `No backend is assumed. Name one: ${Object.keys(BACKENDS).map(n => `\n  jupyter conformance ssd run --backend ${n}`).join('')}\nor give a command that starts yours, or a server that is already running:\n  jupyter conformance ssd run --start "<command that serves JupyterLab on {port}>"\n  jupyter conformance ssd run --url http://localhost:8888`);
    }
    if (!options.start && !BACKENDS[backend]) {
      fail(`Don't know how to start "${backend}"`, 'Give a command that starts it, or a server that is already running:\n  jupyter conformance ssd run --start "<command that serves JupyterLab on {port}>"\n  jupyter conformance ssd run --url http://localhost:8888');
    }
    baseURL = `http://localhost:${port}`;
    if (await serving(baseURL)) {
      fail(`Something is already serving ${baseURL}`, 'Stop it, or run the tests against it:\n  jupyter conformance ssd run --url ' + baseURL);
    }
    console.log(`  ${dim(options.start ? 'your server' : backend)}\n`);
    const started = await startServer(suite, options, port, out);
    server = started.server;
    rootDir = rootDir ?? started.rootDir;
    // a story that kills the server asks this command to do it, and to start it again (runtime/supervisor.ts)
    controlDir = path.join(out, 'control');
    stopControl = watchControl(controlDir, started);
  } else {
    console.log(`  ${dim(baseURL)}\n`);
  }
  const quit = () => server && stop(server);
  process.on('SIGINT', () => (quit(), process.exit(130)));
  process.on('SIGTERM', () => (quit(), process.exit(143)));

  spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: suite, stdio: 'ignore' });

  const knownGaps = path.resolve(options['known-gaps'] ?? 'conformance-known-gaps.json');
  const grep = grepFor(stories, options.group);
  const rowsFile = path.join(out, 'rows.json');
  fs.rmSync(rowsFile, { force: true });
  const phases = phasesFor(loadStories(suite), stories, options.group, Number(options.workers ?? 1));
  let code = 0;
  // COMPLIANCE_BLOB_DIR: also keep Playwright's blob report, one file per phase (each has a name of its own), to merge into an HTML report afterwards
  // (`npx playwright merge-reports --reporter html <dir>`); a run in two phases would overwrite a single HTML report
  const blobDir = process.env.COMPLIANCE_BLOB_DIR ? path.resolve(process.env.COMPLIANCE_BLOB_DIR) : undefined;
  for (const phase of phases) {
    const args = ['playwright', 'test', '--reporter', path.join(suite, 'runtime', 'reporter.ts') + (blobDir ? ',blob' : ''), '--output', results, '--workers', String(phase.workers)];
    if (phase.project) {
      args.push('--project', phase.project);
    }
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
        COMPLIANCE_ADAPTER: options.adapter ?? 'http',
        ...(controlDir ? { COMPLIANCE_CONTROL_DIR: path.resolve(controlDir) } : {}),
        ...(phases.length > 1 ? { COMPLIANCE_ROWS_FILE: rowsFile, COMPLIANCE_LAST_PHASE: phase.last ? '1' : '' } : {}),
        ...(rootDir ? { COMPLIANCE_ROOT_DIR: rootDir } : {}),
        ...(fs.existsSync(knownGaps) ? { COMPLIANCE_KNOWN_GAPS: knownGaps } : {}),
        ...(blobDir ? { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDir } : {}),
        PLAYWRIGHT_HTML_OPEN: 'never'
      }
    });
    const exit = await new Promise(resolve => child.on('exit', c => resolve(c ?? 1)));
    code = code || exit;
  }
  stopControl?.();
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
  fail(error.message, 'jupyter conformance ssd help');
}
const { command, stories, options, topic } = parsed;
if (command === 'welcome') {
  console.log(welcome({ version: VERSION, color }).join('\n'));
} else if (command === 'help') {
  console.log(`\n${helpFor(topic)}`);
} else if (command === 'version') {
  console.log(VERSION);
} else if (command === 'list') {
  list(suiteDir(), options);
} else if (command === 'pick' || options.interactive) {
  const suite = suiteDir();
  await run(suite, await choose(suite), options);
} else {
  await run(suiteDir(), stories, options);
}
