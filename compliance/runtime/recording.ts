import * as fs from 'node:fs';
import * as path from 'node:path';

/** The video of one tab, and when it started. */
export interface TabRecording {
  name: string;
  /** Milliseconds since the epoch at which the tab's browser was opened (its video starts then). */
  startedAt: number;
  /** Where Playwright put the video, once the tab was closed. */
  file: string | null;
}

/** Videos bigger than this in all are linked, not embedded, so the page stays small enough to open. */
const EMBED_LIMIT = 40 * 1024 * 1024;

/**
 * Keeps what is needed to watch a story afterwards: a video of every tab, and when each step of the storyboard
 * happened. `finish()` writes one page that plays them all side by side, in step with each other.
 *
 * Playwright only records the page it creates itself, which is not where the story happens: each tab is a browser of
 * its own, opened by the test.
 */
export class Recorder {
  readonly t0 = Date.now();
  readonly tabs: TabRecording[] = [];
  readonly steps: { at: number; text: string }[] = [];

  readonly dir: string;
  private readonly title: string;

  constructor(dir: string, title = '') {
    this.dir = dir;
    this.title = title;
  }

  step(text: string): void {
    this.steps.push({ at: Date.now(), text });
  }

  /** Write `watch.html` into the folder. Returns its path, or null if there is nothing to watch. */
  finish(): string | null {
    const tabs = this.tabs.filter(t => t.file && fs.existsSync(t.file)).sort((a, b) => a.startedAt - b.startedAt);
    if (!tabs.length) {
      return null;
    }
    const total = tabs.reduce((n, t) => n + fs.statSync(t.file!).size, 0);
    const embed = total <= EMBED_LIMIT;
    const videos = tabs.map(t => ({
      name: t.name,
      offset: (t.startedAt - this.t0) / 1000,
      src: embed ? `data:video/webm;base64,${fs.readFileSync(t.file!).toString('base64')}` : path.relative(this.dir, t.file!)
    }));
    const steps = this.steps.map(s => ({ at: (s.at - this.t0) / 1000, text: s.text }));
    const out = path.join(this.dir, 'watch.html');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(out, watchPage(this.title, videos, steps));
    return out;
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page that plays the videos of a story side by side, one clock for all of them. */
export function watchPage(title: string, videos: { name: string; offset: number; src: string }[], steps: { at: number; text: string }[]): string {
  const cells = videos
    .map(
      (v, i) =>
        `<figure><figcaption>${esc(v.name)}</figcaption><video id="v${i}" src="${v.src}" muted playsinline preload="auto"></video></figure>`
    )
    .join('');
  const data = JSON.stringify({ offsets: videos.map(v => v.offset), steps }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  :root{color-scheme:light dark;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
  body{margin:0;padding:16px 20px 40px}
  h1{font-size:1.05rem;margin:0 0 12px}
  .row{display:grid;grid-template-columns:repeat(${Math.min(videos.length, 3)},minmax(0,1fr));gap:12px}
  figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}
  video{width:100%;background:#000;border-radius:6px}
  .bar{display:flex;gap:10px;align-items:center;margin:14px 0 8px}
  button,select{font:inherit;padding:4px 12px}
  input[type=range]{flex:1}
  #step{padding:10px 14px;border-left:4px solid #1976d2;background:rgba(25,118,210,.1);border-radius:4px;min-height:1.5em}
  ol{color:gray;font-size:13.5px}ol li.on{color:inherit;font-weight:600}
</style></head><body>
<h1>${esc(title)}</h1>
<div class="row">${cells}</div>
<div class="bar"><button id="play">Play</button><input id="seek" type="range" min="0" step="0.05"><span id="clock"></span>
<select id="speed"><option>0.5</option><option selected>1</option><option>2</option><option>4</option></select>×</div>
<div id="step"></div>
<ol id="steps"></ol>
<script>
const D=${data};
const vids=D.offsets.map((_,i)=>document.getElementById('v'+i));
const seek=document.getElementById('seek'),play=document.getElementById('play'),clock=document.getElementById('clock'),stepEl=document.getElementById('step'),list=document.getElementById('steps'),speed=document.getElementById('speed');
let end=Math.max(...vids.map((v,i)=>D.offsets[i]+(isFinite(v.duration)?v.duration:0)),D.steps.length?D.steps[D.steps.length-1].at+3:0);
let t=0,playing=false,last=0;
D.steps.forEach(s=>{const li=document.createElement('li');li.textContent=s.text;list.appendChild(li)});
function show(){
  vids.forEach((v,i)=>{const local=t-D.offsets[i];
    if(local<0){v.pause();v.currentTime=0;}
    else if(isFinite(v.duration)&&local>=v.duration){v.pause();v.currentTime=v.duration;}
    else{if(Math.abs(v.currentTime-local)>0.25)v.currentTime=local;if(playing&&v.paused)v.play();if(!playing&&!v.paused)v.pause();v.playbackRate=+speed.value;}});
  let k=-1;D.steps.forEach((s,i)=>{if(t>=s.at)k=i});
  stepEl.textContent=k>=0?D.steps[k].text:'';[...list.children].forEach((li,i)=>li.classList.toggle('on',i===k));
  seek.max=end;seek.value=t;clock.textContent=t.toFixed(1)+' / '+end.toFixed(1)+' s';play.textContent=playing?'Pause':'Play';
}
function tick(now){if(playing){t=Math.min(end,t+(now-last)/1000*+speed.value);if(t>=end)playing=false;}last=now;show();requestAnimationFrame(tick)}
play.onclick=()=>{if(t>=end)t=0;playing=!playing;if(!playing)vids.forEach(v=>v.pause())};
seek.oninput=()=>{t=+seek.value;show()};
vids.forEach(v=>v.addEventListener('loadedmetadata',()=>{end=Math.max(end,...vids.map((w,i)=>D.offsets[i]+(isFinite(w.duration)?w.duration:0)));show()}));
requestAnimationFrame(tick);show();
</script></body></html>
`;
}
