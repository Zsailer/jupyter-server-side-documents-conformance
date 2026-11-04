# Theming: Jupyter light and dark

The player looks like JupyterLab, and every colour is a CSS variable, so it follows a page's theme or can be re-skinned
in a few lines.

## How it picks light or dark

```
<html>                     → follows the system (prefers-color-scheme)
<html data-theme="light">  → always light
<html data-theme="dark">   → always dark
```

`examples/storyboards` has a three-way **Auto / Light / Dark** control that sets `data-theme` and remembers the choice
(`localStorage`, key `nbs-theme`). A small script in `<head>` applies the saved choice *before* the first paint, so
there is no flash of the wrong theme:

```html
<script>try{var t=localStorage.getItem('nbs-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
```

Three lines are enough on a page that only needs a toggle:

```js
var el = document.documentElement;
var dark = el.dataset.theme ? el.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
el.dataset.theme = dark ? 'light' : 'dark';
```

## The tokens

All start with `--nbs-`. Light values follow JupyterLab Light; dark follow JupyterLab Dark.

| token | used for |
|---|---|
| `--nbs-bg`, `--nbs-bg-page`, `--nbs-bg-panel`, `--nbs-bg-bar` | page, notebook window body, window header |
| `--nbs-fg`, `--nbs-fg2`, `--nbs-fg3` | text, secondary text, hints |
| `--nbs-border`, `--nbs-border-strong` | dividers, controls |
| `--nbs-brand`, `--nbs-brand-strong`, `--nbs-brand-bg` | active cell, links, play button, current step |
| `--nbs-cell-bg`, `--nbs-cell-edit-bg`, `--nbs-edit` | cell input; the cell being typed in (green, as in Jupyter's edit mode) |
| `--nbs-prompt-in`, `--nbs-prompt-out` | the `[ ]:` and `Out[ ]:` prompts |
| `--nbs-ok`, `--nbs-warn`, `--nbs-bad`, `--nbs-mute` (+ `-bg`) | status chips, results, recovered and wrong cells |
| `--nbs-ins` | the background of text that has just been typed |
| `--nbs-k`, `--nbs-s`, `--nbs-c`, `--nbs-n`, `--nbs-mg` | keywords, strings, comments, numbers, magics |
| `--nbs-font`, `--nbs-mono` | UI font, code font |

## Re-skinning

Override the tokens after the stylesheet. For example, to match a different brand:

```css
:root { --nbs-brand: #7c3aed; --nbs-brand-strong: #6d28d9; --nbs-brand-bg: #ede9fe; }
:root[data-theme='dark'] { --nbs-brand: #a78bfa; --nbs-brand-strong: #c4b5fd; --nbs-brand-bg: #2e1065; }
```

## Rules we followed

- **Colour is never the only signal.** Every state also has a word: a chip (*Offline*), a tag on the cell (*recovered*),
  an icon on the step.
- **Contrast is not yet audited.** The dark and light palettes follow JupyterLab's, but nobody has measured the tags and chips against WCAG. Do that before you publish widely.
- **Reduced motion.** With `prefers-reduced-motion: reduce` there are no animations and no autoplay; the story opens
  on its ending and the reader steps through.
- **Pausing freezes everything**, including the blinking cursor and highlights, not only the clock.

## Print

Not designed for yet. The windows are drawn by JavaScript and the steps-as-text are collapsed by default, so a printout
shows the story and its result but not the animation. If you need print, open the text version (`<details open>`) in a
print stylesheet.
