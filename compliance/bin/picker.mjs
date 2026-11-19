// The interactive story picker of `jupyter conformance ssd pick`: a list grouped by topic, in which a person selects several stories.
// The behaviour is pure functions (createPicker, reduce, render), so it is tested without a terminal; `pick` is the thin
// part that reads keys and draws.
import readline from 'node:readline';

/** @typedef {{id: string, aliases?: string[], group: string, groupTitle?: string, title: string, requires?: string[], proposed?: boolean, internal?: string}} Story */

export function createPicker(stories, { preselected = [] } = {}) {
  return { stories, selected: new Set(preselected), filter: '', typing: false, cursor: 0, top: 0, hint: '' };
}

/** The stories that match what was typed: in the name (or one it had before), the title, the group, or what a story needs. */
export function visible(state) {
  const q = state.filter.trim().toLowerCase();
  if (!q) {
    return state.stories;
  }
  return state.stories.filter(s => [s.id, ...(s.aliases ?? []), s.title, s.group, s.groupTitle ?? '', ...(s.requires ?? [])].join(' ').toLowerCase().includes(q));
}

/**
 * How many stories, from `top`, fit in `budget` lines. A group's title takes a line, and a blank line before it unless
 * it is the first, so a window of a few groups shows fewer stories than lines.
 */
export function fitCount(list, top, budget) {
  let used = 0;
  let n = 0;
  let group;
  for (let i = top; i < list.length; i++) {
    const extra = list[i].group === group ? 0 : group === undefined ? 1 : 2;
    if (used + extra + 1 > budget) {
      break;
    }
    used += extra + 1;
    n++;
    group = list[i].group;
  }
  return Math.max(1, n);
}

function clamp(state, budget) {
  const list = visible(state);
  const n = list.length;
  const cursor = Math.max(0, Math.min(state.cursor, n - 1));
  let top = Math.max(0, Math.min(state.top, cursor));
  // scroll until the arrow is inside the window
  while (top < cursor && cursor >= top + fitCount(list, top, budget)) {
    top++;
  }
  return { ...state, cursor: n ? cursor : 0, top };
}

function toggle(selected, ids, on) {
  const next = new Set(selected);
  ids.forEach(id => (on ? next.add(id) : next.delete(id)));
  return next;
}

/**
 * One key. Returns {state} to go on, or {state, done: 'run' | 'cancel'}.
 * Keys are 'up', 'down', 'pageup', 'pagedown', 'home', 'end', 'space', 'enter', 'escape', 'backspace', 'ctrl-c', or the
 * character typed.
 */
export function reduce(state, key, budget = 14) {
  const list = visible(state);
  const go = next => ({ state: clamp({ ...state, hint: '', ...next }, budget) });

  if (key === 'ctrl-c') {
    return { state, done: 'cancel' };
  }

  if (state.typing) {
    if (key === 'enter') {
      return go({ typing: false });
    }
    if (key === 'escape') {
      return go({ typing: false, filter: '', cursor: 0, top: 0 });
    }
    if (key === 'backspace') {
      return go({ filter: state.filter.slice(0, -1), cursor: 0, top: 0 });
    }
    const char = key === 'space' ? ' ' : key;
    if (char.length === 1 && char >= ' ') {
      return go({ filter: state.filter + char, cursor: 0, top: 0 });
    }
    return { state };
  }

  const here = list[state.cursor];
  switch (key) {
    case 'up':
    case 'k':
      return go({ cursor: state.cursor - 1 });
    case 'down':
    case 'j':
      return go({ cursor: state.cursor + 1 });
    case 'pageup':
      return go({ cursor: state.cursor - fitCount(list, state.top, budget) });
    case 'pagedown':
      return go({ cursor: state.cursor + fitCount(list, state.top, budget) });
    case 'home':
      return go({ cursor: 0 });
    case 'end':
      return go({ cursor: list.length - 1 });
    case 'space':
      return here ? go({ selected: toggle(state.selected, [here.id], !state.selected.has(here.id)), cursor: state.cursor + 1 }) : { state };
    case 'a': {
      const all = list.length > 0 && list.every(s => state.selected.has(s.id));
      return go({ selected: toggle(state.selected, list.map(s => s.id), !all) });
    }
    case 'g': {
      if (!here) {
        return { state };
      }
      const ids = list.filter(s => s.group === here.group).map(s => s.id);
      return go({ selected: toggle(state.selected, ids, !ids.every(id => state.selected.has(id))) });
    }
    case 'c':
      return go({ selected: new Set() });
    case '/':
      return go({ typing: true });
    case 'escape':
      if (state.filter) {
        return go({ filter: '', cursor: 0, top: 0 });
      }
      return { state, done: 'cancel' };
    case 'q':
      return { state, done: 'cancel' };
    case 'enter':
      if (state.selected.size === 0 && here) {
        // nothing chosen: run the one under the cursor, which is what a person pressing enter means
        return { state: { ...state, selected: new Set([here.id]) }, done: 'run' };
      }
      if (state.selected.size === 0) {
        return { state: { ...state, hint: 'Nothing matches: press escape to clear the filter' } };
      }
      return { state, done: 'run' };
    default:
      return { state };
  }
}

const paint = (on, code, s) => (on ? `\u001b[${code}m${s}\u001b[0m` : s);

/** The lines to draw. `budget` is how many lines the list may take, the titles of groups included. */
export function render(state, { width = 100, budget = 14, color = true } = {}) {
  const dim = s => paint(color, '2', s);
  const bold = s => paint(color, '1', s);
  const green = s => paint(color, '32', s);
  const yellow = s => paint(color, '33', s);
  const cyan = s => paint(color, '36', s);
  const list = visible(state);
  // as wide as the longest name of any story, so that the columns do not move as the list scrolls
  const nameWidth = Math.min(46, Math.max(5, ...state.stories.map(s => s.id.length)));
  const lines = [];

  lines.push(`  ${bold('Pick the stories to run')}`);
  lines.push(`  ${dim('↑↓ move · space select · a all shown · g whole group · / filter · enter run · q quit')}`);
  if (state.typing || state.filter) {
    lines.push(`  ${cyan('filter')} ${state.filter}${state.typing ? dim('▌') : ''}${state.typing ? '' : dim('  (escape clears it)')}`);
  }
  lines.push('');

  const shown = fitCount(list, state.top, budget);
  const slice = list.slice(state.top, state.top + shown);
  if (!slice.length) {
    lines.push(`  ${dim('No story matches')}`);
  }
  let group;
  slice.forEach((s, i) => {
    if (s.group !== group) {
      if (group !== undefined) {
        lines.push('');
      }
      group = s.group;
      const count = list.filter(x => x.group === group).length;
      lines.push(`  ${dim(`${(s.groupTitle ?? s.group).toUpperCase()}  ·  ${count}`)}`);
    }
    const index = state.top + i;
    const on = state.selected.has(s.id);
    const needs = s.internal ? 'not checkable from outside' : (s.requires ?? []).join(', ');
    const tags = [s.proposed ? 'proposed' : ''].filter(Boolean).join(', ');
    const right = [needs, tags].filter(Boolean).join(' · ');
    const pointer = index === state.cursor ? cyan('❯') : ' ';
    const box = on ? green('◉') : dim('○');
    const name = index === state.cursor ? bold(s.id.padEnd(nameWidth)) : s.id.padEnd(nameWidth);
    lines.push(` ${pointer} ${box} ${name}${right ? `  ${dim(right.length > 30 ? `${right.slice(0, 29)}…` : right)}` : ''}`);
  });

  // what the story under the arrow is, in words: its name says what it is about, this is the sentence
  const here = list[state.cursor];
  lines.push('');
  lines.push(`  ${here ? dim(here.title.length > width - 4 ? `${here.title.slice(0, width - 5)}…` : here.title) : ''}`);
  const above = state.top;
  const below = Math.max(0, list.length - state.top - shown);
  const more = [above ? `↑ ${above} above` : '', below ? `↓ ${below} below` : ''].filter(Boolean).join('   ');
  lines.push(`  ${state.selected.size ? yellow(`${state.selected.size} selected`) : dim('space selects several · enter runs the one under the arrow')}${more ? `   ${dim(more)}` : ''}`);
  if (state.hint) {
    lines.push(`  ${yellow(state.hint)}`);
  }
  return lines;
}

const NAMES = { return: 'enter', escape: 'escape', backspace: 'backspace', up: 'up', down: 'down', pageup: 'pageup', pagedown: 'pagedown', home: 'home', end: 'end', space: 'space' };

/** Show the picker and resolve with the ids chosen, or null if the person left. */
export function pick(stories, { stdin = process.stdin, stdout = process.stdout, preselected = [] } = {}) {
  return new Promise(resolve => {
    const color = !process.env.NO_COLOR;
    // the title, the keys, the filter, the blank lines, the sentence of the story under the arrow and the count are not the list
    const budgetFor = () => Math.max(8, (stdout.rows || 30) - 10);
    let state = createPicker(stories, { preselected });
    let drawn = 0;

    const draw = () => {
      const lines = render(state, { width: stdout.columns || 100, budget: budgetFor(), color });
      if (drawn) {
        stdout.write(`\u001b[${drawn}A\r\u001b[J`);
      }
      stdout.write(lines.join('\n') + '\n');
      drawn = lines.length;
    };

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('\u001b[?25l');

    const finish = result => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\u001b[?25h');
      if (drawn) {
        stdout.write(`\u001b[${drawn}A\r\u001b[J`);
      }
      resolve(result);
    };

    const onKey = (str, key = {}) => {
      const name = key.ctrl && key.name === 'c' ? 'ctrl-c' : NAMES[key.name] ?? (str && str.length === 1 ? str : '');
      if (!name) {
        return;
      }
      const out = reduce(state, name, budgetFor());
      state = out.state;
      if (out.done === 'run') {
        finish([...state.selected]);
      } else if (out.done === 'cancel') {
        finish(null);
      } else {
        draw();
      }
    };

    stdin.on('keypress', onKey);
    draw();
  });
}
