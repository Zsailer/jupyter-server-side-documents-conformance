// Argument parsing for the `conformance` command. No dependencies, and nothing here touches the machine.

export const HELP = `conformance: run the real-time collaboration conformance tests against a backend

Usage
  conformance run [story ...]     run every story, or the ones named (Z3 C2, or a prefix like AI*)
  conformance list                list the stories and what each needs from a backend

Options for run
  --backend <name|path>   the adapter: jsd (default), generic, or the path of your own
  --url <url>             use a server that is already running instead of starting one
  --root-dir <dir>        the folder that server serves (lets stories change the file from outside)
  --group <name>          only the stories of a group (handshake, rebuild, edges, ...)
  --known-gaps <file>     JSON of accepted stories this backend does not meet yet (default ./conformance-known-gaps.json)
  --env <dir>             the Python environment with jupyter_server_documents (default: the one on your PATH)
  --ui-tests <dir>        the ui-tests folder of jupyter-server-documents (default ./ui-tests)
  --out <dir>             where videos and results go (default ./conformance-results)
  --headed                show the browsers
  --open                  open the side-by-side video page of each story that failed

  -h, --help              this help
  -v, --version           the version of the tests
`;

const VALUE = new Set(['backend', 'url', 'root-dir', 'group', 'known-gaps', 'env', 'ui-tests', 'out']);
const SWITCH = new Set(['headed', 'open', 'help', 'version']);
const SHORT = { h: 'help', v: 'version' };

/** @returns {{command: string, stories: string[], options: Record<string, string | boolean>}} */
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
        throw new Error(`unknown option --${name}`);
      }
    } else if (/^-[a-z]$/.test(arg) && SHORT[arg[1]]) {
      options[SHORT[arg[1]]] = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (options.help || options.version) {
    return { command: options.help ? 'help' : 'version', stories: [], options };
  }
  const [command = 'help', ...stories] = positional;
  if (!['run', 'list', 'help'].includes(command)) {
    throw new Error(`unknown command "${command}"`);
  }
  return { command, stories, options };
}

/**
 * The Playwright --grep for the stories named (ids, or a prefix with *) in a group. Undefined means all of them.
 * Playwright matches it against the file, the title and the tags, joined by spaces.
 */
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
