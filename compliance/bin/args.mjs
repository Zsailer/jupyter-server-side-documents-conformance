// Argument parsing and help for the `conformance` command. No dependencies, and nothing here touches the machine.

const MAIN = `conformance: hold a real-time collaboration backend to what people should experience

What it does
  Starts your server (or uses one that is running), opens real browsers, and plays each story the way a person would:
  a tab goes offline and keeps typing, the server lets go of a notebook, a file changes underneath. Then it tells you
  which stories your backend meets, and shows you the ones it doesn't.

Start here
  conformance pick               choose stories from a list, then run them
  conformance run Z3             run one story
  conformance run                run every story (takes a while)

Commands
  run [story ...]    run the stories named, or all of them
  pick               choose stories from a list (space selects, enter runs)
  list               see every story, and what each needs from a backend
  help [command]     more about a command, with examples

Learn more
  conformance help run           every option for running, and examples
  docs/running-against-a-backend.md   a longer guide
`;

const RUN = `conformance run: run the stories against a backend

Usage
  conformance run [story ...] [options]

Which stories
  conformance run                  every story
  conformance run Z3 C2            these two
  conformance run 'AI*'            every story whose id starts with AI
  conformance run --group edges    one group of the page (see \`conformance list\`)
  conformance run -i               pick them from a list first (same as \`conformance pick\`)

Which server
  --backend <name>        how to start the server: jsd (default), the built-in way to start jupyter-server-documents
  --env <dir>             the Python environment with jupyter_server_documents (default: the one on your PATH)
  --start <command>       your own command that starts a JupyterLab on {port}. The backend must implement the control
                          contract (docs/backend-contract.md) for the stories that need its help
  --url <url>             use a server that is already running instead of starting one
  --root-dir <dir>        the folder that server serves (lets stories change the file from outside)
  --adapter <path>        your own adapter module (default: ask the server what it can do)

What you see
  --headed                show the browsers
  --open                  open the side-by-side video page of each story that failed
  --out <dir>             where videos and results go (default ./conformance-results)
  --known-gaps <file>     JSON of accepted stories this backend does not meet yet (default ./conformance-known-gaps.json)

Examples
  conformance run Z3 --env ~/envs/jsd
  conformance run --group handshake --headed
  conformance run --url http://localhost:8888
  conformance run --start "my-server --port {port}"

A run ends with a line per story and a summary. The exit code is 0 when no story failed, so it works as a CI step.
  ✓ passes   ✗ fails   ◐ known gap (fails as expected)   ◇ proposed case, not met (never fails the run)   skipped: the backend
  cannot do something the story needs, and the summary says what.
`;

const PICK = `conformance pick: choose stories from a list, then run them

Usage
  conformance pick [options]        takes the same options as \`conformance run\`

In the list
  ↑ ↓  (or j k)   move              space      select or unselect the story under the arrow
  a               select everything shown (again: unselect it)
  g               select the whole group the arrow is in
  /               filter by what you type: an id, a word in the title, a group, a need like releaseRoom
  c               clear the selection        enter      run what is selected (or the story under the arrow if nothing is)
  q  or  escape   leave without running

Needs a terminal. In a script, name the stories: \`conformance run Z3 C2\`.
`;

const LIST = `conformance list: see every story and what each needs from a backend

Usage
  conformance list [--group <name>] [--filter <text>]

  --group <name>     only the stories of one group
  --filter <text>    only the stories whose id, title or needs contain the text (for example: releaseRoom, offline, AI)

A story that "needs releaseRoom" is skipped on a backend that cannot make the server let go of a notebook.
`;

const TOPICS = { main: MAIN, run: RUN, pick: PICK, list: LIST };
export const COMMANDS = ['run', 'pick', 'list', 'help'];

export function helpFor(topic = 'main') {
  return TOPICS[topic] ?? MAIN;
}

const VALUE = new Set(['backend', 'url', 'start', 'adapter', 'root-dir', 'group', 'known-gaps', 'env', 'out', 'filter']);
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
