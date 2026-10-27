"""AI2 -- an AI agent edits a notebook that nobody has open: it edits the file.

No tab has the notebook and the server does not hold it, so the agent changes the file directly: it rewrites a cell and adds one.
The next person who opens the notebook finds the agent's work.
"""
from ..harness import NodeClient, World, duplicates, handshake, step

ID = "AI2"
TITLE = "An AI agent edits a notebook that nobody has open"


async def run():
    w = World(); tab = NodeClient(name="tab")
    try:
        ways = [w.ai_rewrite_cell(1, "fixed"), w.ai_add_cell("tests")]
        step(f"AI agent: rewrites cell 1 as 'fixed' and adds a cell 'tests' (the server does not hold the notebook, so: {ways})")
        await w.open_room()                          # later, a person opens the notebook: built from the file
        await tab.boot()
        await handshake(w, tab)
        step(f"tab sees: {tab.sources}")
        disk = await w.quiesce()
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=tab.cells, server_cells=len(srv), disk_cells=len(disk),
                rewrite_seen_by_the_tab=tab.sources[1] == "fixed",
                new_cell_seen_by_the_tab="tests" in tab.sources,
                changes_in_the_file=disk[1] == "fixed" and "tests" in disk,
                duplicated=duplicates(srv),
            ),
            details=dict(ways=ways, server=srv, tab=tab.sources, file=disk),
        )
    finally:
        await tab.stop(); await w.close()
