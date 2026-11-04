/*!
 * nbscenario — live notebook scenarios.
 *
 * Turns a scenario spec (lanes, steps, cells; see docs/02-spec-reference.md) into side-by-side notebook
 * windows that play the story: who does what, what each copy of the notebook holds after every step.
 *
 * No dependencies, no build step. Works in the browser (window.NbScenario) and in node (require) for tests:
 * everything above `mount` is pure and never touches the DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NbScenario = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ vocabulary */

  /** Lanes, in the order they are drawn, with their default names. */
  const LANES = {
    tab: 'Your tab',
    tab2: 'Second tab',
    tab3: 'Third tab',
    tab4: 'Fourth tab',
    ai: 'AI agent',
    server: 'Server',
    record: 'History record',
    store: 'Output store',
    file: 'File on disk'
  };
  const LANE_ORDER = Object.keys(LANES);
  /** Lanes that act on the notebook but hold no copy of it. */
  const NO_COPY = new Set(['ai']);
  const family = id => (/^tab\d*$/.test(id) ? 'tab' : id);

  /**
   * Kinds of step. `ms` is how long the step is on screen before typing time is added; `user` steps are
   * something a person does (their cells animate as typing); `blip` steps are over in a moment in real life
   * and are drawn that way.
   */
  const KINDS = {
    open: { icon: 'enter', ms: 1300, verb: 'opens' },
    offline: { icon: 'pause', ms: 1300, verb: 'goes offline' },
    reconnect: { icon: 'swap', ms: 1300, verb: 'reconnects', blip: true },
    leave: { icon: 'exit', ms: 1100, verb: 'leaves' },
    type: { icon: 'pencil', ms: 900, verb: 'types', user: true },
    add: { icon: 'plus', ms: 900, verb: 'adds a cell', user: true },
    delete: { icon: 'cross', ms: 1300, verb: 'deletes', user: true },
    move: { icon: 'updown', ms: 1300, verb: 'moves a cell', user: true },
    run: { icon: 'play', ms: 1300, verb: 'runs', user: true },
    free: { icon: 'exit', ms: 1200, verb: 'lets go' },
    rebuild: { icon: 'refresh', ms: 1400, verb: 'rebuilds', blip: true },
    crash: { icon: 'bolt', ms: 1300, verb: 'dies', blip: true },
    save: { icon: 'down', ms: 1100, verb: 'saves' },
    deadline: { icon: 'clock', ms: 1500, verb: 'waits' },
    fault: { icon: 'lost', ms: 1400, verb: 'loses a message' },
    late: { icon: 'hourglass', ms: 1400, verb: 'answers late' },
    outside: { icon: 'doc', ms: 1400, verb: 'is edited outside' },
    restore: { icon: 'undo', ms: 1300, verb: 'is restored' },
    remove: { icon: 'bin', ms: 1300, verb: 'is removed' },
    note: { icon: 'info', ms: 1400, verb: '' }
  };

  /** 16x16 line icons (stroke only unless the path has class "f"). */
  const ICONS = {
    enter: '<path d="M10 3h3v10h-3M7 5l3 3-3 3M10 8H3"/>',
    exit: '<path d="M6 3H3v10h3M9 5l3 3-3 3M12 8H6"/>',
    pause: '<path class="f" d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/>',
    play: '<path class="f" d="M5 3l8 5-8 5z"/>',
    swap: '<path d="M3 6h9M9.5 3.5L12 6l-2.5 2.5M13 10H4M6.5 7.5L4 10l2.5 2.5"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3"/>',
    pencil: '<path d="M3 13l.8-3L11 2.8 13.2 5 6 12.2zM9.5 4.3l2.2 2.2"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    cross: '<path d="M4 4l8 8M12 4l-8 8"/>',
    updown: '<path d="M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5"/>',
    bolt: '<path class="f" d="M9.5 1.5L4 9h3.5l-1 5.5L12 7H8.5z"/>',
    down: '<path d="M8 2.5v7.5M4.8 7.2L8 10.4l3.2-3.2M3 13.5h10"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.4"/>',
    lost: '<rect x="2" y="4" width="12" height="8.5" rx="1.2"/><path d="M2.3 5l5.7 4.2L13.7 5M2.5 14L13.5 2.5"/>',
    hourglass: '<path d="M4 2h8M4 14h8M5 2v3l3 3-3 3v3M11 2v3L8 8l3 3v3"/>',
    doc: '<path d="M4 2h5l3 3v9H4zM9 2v3h3M6 9h4M6 11.5h4"/>',
    undo: '<path d="M3 8a5 5 0 1 1 1.6 3.7M3 13v-3h3"/>',
    bin: '<path d="M3.5 4.5h9M6 4.5V3h4v1.5M4.8 4.5l.7 9h5l.7-9"/>',
    info: '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.6M8 5v.3"/>',
    spark: '<path class="f" d="M8 1.5l1.4 4.6 4.6 1.4-4.6 1.4L8 13.5 6.6 8.9 2 7.5l4.6-1.4z"/>',
    server: '<rect x="2.5" y="3" width="11" height="4" rx="1"/><rect x="2.5" y="9" width="11" height="4" rx="1"/><path d="M5 5h.1M5 11h.1"/>',
    window: '<rect x="2" y="3" width="12" height="10" rx="1.4"/><path d="M2 6.2h12"/>',
    box: '<path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11zM2.5 5L8 7.5 13.5 5M8 7.5v6"/>'
  };

  const icon = (name, cls) =>
    '<svg class="nbs-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" aria-hidden="true">' + ICONS[name] + '</svg>';

  /** What each lane shows in its status chip. [label, tone] */
  const STATUS = {
    tab: { online: ['Connected', 'ok'], offline: ['Offline', 'bad'], reconnecting: ['Reconnecting…', 'warn'], closed: ['Closed', 'mute'] },
    server: { holding: ['Holds the notebook', 'ok'], idle: ['Not holding it', 'mute'], rebuilding: ['Rebuilding…', 'warn'], stopped: ['Stopped', 'bad'] },
    file: { saved: ['Saved', 'ok'], changed: ['Changed outside', 'warn'], missing: ['Deleted', 'bad'], restored: ['Restored', 'warn'] }
  };
  /** The status a lane takes when a kind of step happens to it. */
  const AFTER = {
    open: { tab: 'online', server: 'holding' },
    offline: { tab: 'offline' },
    reconnect: { tab: 'reconnecting' },
    leave: { tab: 'closed' },
    free: { server: 'idle' },
    rebuild: { server: 'rebuilding' },
    crash: { server: 'stopped' },
    save: { file: 'saved' },
    outside: { file: 'changed' },
    remove: { file: 'missing' },
    restore: { file: 'restored' }
  };
  /** A moment later, these statuses settle. */
  const SETTLE = { reconnecting: 'online', rebuilding: 'holding' };
  const START_STATUS = { tab: 'online', server: 'holding', file: 'saved' };

  /* ------------------------------------------------------------------ defaults for the cell display */

  const DEFAULTS = {
    /** What a cell name stands for, as code. A name that is not here is shown as print("name"). */
    bank: {
      c0: 'import pandas as pd',
      c1: 'df = pd.read_csv(path)',
      c2: 'df.describe()',
      tests: 'assert len(df) > 0',
      docs: '# How to run this notebook'
    },
    /** A note that rewrites the cell: the cell shows this code and the note as a tag. */
    rewrites: {},
    /** What an output note ("1 output") shows. */
    outputs: { default: '42' },
    /** Speed of typing, in ms per character. */
    typingMs: 55
  };
  const withDefaults = cfg => {
    cfg = cfg || {};
    return {
      bank: Object.assign({}, DEFAULTS.bank, cfg.bank),
      rewrites: Object.assign({}, DEFAULTS.rewrites, cfg.rewrites),
      outputs: Object.assign({}, DEFAULTS.outputs, cfg.outputs),
      typingMs: cfg.typingMs || DEFAULTS.typingMs
    };
  };

  /* ------------------------------------------------------------------ cells */

  const MARKS = { '': 'plain', '+': 'new', '-': 'gone', '^': 'moved', '?': 'copy', '#': 'out', '!': 'bad' };
  const CELL_RE = /^([+\-^?#!]?)([^=]*?)(?:=([\s\S]*))?$/;

  /** `{look, name, note}` of a cell token. `look` is a value of MARKS, `edited` or `remark`. */
  function parseCell(token) {
    if (token.charAt(0) === '*') return { look: 'remark', name: token.slice(1).trim(), note: '' };
    const m = CELL_RE.exec(token);
    const name = m[2].trim();
    const note = (m[3] || '').trim();
    let look = MARKS[m[1]];
    if (look === 'plain' && note) look = 'edited';
    return { look, name, note };
  }

  /** "+A +B" -> ["# A", "# B"]: typed text is drawn as a trailing comment so that it reads as code. */
  function splitTyped(note) {
    return note
      .split(/\s+(?=\+)/)
      .map(s => s.replace(/^\+/, '').trim())
      .filter(Boolean)
      .map(s => (s.charAt(0) === '#' ? s : '# ' + s));
  }

  /** How one cell token is shown. Pure. */
  function viewOf(token, cfg) {
    const p = parseCell(token);
    if (p.look === 'remark') return { remark: true, text: p.name, key: '~' + p.name, look: 'remark' };
    let name = p.name;
    let typed = [];
    const withTyped = /^(\S+) (\+.+)$/.exec(name); // "c1 +B-TYPED": a copy of c1 with typing in it
    if (withTyped) {
      name = withTyped[1];
      typed = typed.concat(splitTyped(withTyped[2]));
    }
    let base = cfg.bank[name] !== undefined ? cfg.bank[name] : 'print(' + JSON.stringify(name) + ')';
    let tag = '';
    let out = null;
    let note = p.note;
    if (note) {
      if (/^\d+ outputs?$/.test(note)) {
        out = cfg.outputs[note] !== undefined ? cfg.outputs[note] : cfg.outputs.default;
      } else if (note.charAt(0) === '+') {
        typed = typed.concat(splitTyped(note));
      } else {
        const parts = note.split(' + ');
        if (parts.length === 2 && cfg.rewrites[parts[0]] !== undefined) {
          base = cfg.rewrites[parts[0]];
          tag = parts[0];
          typed = typed.concat(splitTyped('+' + parts[1]));
        } else if (cfg.rewrites[note] !== undefined) {
          base = cfg.rewrites[note];
          tag = note;
        } else if (/ = /.test(note)) {
          base = note; // the note is the new code
        } else {
          tag = note;
        }
      }
    }
    const code = base + typed.map(t => '  ' + t).join('');
    return { key: name, look: p.look, base, typed, code, tag, out, sig: [p.look, code, tag, out].join('\u0000') };
  }

  /* ------------------------------------------------------------------ timeline */

  class SpecError extends Error {}

  function lanesOf(step) {
    return Array.isArray(step.at) ? step.at : [step.at];
  }

  /** The lanes drawn, in order: those the spec lists, else those it uses. */
  function laneList(spec) {
    const given = spec.lanes || {};
    let ids = LANE_ORDER.filter(l => l in given);
    if (!ids.length) {
      const used = new Set(Object.keys(spec.start || { file: 1 }));
      Object.keys(spec.ends || {}).forEach(l => l !== 'all' && used.add(l));
      (spec.steps || []).forEach(s => {
        lanesOf(s).forEach(l => used.add(l));
        if (s.to) used.add(s.to);
      });
      ids = LANE_ORDER.filter(l => used.has(l));
    }
    return ids.map(id => ({ id, title: given[id] || LANES[id] }));
  }

  const emptyLane = id => ({
    id,
    visible: false,
    status: null,
    cells: [],
    ghosts: [],
    text: '',
    verb: '',
    kind: '',
    acting: false,
    receiving: false,
    active: null,
    editing: false
  });

  const stripFx = v => (v.fx || v.typeAll || v.typeText || v.diff ? Object.assign({}, v, { fx: null, typeAll: false, typeText: '', before: '', diff: false }) : v);

  /** The next frame starts from the last one, with everything that was momentary cleared. */
  function carry(prev) {
    const out = {};
    Object.keys(prev).forEach(id => {
      const l = prev[id];
      out[id] = Object.assign({}, l, {
        cells: l.cells.map(stripFx),
        ghosts: [],
        acting: false,
        receiving: false,
        verb: '',
        kind: '',
        text: l.text,
        status: SETTLE[l.status] || l.status
      });
    });
    return out;
  }

  /** Put new cells in a lane, working out what changed (for the animation). */
  function setCells(lane, tokens, user, cfg) {
    const prev = lane.cells;
    const prevByKey = new Map(prev.filter(c => !c.remark).map((c, i) => [c.key, { c, i }]));
    const seen = {};
    const views = [];
    const ghosts = [];
    (typeof tokens === 'string' ? ['*' + tokens] : tokens).forEach((tok, idx) => {
      const v = viewOf(tok, cfg);
      if (v.look === 'gone') {
        ghosts.push(Object.assign({}, v, { at: idx, fx: 'gone' }));
        return;
      }
      seen[v.key] = (seen[v.key] || 0) + 1;
      if (seen[v.key] > 1) v.key += '~' + seen[v.key];
      views.push(v);
    });
    let typedKey = null;
    let typedChars = 0;
    views.forEach((v, i) => {
      if (v.remark) return;
      const old = prevByKey.get(v.key);
      if (!old) {
        if (user && v.look === 'new') {
          v.typeAll = true;
          typedKey = v.key;
          typedChars = Math.max(typedChars, v.code.length);
        }
        v.fx = 'enter';
      } else if (old.c.sig !== v.sig) {
        const had = old.c.typed;
        const grew = v.typed.length > had.length && had.every((t, j) => t === v.typed[j]);
        if (user && grew) {
          v.typeText = v.typed.slice(had.length).map(t => '  ' + t).join('');
          v.before = v.code.slice(0, v.code.length - v.typeText.length);
          typedKey = v.key;
          typedChars = Math.max(typedChars, v.typeText.length);
        }
        v.fx = 'changed';
      } else if (old.i !== i && v.look === 'moved') {
        v.fx = 'moved';
      }
    });
    // what was there and no longer is: shown struck through for a moment
    const keys = new Set(views.map(v => v.key));
    prev.forEach((c, i) => {
      if (!c.remark && !keys.has(c.key) && !ghosts.some(g => g.key === c.key)) ghosts.push(Object.assign({}, c, { at: i, fx: 'gone' }));
    });
    lane.cells = views;
    lane.ghosts = ghosts;
    if (typedKey) {
      lane.active = typedKey;
      lane.editing = !!user;
    } else {
      lane.editing = false;
    }
    return typedChars;
  }

  /**
   * On a reconnect, mark what differs between the tab and the others: the pause before the jump. The reference is the
   * server's copy when the story gives it one, else the copy of a tab that is still connected.
   */
  function markDiff(frameLanes, step) {
    if (step.kind !== 'reconnect') return;
    const away = lane => lanesOf(step).indexOf(lane.id) >= 0 || lane.status === 'offline' || lane.status === 'closed';
    lanesOf(step).forEach(id => {
      const tab = frameLanes[id];
      if (!tab || !tab.cells.length) return;
      const named = step.to && frameLanes[step.to];
      let ref = named && named.cells.length ? named : null;
      if (!ref) {
        ref = Object.keys(frameLanes).map(k => frameLanes[k]).find(l => l.visible && l.cells.length && !away(l) && !NO_COPY.has(l.id));
      }
      if (!ref) return;
      const server = family(ref.id) === 'server' || family(ref.id) === 'file';
      const mineTag = server ? 'differs from the server' : 'differs from the other tab';
      const theirTag = server ? 'the server’s version' : 'the other tab’s version';
      const pool = {};
      ref.cells.forEach(c => !c.remark && (pool[c.code] = (pool[c.code] || 0) + 1));
      const mine = {};
      tab.cells.forEach(c => !c.remark && (mine[c.code] = (mine[c.code] || 0) + 1));
      tab.cells = tab.cells.map(c => {
        if (c.remark) return c;
        if (pool[c.code] > 0) {
          pool[c.code]--;
          return c;
        }
        return Object.assign({}, c, { diff: mineTag });
      });
      ref.cells = ref.cells.map(c => {
        if (c.remark) return c;
        if (mine[c.code] > 0) {
          mine[c.code]--;
          return c;
        }
        return Object.assign({}, c, { diff: theirTag });
      });
    });
  }

  const cloneLanes = lanes => {
    const out = {};
    Object.keys(lanes).forEach(id => (out[id] = Object.assign({}, lanes[id])));
    return out;
  };

  /**
   * The frames of a story: `start`, one per step, `end`. Each frame holds a snapshot of every lane,
   * what is momentary in it (typing, changes, ghosts) and how long it stays on screen.
   */
  function buildTimeline(spec, config) {
    const cfg = withDefaults(config);
    if (!Array.isArray(spec.steps) || !spec.steps.length) throw new SpecError('a scenario has steps');
    const lanes = laneList(spec);
    const ids = lanes.map(l => l.id);
    const titleOf = id => (lanes.find(l => l.id === id) || { title: LANES[id] || id }).title;
    let cur = {};
    ids.forEach(id => (cur[id] = emptyLane(id)));
    // by default the file holds three cells; a story that does not draw the file just does not show them
    const start = spec.start || (cur.file ? { file: ['c0', 'c1', 'c2'] } : {});
    Object.keys(start).forEach(id => {
      if (!cur[id]) throw new SpecError('start names a lane that is not drawn: ' + id);
      cur[id].visible = true;
      cur[id].status = START_STATUS[family(id)] || null;
      setCells(cur[id], start[id], false, cfg);
      cur[id].cells = cur[id].cells.map(stripFx);
      cur[id].ghosts = [];
    });
    const frames = [{ index: 0, kind: 'start', text: 'Start: what each copy of the notebook holds', at: [], to: null, ms: 1100, lanes: cloneLanes(cur) }];

    spec.steps.forEach((st, i) => {
      const kind = KINDS[st.kind];
      if (!kind) throw new SpecError('step ' + (i + 1) + ': unknown kind ' + st.kind);
      const next = carry(cur);
      const at = lanesOf(st);
      let typedChars = 0;
      at.concat(st.to ? [st.to] : []).forEach(id => {
        if (!next[id]) throw new SpecError('step ' + (i + 1) + ': lane ' + id + ' is not drawn');
      });
      at.forEach(id => {
        const l = next[id];
        l.visible = true;
        l.acting = true;
        l.verb = kind.verb;
        l.kind = st.kind;
        l.text = st.text;
        const after = (AFTER[st.kind] || {})[family(id)];
        if (after) l.status = after;
        else if (!l.status && STATUS[family(id)]) l.status = START_STATUS[family(id)];
        if ('cells' in st && !NO_COPY.has(id)) typedChars = Math.max(typedChars, setCells(l, st.cells, !!kind.user, cfg));
      });
      if (st.to) {
        next[st.to].visible = true;
        next[st.to].receiving = true;
        if (!next[st.to].status && STATUS[family(st.to)]) next[st.to].status = START_STATUS[family(st.to)];
      }
      markDiff(next, st);
      const typing = Math.min(typedChars * cfg.typingMs, 2600);
      const reading = Math.max(0, st.text.length - 70) * 12;
      frames.push({
        index: i + 1,
        kind: st.kind,
        text: st.text,
        at,
        to: st.to || null,
        user: !!kind.user,
        blip: !!kind.blip,
        ms: Math.round(kind.ms + typing + reading),
        typingStart: 350,
        lanes: cloneLanes(next)
      });
      cur = next;
    });

    frames.push(endFrame(spec, cur, ids, cfg, frames.length));
    const starts = [];
    let total = 0;
    frames.forEach(f => {
      starts.push(total);
      total += f.ms;
    });
    return { lanes, frames, starts, total, config: cfg, titleOf };
  }

  /** The last frame: every lane that holds a copy shows how the story must end. */
  function endFrame(spec, cur, ids, cfg, index, ends) {
    ends = ends || spec.ends || {};
    if (Array.isArray(ends) || typeof ends === 'string') ends = { all: ends };
    const next = carry(cur);
    // when the story is over the file has been saved again, whatever changed it on the way
    ids.forEach(id => {
      if (next[id].status === 'changed' || next[id].status === 'restored') next[id].status = 'saved';
    });
    ids.forEach(id => {
      if (NO_COPY.has(id)) return;
      const cells = id in ends ? ends[id] : ends.all;
      if (cells === undefined) return;
      next[id].visible = true;
      if (!next[id].status && STATUS[family(id)]) next[id].status = START_STATUS[family(id)];
      setCells(next[id], cells, false, cfg);
    });
    return { index, kind: 'end', text: spec.result || '', at: [], to: null, end: true, ms: 3400, lanes: cloneLanes(next) };
  }

  /** The timeline of a story whose ending is the one an option of its decision gives. */
  function withEnding(tl, spec, ends) {
    const frames = tl.frames.slice(0, -1);
    const before = frames[frames.length - 1].lanes;
    const ids = tl.lanes.map(l => l.id);
    frames.push(endFrame(spec, before, ids, tl.config, frames.length, ends));
    return Object.assign({}, tl, { frames });
  }

  /* ------------------------------------------------------------------ drawing (strings) */

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const HL = /(^%%\w+)|(#.*$)|("[^"\n]*"|'[^'\n]*')|\b(import|as|from|def|return|for|in|if|else|None|True|False|assert|not|and|or|with|lambda)\b|\b(\d+(?:\.\d+)?)\b/gm;
  /** Python-ish syntax colouring: enough for the short cells these stories use. */
  function highlight(code) {
    return esc(code).replace(HL, (m, magic, comment, str, kw, num) =>
      magic ? '<span class="nbs-mg">' + magic + '</span>'
      : comment ? '<span class="nbs-c">' + comment + '</span>'
      : str ? '<span class="nbs-s">' + str + '</span>'
      : kw ? '<span class="nbs-k">' + kw + '</span>'
      : num ? '<span class="nbs-n">' + num + '</span>' : m);
  }

  const DEFAULT_TAG = { moved: 'moved', copy: 'copy', bad: 'must never happen' };

  function cellHTML(v, lane, o) {
    if (v.remark) return '<div class="nbs-remark">' + esc(v.text) + '</div>';
    const live = !o.static;
    const fx = live && v.fx ? ' nbs-fx-' + v.fx : '';
    const active = lane.active === v.key && family(lane.id) === 'tab' ? ' nbs-active' + (lane.editing ? ' nbs-edit' : '') : '';
    const diff = v.diff ? ' nbs-diff' : '';
    const caret = active && lane.editing && (lane.status === 'online' || lane.status === 'offline') ? '<span class="nbs-caret"></span>' : '';
    let src;
    if (!live && v.typed.length) src = highlight(v.base) + '<span class="nbs-ins nbs-keep">' + highlight(v.typed.map(t => '  ' + t).join('')) + '</span>' + caret;
    else if (live && v.typeAll) src = '<span class="nbs-ins nbs-tw">' + highlight(v.code) + '</span>' + caret;
    else if (live && v.typeText) src = highlight(v.before) + '<span class="nbs-ins nbs-tw">' + highlight(v.typeText) + '</span>' + caret;
    else src = highlight(v.code) + caret;
    const tag = v.diff || v.tag || DEFAULT_TAG[v.look] || '';
    const marker = v.look === 'moved' ? '<span class="nbs-mv">↕</span>' : '';
    return (
      '<div class="nbs-cell nbs-look-' + v.look + fx + active + diff + '" data-key="' + esc(v.key) + '">' +
      (tag ? '<span class="nbs-tag">' + esc(tag) + '</span>' : '') +
      '<div class="nbs-prompt">' + marker + (v.out ? '[1]:' : '[ ]:') + '</div>' +
      '<div class="nbs-col"><pre class="nbs-src">' + src + '</pre>' +
      (v.out ? '<div class="nbs-out"><span class="nbs-oprompt">Out[1]:</span>' + esc(v.out) + '</div>' : '') +
      '</div></div>'
    );
  }

  function ghostHTML(g, o) {
    return '<div class="nbs-cell nbs-look-gone' + (o.static ? '' : ' nbs-fx-gone') + '"><div class="nbs-prompt">[ ]:</div><div class="nbs-col"><pre class="nbs-src">' + highlight(g.code) + '</pre></div></div>';
  }

  function cellsHTML(lane, o) {
    const items = lane.cells.map(v => cellHTML(v, lane, o));
    if (!o.static) {
      lane.ghosts
        .slice()
        .sort((a, b) => b.at - a.at)
        .forEach(g => items.splice(Math.min(g.at, items.length), 0, ghostHTML(g, o)));
    }
    return items.join('') || '<div class="nbs-empty">no cells</div>';
  }

  const LANE_ICON = { tab: 'window', server: 'server', file: 'doc', ai: 'spark', record: 'box', store: 'box' };

  function panelHTML(lane, title, o) {
    const fam = family(lane.id);
    const head = (chip, extra) =>
      '<header class="nbs-phead">' + icon(LANE_ICON[fam] || 'box') + '<span class="nbs-ptitle">' + esc(title) + '</span>' + chip + '</header>' + (extra || '');
    if (!lane.visible) {
      return '<section class="nbs-panel nbs-dormant nbs-lane-' + fam + '" data-lane="' + lane.id + '">' + head('<span class="nbs-chip nbs-mute">not yet</span>', '<div class="nbs-pbody"><div class="nbs-empty">—</div></div>') + '</section>';
    }
    const st = (STATUS[fam] || {})[lane.status];
    const chip = st ? '<span class="nbs-chip nbs-' + st[1] + '">' + esc(st[0]) + '</span>' : '';
    const act = lane.acting && lane.verb ? '<div class="nbs-act nbs-k-' + lane.kind + '">' + icon((KINDS[lane.kind] || KINDS.note).icon) + '<span>' + esc(lane.verb) + '</span></div>' : '';
    const snap = !o.static && lane.cells.some(c => c.fx && c.fx !== 'gone') && !lane.editing ? ' nbs-snap' : '';
    let body;
    if (NO_COPY.has(lane.id) || ((fam === 'record' || fam === 'store') && !lane.cells.length)) {
      body = '<div class="nbs-note">' + (lane.text ? esc(lane.text) : '—') + '</div>';
    } else {
      body = cellsHTML(lane, o);
    }
    return (
      '<section class="nbs-panel nbs-lane-' + fam + (lane.acting ? ' nbs-acting' : '') + (lane.receiving ? ' nbs-receiving' : '') + snap + (lane.status === 'offline' || lane.status === 'closed' || lane.status === 'stopped' ? ' nbs-away' : '') + '" data-lane="' + lane.id + '">' +
      head(chip, act) + '<div class="nbs-pbody">' + body + '</div></section>'
    );
  }

  /** The notebook windows of one frame. */
  function boardHTML(tl, frame, opts) {
    const o = opts || {};
    return tl.lanes.map(l => panelHTML(frame.lanes[l.id], l.title, o)).join('');
  }

  /** A small static picture of a list of cells (an option of a decision, say). */
  function miniHTML(tokens, config) {
    const cfg = withDefaults(config);
    const cells = typeof tokens === 'string' ? ['*' + tokens] : tokens;
    return '<div class="nbs-mini">' + cells.map(t => {
      const v = viewOf(t, cfg);
      if (v.remark) return '<div class="nbs-remark">' + esc(v.text) + '</div>';
      return '<div class="nbs-mcell nbs-look-' + v.look + '"><code>' + highlight(v.code.split('\n')[0]) + '</code>' + ((v.tag || DEFAULT_TAG[v.look]) ? '<span class="nbs-tag">' + esc(v.tag || DEFAULT_TAG[v.look]) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  /**
   * "The problem in one picture": a few notebook windows side by side, each a moment in time.
   * panels: [{title, status: 'online'|'offline'|..., cells: [tokens], caption, lane?: 'tab'}]
   */
  function triptychHTML(panels, config) {
    const cfg = withDefaults(config);
    return '<div class="nbs-trip">' + panels.map((p, i) => {
      const lane = Object.assign(emptyLane(p.lane || 'tab'), { visible: true, status: p.status || 'online', active: p.active || null, editing: !!p.editing });
      lane.cells = (p.cells || []).map((t, j) => Object.assign(viewOf(t, cfg), {}));
      const used = new Set();
      lane.cells.forEach(c => {
        while (used.has(c.key)) c.key += '~';
        used.add(c.key);
      });
      return '<figure class="nbs-fig"><div class="nbs-figstep">' + (i + 1) + '</div>' +
        panelHTML(lane, p.title, { static: true }) +
        (p.caption ? '<figcaption>' + p.caption + '</figcaption>' : '') + '</figure>';
    }).join('<div class="nbs-figarrow" aria-hidden="true">→</div>') + '</div>';
  }

  /* ------------------------------------------------------------------ the player (DOM) */

  const players = new Set();
  let ticking = false;
  let last = 0;
  function tickAll(now) {
    const dt = Math.min(100, now - last);
    last = now;
    let any = false;
    players.forEach(p => {
      if (p.active()) {
        any = true;
        p.tick(dt);
      }
    });
    if (any) requestAnimationFrame(tickAll);
    else ticking = false;
  }
  function wake() {
    if (!ticking) {
      ticking = true;
      last = performance.now();
      requestAnimationFrame(tickAll);
    }
  }

  /**
   * Mount a story in `el`. Returns {play, pause, seek, destroy}.
   * opts: {config, autoplay: 'visible' | true | false, loop: true, reduced: bool, answerLabel: 'Proposed'}
   */
  function mount(el, spec, opts) {
    opts = opts || {};
    const reduced = opts.reduced !== undefined ? opts.reduced : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tl = buildTimeline(spec, opts.config);
    const baseTl = tl;
    const n = tl.lanes.length;

    const badges = (spec.badges || []).map(b => '<span class="nbs-badge nbs-badge-' + esc(b.tone || 'info') + '"' + (b.title ? ' title="' + esc(b.title) + '"' : '') + '>' + esc(b.text) + '</span>').join('');
    const steps = spec.steps.map((s, i) => '<li data-i="' + (i + 1) + '"><b>' + esc(lanesOf(s).map(tl.titleOf).join(' + ')) + '</b> ' + esc(s.text) + (s.to ? ' <span class="nbs-to">→ ' + esc(tl.titleOf(s.to)) + '</span>' : '') + '</li>').join('');
    const d = spec.decision;
    const label = opts.answerLabel || (spec.decision && spec.decision.answerLabel) || 'Proposed';
    const decision = d
      ? '<div class="nbs-decision"><div class="nbs-dhead">Needs alignment</div><p class="nbs-q">' + esc(d.question) + '</p>' +
        '<div class="nbs-opts" role="radiogroup" aria-label="Options">' +
        d.options.map((op, i) => '<button type="button" role="radio" class="nbs-opt' + (op.proposed ? ' nbs-proposed on' : '') + '" aria-checked="' + (op.proposed ? 'true' : 'false') + '" data-o="' + i + '">' +
          (op.proposed ? '<span class="nbs-flag">' + esc(label) + '</span>' : '') + '<b>' + esc(op.label) + '</b><span class="nbs-odetail">' + esc(op.detail) + '</span>' +
          (op.ends ? '<span class="nbs-oends">How it ends</span>' + miniHTML(op.ends, opts.config) : '') + '</button>').join('') +
        '</div></div>'
      : '';

    el.classList.add('nbs');
    el.innerHTML =
      (spec.title ? '<header class="nbs-head">' + (spec.id ? '<span class="nbs-id">' + esc(spec.id) + '</span>' : '') + '<h3>' + esc(spec.title) + '</h3>' + badges + '</header>' : '') +
      (spec.story ? '<p class="nbs-story">' + esc(spec.story) + '</p>' : '') +
      '<div class="nbs-stage"><div class="nbs-board" style="--n:' + n + '"></div><div class="nbs-flights" aria-hidden="true"></div></div>' +
      '<div class="nbs-bar"><button type="button" class="nbs-play" aria-label="Play or pause"></button><div class="nbs-segs" role="group" aria-label="Steps"></div></div>' +
      '<div class="nbs-caption" aria-live="polite"></div>' +
      '<details class="nbs-steps"><summary>The steps, as text</summary><ol>' + steps + '</ol></details>' +
      (spec.result ? '<div class="nbs-result"><b>What the product does</b><span>' + esc(spec.result) + '</span></div>' : '') +
      (spec.risk ? '<p class="nbs-risk"><b>Why it matters</b> ' + esc(spec.risk) + '</p>' : '') +
      decision;

    const $ = s => el.querySelector(s);
    const board = $('.nbs-board');
    const flights = $('.nbs-flights');
    const stage = $('.nbs-stage');
    const playBtn = $('.nbs-play');
    const segsEl = $('.nbs-segs');
    const caption = $('.nbs-caption');
    const stepItems = el.querySelectorAll('.nbs-steps li');

    function drawSegs() {
      segsEl.innerHTML = tl.frames.map((f, i) => {
        const lbl = f.kind === 'start' ? '' : f.end ? '✓' : String(i);
        return '<button type="button" class="nbs-seg' + (f.blip ? ' nbs-blip' : '') + (f.end ? ' nbs-endseg' : '') + '" data-i="' + i + '" style="flex:' + f.ms + ' 1 ' + (f.blip ? 22 : 18) + 'px" aria-label="' + esc(f.kind === 'start' ? 'Start' : f.end ? 'End' : 'Step ' + i + ': ' + f.text) + '"><span class="nbs-fill"></span><span class="nbs-n">' + lbl + '</span></button>';
      }).join('');
    }
    drawSegs();

    let t = reduced ? tl.starts[tl.frames.length - 1] + 1 : 0;
    let shown = -1;
    let playing = opts.autoplay !== false && !reduced;
    let visible = false;
    let hold = 0;
    let typing = [];
    let flight = null;
    let elapsed = 0;

    const frameAt = tt => {
      let idx = 0;
      tl.starts.forEach((s, i) => {
        if (tt >= s) idx = i;
      });
      return idx;
    };

    function render(idx) {
      const f = tl.frames[idx];
      board.innerHTML = boardHTML(tl, f, { static: reduced });
      el.classList.toggle('nbs-ended', !!f.end);
      el.classList.toggle('nbs-instant', !!f.blip);
      const names = f.at.map(tl.titleOf).join(' + ');
      const kind = KINDS[f.kind];
      caption.innerHTML = f.kind === 'start' || f.end
        ? '<span class="nbs-capnum">' + (f.end ? '✓' : '·') + '</span><span>' + esc(f.text) + '</span>'
        : '<span class="nbs-capnum">' + idx + '</span>' + icon(kind.icon) + '<span><b>' + esc(names) + '</b> ' + esc(f.text) + (f.to ? ' <span class="nbs-to">→ ' + esc(tl.titleOf(f.to)) + '</span>' : '') + '</span>' + (f.blip ? '<span class="nbs-quick">⚡ over in a moment</span>' : '');
      stepItems.forEach((li, i) => li.classList.toggle('on', i + 1 === idx));
      segsEl.querySelectorAll('.nbs-seg').forEach((s, i) => {
        s.classList.toggle('on', i === idx);
        s.classList.toggle('past', i < idx);
      });
      typing = [];
      if (!reduced) {
        board.querySelectorAll('.nbs-tw').forEach((tw, k) => {
          const nodes = [];
          const w = document.createTreeWalker(tw, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) nodes.push([w.currentNode, w.currentNode.nodeValue]);
          const total = nodes.reduce((a, x) => a + x[1].length, 0);
          nodes.forEach(x => (x[0].nodeValue = ''));
          typing.push({ nodes, total, shown: 0 });
        });
      }
      startFlight(f);
      shown = idx;
    }

    function startFlight(f) {
      if (flight) flight.el.remove();
      flight = null;
      flights.innerHTML = '';
      if (reduced || !f.to || !f.at.length || typeof Element === 'undefined' || !Element.prototype.animate) return;
      const from = board.querySelector('[data-lane="' + f.at[0] + '"]');
      const to = board.querySelector('[data-lane="' + f.to + '"]');
      if (!from || !to) return;
      const base = stage.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const ax = a.left + a.width / 2 - base.left;
      const bx = b.left + b.width / 2 - base.left;
      const y = 44;
      const dot = document.createElement('div');
      dot.className = 'nbs-dot';
      flights.appendChild(dot);
      const anim = dot.animate([{ transform: 'translate(' + ax + 'px,' + y + 'px)', opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { transform: 'translate(' + bx + 'px,' + y + 'px)', opacity: 0 }], { duration: 800, fill: 'both' });
      anim.pause();
      flight = { el: dot, anim };
    }

    function step() {
      const f = tl.frames[shown];
      elapsed = t - tl.starts[shown];
      const per = tl.config.typingMs;
      let begin = (f.typingStart || 0);
      typing.forEach(ty => {
        const k = Math.max(0, Math.min(ty.total, Math.floor((elapsed - begin) / per)));
        begin += ty.total * per + 200;
        if (k === ty.shown) return;
        ty.shown = k;
        let left = k;
        ty.nodes.forEach(x => {
          const m = Math.min(x[1].length, left);
          x[0].nodeValue = x[1].slice(0, m);
          left -= m;
        });
      });
      if (flight) flight.anim.currentTime = Math.max(0, Math.min(800, elapsed - 100));
      const fills = segsEl.children;
      for (let i = 0; i < fills.length; i++) {
        const frac = i < shown ? 1 : i === shown ? Math.min(1, elapsed / tl.frames[i].ms) : 0;
        fills[i].firstChild.style.width = (tl.frames[i].blip ? (i < shown ? 100 : 0) : frac * 100) + '%';
      }
    }

    function paint() {
      const idx = frameAt(t);
      if (idx !== shown) render(idx);
      step();
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.classList.toggle('nbs-paused', !playing);
      el.classList.toggle('nbs-pausedall', !playing);
    }

    const ctrl = {
      active: () => playing && visible,
      tick(dt) {
        if (t >= tl.total) {
          hold += dt;
          if (hold > 600 && opts.loop !== false) {
            t = 0;
            hold = 0;
          }
        } else {
          t = Math.min(tl.total, t + dt);
        }
        paint();
      },
      play() {
        if (t >= tl.total) t = 0;
        playing = true;
        paint();
        wake();
      },
      pause() {
        playing = false;
        paint();
      },
      seek(i) {
        t = tl.starts[Math.max(0, Math.min(tl.frames.length - 1, i))] + 1;
        hold = 0;
        shown = -1;
        paint();
      },
      destroy() {
        players.delete(ctrl);
        io && io.disconnect();
      }
    };

    playBtn.addEventListener('click', () => (playing ? ctrl.pause() : ctrl.play()));
    segsEl.addEventListener('click', e => {
      const b = e.target.closest('.nbs-seg');
      if (b) ctrl.seek(+b.dataset.i);
    });
    const optsEl = el.querySelector('.nbs-opts');
    if (optsEl) {
      optsEl.addEventListener('click', e => {
        const b = e.target.closest('.nbs-opt');
        if (!b) return;
        const op = d.options[+b.dataset.o];
        optsEl.querySelectorAll('.nbs-opt').forEach(x => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        });
        tl = op.ends && !op.proposed ? withEnding(baseTl, spec, op.ends) : baseTl;
        shown = -1;
        t = tl.starts[tl.frames.length - 1] + 1;
        hold = 0;
        drawSegs();
        paint();
      });
    }

    players.add(ctrl);
    let io = null;
    if (typeof IntersectionObserver === 'function' && opts.autoplay !== false && !reduced) {
      io = new IntersectionObserver(entries => {
        entries.forEach(en => {
          visible = en.isIntersecting;
          if (visible) wake();
        });
      }, { threshold: 0.35 });
      io.observe(el);
    } else {
      visible = opts.autoplay !== false;
    }
    paint();
    return ctrl;
  }

  /** Mount every `<div data-nbs>` that holds a `<script type="application/json">` spec. */
  function mountAll(rootEl, opts) {
    const out = [];
    (rootEl || document).querySelectorAll('[data-nbs]').forEach(el => {
      const s = el.querySelector('script[type="application/json"]');
      if (s) out.push(mount(el, JSON.parse(s.textContent), opts));
    });
    return out;
  }

  /** Draw a triptych ("the problem in one picture") into `el`. */
  function triptych(el, panels, config) {
    el.classList.add('nbs');
    el.innerHTML = triptychHTML(panels, config);
  }

  return {
    LANES, KINDS, STATUS, ICONS,
    SpecError, parseCell, viewOf, buildTimeline, withEnding, boardHTML, miniHTML, triptychHTML, highlight,
    mount, mountAll, triptych
  };
});
