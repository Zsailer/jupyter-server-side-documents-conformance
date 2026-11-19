// Argument parsing and help for the `jupyter conformance ssd` command. No dependencies, and nothing here touches the machine.

// Help is written to fit an ordinary terminal: no line is longer than 78 characters (a test keeps it so).
const MAIN = `jupyter conformance ssd: hold a backend to what people should see

What it does
  Starts your server (or uses one that is running), opens real browsers and
  plays each story the way a person would: a tab goes offline and keeps
  typing, the server lets go of a notebook, a file changes underneath. Then it
  tells you which stories your backend meets, and shows you the ones it
  doesn't.

Start here
  jupyter conformance ssd pick    choose stories from a list, then run them
  jupyter conformance ssd run     run every story (takes a while)
  jupyter conformance ssd run crash/dies-before-save
                                  run one story

Commands
  run [story ...]    run the stories named, or all of them
  pick               choose stories from a list (space selects, enter runs)
  list               see every story, and what each needs from a backend
  help [command]     more about a command, with examples

Learn more
  jupyter conformance ssd help run    every option for running, and examples
  docs/running-against-a-backend.md   a longer guide
`;

const RUN = `jupyter conformance ssd run: run the stories against a backend

Usage
  jupyter conformance ssd run [story ...] [options]

Which stories (each needs a server too: see below)
  jupyter conformance ssd run                  every story
  jupyter conformance ssd run crash/dies-mid-save files/edit-keeps-mtime
                                               these two
  jupyter conformance ssd run 'crash/*'        a whole group (or: run crash)
  jupyter conformance ssd run --group files    one group, the same
  jupyter conformance ssd run -i               pick them from a list first

  A story is named group/what-happens (see \`list\`). The name it had
  before, such as S2, still works.

Which server
  --backend <name>     how to start the server, so no backend is assumed:
                       jsd (jupyter-server-documents), jcollab
                       (jupyter-collaboration and nbmodel) or jupyverse.
                       Or use --start or --url
  --env <dir>          the Python environment with the backend installed
                       (default: the one on your PATH that has it)
  --start <command>    your own command that starts a JupyterLab on {port}.
                       The backend must implement the control contract
                       (docs/backend-contract.md) for the stories that need
                       its help
  --url <url>          use a server that is already running
  --root-dir <dir>     the folder that server serves (lets stories change the
                       file from outside)
  --adapter <path>     your own adapter module (default: ask the server what
                       it can do)

Speed
  --workers <n>        run n stories at once (default 1), or max for as many
                       as this machine has processors. Each story opens
                       several browsers, so start low: 3 or 4

What you see
  --headed             show the browsers
  --open               open the side-by-side video page of each failed story
  --out <dir>          where videos and results go
                       (default ./conformance-results)
  --known-gaps <file>  JSON of accepted stories this backend does not meet yet
                       (default ./conformance-known-gaps.json)

Examples
  jupyter conformance ssd run crash/dies-mid-save --backend jsd --env ~/jsd
  jupyter conformance ssd run --backend jcollab --workers 4
  jupyter conformance ssd run --group handshake --headed
  jupyter conformance ssd run --url http://localhost:8888
  jupyter conformance ssd run --start "my-server --port {port}"

A run ends with a line per story and a summary. The exit code is 0 when no
story failed, so it works as a CI step.
  ✓ passes
  ✗ fails
  ◐ known gap: fails as expected
  ◇ proposed case, not met: reported, never fails the run
  skipped: the backend cannot do something the story needs; the summary says
  what
`;

const PICK = `jupyter conformance ssd pick: choose stories from a list, then run them

Usage
  jupyter conformance ssd pick [options]
  It takes the same options as \`jupyter conformance ssd run\`.

In the list
  ↑ ↓  (or j k)    move
  space            select or unselect the story under the arrow
  a                select everything shown (again: unselect it)
  g                select the whole group the arrow is in
  /                filter by typing: a name, a word in a title, a group,
                   a need like releaseRoom (escape clears it)
  c                clear the selection
  enter            run what is selected (or the story under the arrow if
                   nothing is)
  q  or  escape    leave without running

Needs a terminal. In a script, name the stories:
  jupyter conformance ssd run crash/dies-before-save conflict/*
`;

const LIST = `jupyter conformance ssd list: every story, and what each needs

Usage
  jupyter conformance ssd list [--group <name>] [--filter <text>]

  --group <name>    only the stories of one group
  --filter <text>   only the stories whose name, title or needs hold the text
                    (for example: releaseRoom, offline, agent)

A story that "needs releaseRoom" is skipped on a backend that cannot make the
server let go of a notebook.
`;

const TOPICS = { main: MAIN, run: RUN, pick: PICK, list: LIST };
/** The suite this command runs: the real-time collaboration of server-side documents. */
export const SUITE = 'ssd';
export const COMMANDS = ['run', 'pick', 'list', 'help'];

export function helpFor(topic = 'main') {
  return TOPICS[topic] ?? MAIN;
}

const VALUE = new Set(['backend', 'url', 'start', 'adapter', 'root-dir', 'group', 'known-gaps', 'env', 'out', 'filter', 'workers']);
const SWITCH = new Set(['headed', 'open', 'help', 'version', 'interactive']);
const SHORT = { h: 'help', v: 'version', i: 'interactive' };

/** The closest candidate to a mistyped word, if one is close enough to be what was meant. */
export function suggest(word, candidates) {
  const distance = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) {
      d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  };
  const ranked = [...candidates].map(c => [c, distance(word, c)]).sort((x, y) => x[1] - y[1]);
  return ranked.length && ranked[0][1] <= Math.max(1, Math.floor(word.length / 3)) ? ranked[0][0] : undefined;
}

/** @returns {{command: string, stories: string[], options: Record<string, string | boolean>, topic: string}} */
export function parse(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
      if (SWITCH.has(name)) {
        options[name] = true;
      } else if (VALUE.has(name)) {
        const value = inline ?? argv[++i];
        if (value === undefined || value.startsWith('--')) {
          throw new Error(`--${name} needs a value`);
        }
        options[name] = value;
      } else {
        const close = suggest(name, [...SWITCH, ...VALUE]);
        throw new Error(`unknown option --${name}${close ? `. Did you mean --${close}?` : ''}`);
      }
    } else if (/^-[a-z]$/.test(arg) && SHORT[arg[1]]) {
      options[SHORT[arg[1]]] = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (options.workers !== undefined && options.workers !== 'max' && !/^[1-9][0-9]*$/.test(options.workers)) {
    throw new Error('--workers needs a whole number of at least 1, or max');
  }
  // `jupyter conformance ssd run`: the first word names the suite (the only one so far). `jupyter conformance run` is the same
  if (positional[0] === SUITE) {
    positional.shift();
  }
  if (positional.length === 0 && !options.help && !options.version) {
    return { command: 'welcome', stories: [], options, topic: 'main' };
  }
  const [first = 'help', ...rest] = positional;
  if (options.version && !options.help) {
    return { command: 'version', stories: [], options, topic: 'main' };
  }
  if (first === 'help') {
    return { command: 'help', stories: [], options, topic: rest[0] ?? 'main' };
  }
  if (!COMMANDS.includes(first)) {
    const close = suggest(first, COMMANDS);
    throw new Error(`unknown command "${first}"${close ? `. Did you mean \`${close}\`?` : ''}`);
  }
  if (options.help) {
    return { command: 'help', stories: [], options, topic: first };
  }
  return { command: first, stories: rest, options, topic: first };
}

/**
 * The stories a command line names, as the names they have now. What is typed is a story's name (`crash/dies-before-save`), a
 * name it had before (`S2`), a group (`crash`), or any of these with `*` for any run of characters (`crash/*`, `AI*`).
 * @param {string[]} words what was typed
 * @param {{id: string, group: string, aliases?: string[]}[]} all the stories of the suite, in order
 * @returns {{ids: string[], unknown: string[]}} the stories named, in the suite's order, and the words that name none
 */
export function resolveStories(words, all) {
  const chosen = new Set();
  const unknown = [];
  for (const word of words) {
    const pattern = new RegExp(`^${word.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const found = all.filter(s => s.group === word || [s.id, ...(s.aliases ?? [])].some(name => pattern.test(name)));
    if (!found.length) {
      unknown.push(word);
    }
    found.forEach(s => chosen.add(s.id));
  }
  return { ids: all.filter(s => chosen.has(s.id)).map(s => s.id), unknown };
}

/** The closest name to one that names no story, to say "did you mean". */
export function nearestStory(word, all) {
  return suggest(word, all.flatMap(s => [s.id, ...(s.aliases ?? [])]));
}

/** The Playwright --grep for the stories named (ids, or a prefix with *) in a group. Undefined means all of them. */
export function grepFor(stories, group) {
  const ids = stories.length
    ? `(?:^| )(?:${stories.map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^ ]*')).join('|')}) · `
    : '';
  const tag = group ? `^(?=.*@group-${group.replace(/[^a-z0-9-]/gi, '')})` : '';
  if (!ids && !tag) {
    return undefined;
  }
  return tag ? tag + '.*' + ids : ids;
}

/**
 * How many stories to run at once: the number given, or with `max` as many as the machine has processors.
 * @param {string | undefined} value what `--workers` was given
 * @param {number} processors how many the machine has
 */
export function workersFor(value, processors) {
  return value === 'max' ? Math.max(1, processors) : Number(value ?? 1);
}

/**
 * What to run, in what order. A story that kills the server (it needs crashServer) cannot run beside others, so when
 * stories run in parallel it gets a phase of its own, after the rest, with one worker. With one worker everything is a
 * single run. `all` is the stories of the suite (stories.json), `stories` the ids or prefixes named, `group` a group.
 * @returns {{project?: string, workers: number, last: boolean}[]}
 */
export function phasesFor(all, stories, group, workers) {
  const single = [{ workers, last: true }];
  if (workers <= 1) {
    return single;
  }
  const named = stories.map(s => new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
  const selected = all.filter(s => (!group || s.group === group) && (!named.length || named.some(re => re.test(s.id))));
  const serial = selected.some(s => s.requires.includes('crashServer'));
  // with nothing narrowed down, the suite's own tests of the adapters run too, and they are not stories
  const parallel = selected.some(s => !s.requires.includes('crashServer')) || (!named.length && !group);
  if (!serial || !parallel) {
    return serial ? [{ project: 'serial', workers: 1, last: true }] : single;
  }
  return [
    { project: 'stories', workers, last: false },
    { project: 'serial', workers: 1, last: true }
  ];
}
