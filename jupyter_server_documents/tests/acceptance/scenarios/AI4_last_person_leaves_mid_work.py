"""AI4 -- the last person leaves in the middle of an AI agent's work.

The agent edits the live copy while a person has the notebook open. The person closes the tab, but the server keeps holding the
notebook for a while, so the agent's next edit still goes through the server. Later the server lets go of the notebook (and saves
it), and the agent's last edit goes to the file. When a person opens the notebook again, all three changes are there, once each.
"""
from ..harness import NodeClient, World, drop_connection, duplicates, first_sync, handshake, pump, step

ID = "AI4"
TITLE = "The last person leaves in the middle of an AI agent's work"


async def run():
    w = World(); tab = NodeClient(name="tab"); again = NodeClient(name="tab (opened again)")
    try:
        await w.open_room()
        h = await first_sync(w, tab)
        first = w.ai_rewrite_cell(1, "fixed")
        step(f"AI agent: rewrites cell 1 as 'fixed' ({first})")
        await pump(w, h, tab)
        await drop_connection(w, tab, h)             # the person closes the tab; the room is still there
        second = w.ai_add_cell("tests")
        step(f"AI agent: adds a cell 'tests' (nobody is connected, but the server still holds the notebook: {second})")
        assert await w.manager.delete_room(w.room_id)    # the server lets go of the notebook, saving it
        step("server: lets go of the notebook, saving it")
        third = w.ai_add_cell("docs")
        step(f"AI agent: adds a cell 'docs' (the server does not hold the notebook any more, so: {third})")
        await w.open_room()                          # a person opens the notebook again
        await again.boot()
        await handshake(w, again)
        step(f"tab sees: {again.sources}")
        disk = await w.quiesce()
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=again.cells, server_cells=len(srv), disk_cells=len(disk),
                rewrite_kept=srv[1] == "fixed",
                second_change_kept="tests" in srv,
                third_change_kept="docs" in srv,
                all_seen_by_the_tab=again.sources[1] == "fixed" and "tests" in again.sources and "docs" in again.sources,
                duplicated=duplicates(srv),
            ),
            details=dict(ways=[first, second, third], server=srv, tab=again.sources, file=disk),
        )
    finally:
        await tab.stop(); await again.stop(); await w.close()
