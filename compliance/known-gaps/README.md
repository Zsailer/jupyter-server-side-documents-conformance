# Known gaps

One file per adapter (`<adapter>.json`), listing the accepted stories that backend is known not to meet yet:

```json
{ "offline/second-tab-adds-cell": "an offline add is lost when the server rebuilds the notebook (jupyter-server-documents#102)" }
```

A story is listed by its name (`group/what-happens`) or by a name it had before: both find it.

A listed story still runs, and is expected to fail (Playwright's `test.fail`). That keeps a run green while the gap is
open, and turns red the day the story starts passing, as a reminder to delete the entry.

This is a fact about a backend. Whether a case is agreed is the story's own `status`.
