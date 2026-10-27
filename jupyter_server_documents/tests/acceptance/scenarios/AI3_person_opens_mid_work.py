"""AI3 -- a person opens the notebook in the middle of an AI agent's work.

The agent starts while nobody has the notebook open, so it edits the file. Then a person opens the notebook and the server holds it,
so the agent's next edit goes through the server. Both changes must arrive, once each.
"""
from ..harness import NodeClient, World, duplicates, handshake, pump, step

ID = "AI3"
TITLE = "A person opens the notebook in the middle of an AI agent's work"


async def run():
    w = World(); tab = NodeClient(name="tab")
    try:
        first = w.ai_rewrite_cell(1, "fixed")
        step(f"AI agent: rewrites cell 1 as 'fixed' (the server does not hold the notebook, so: {first})")
        await w.open_room()                          # a person opens the notebook: built from the file, with the first change
        await tab.boot()
        h = await handshake(w, tab)
        step(f"tab sees: {tab.sources}")
        second = w.ai_add_cell("tests")
        step(f"AI agent: adds a cell 'tests' (the server holds the notebook now, so: {second})")
        await pump(w, h, tab)
        disk = await w.quiesce()
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=tab.cells, server_cells=len(srv), disk_cells=len(disk),
                first_change_kept=srv[1] == "fixed",
                second_change_kept="tests" in srv,
                both_seen_by_the_tab=tab.sources[1] == "fixed" and "tests" in tab.sources,
                both_in_the_file=disk[1] == "fixed" and "tests" in disk,
                duplicated=duplicates(srv),
            ),
            details=dict(ways=[first, second], server=srv, tab=tab.sources, file=disk),
        )
    finally:
        await tab.stop(); await w.close()
