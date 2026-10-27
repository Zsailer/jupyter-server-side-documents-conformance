"""AI1 -- an AI agent (such as Claude Code) edits a notebook that is open: it edits the server's live copy.

A person has the notebook open in a tab, so the server holds it. The agent does not touch the file: it changes the server's live
copy, the tab sees the change as it happens, and the file follows with the autosave.
"""
from ..harness import NodeClient, World, duplicates, first_sync, pump, step

ID = "AI1"
TITLE = "An AI agent edits a notebook that is open"


async def run():
    w = World(); tab = NodeClient(name="tab")
    try:
        await w.open_room()
        h = await first_sync(w, tab)
        way = w.ai_rewrite_cell(1, "fixed")
        step(f"AI agent: rewrites cell 1 as 'fixed' (the server holds the notebook, so: {way})")
        await pump(w, h, tab)                        # the tab receives it live
        step(f"tab sees cell 1 as: {tab.sources[1]!r}")
        disk = await w.quiesce()
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=tab.cells, server_cells=len(srv), disk_cells=len(disk),
                edit_on_server=srv[1] == "fixed",
                edit_seen_by_the_tab=tab.sources[1] == "fixed",
                edit_in_the_file=disk[1] == "fixed",
                duplicated=duplicates(srv),
            ),
            details=dict(way=way, server=srv, tab=tab.sources, file=disk),
        )
    finally:
        await tab.stop(); await w.close()
