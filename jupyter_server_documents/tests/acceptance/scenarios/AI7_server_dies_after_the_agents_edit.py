"""AI7 -- the server dies after an AI agent's edit, before the next autosave, and no tab holds the edit.

Nobody has the notebook open, but the server still holds it, so the agent edits the live copy. The server dies before it saved. When it
starts again the agent's edit is either in the file or gone. The suggested answer is that it survives, because an agent's edits are few
and could be saved before the agent is told that they worked; an edit that a person types is not (see Z6). The policy is pending.
"""
from ..harness import NodeClient, World, drop_connection, duplicates, first_sync, handshake, step

ID = "AI7"
TITLE = "The server dies after an AI agent's edit, before the next autosave"


async def run():
    w = World(); tab = NodeClient(name="tab"); later = NodeClient(name="tab (opened later)")
    try:
        await w.open_room()
        before = w.snapshot_state()                  # the file as it is: nothing newer is saved
        h = await first_sync(w, tab)
        await drop_connection(w, tab, h)             # the person closes the tab; the server still holds the notebook
        way = w.ai_rewrite_cell(1, "fixed")
        step(f"AI agent: rewrites cell 1 as 'fixed' (nobody is connected, but the server holds the notebook: {way})")
        assert await w.manager.delete_room(w.room_id)
        w.restore_state(before)
        step("server: the process died before the autosave: the file is as it was")
        await w.open_room()
        await later.boot()
        await handshake(w, later)
        disk = await w.quiesce()
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=later.cells, server_cells=len(srv), disk_cells=len(disk),
                edit_survived=any(s == "fixed" for s in srv),
                duplicated=duplicates(srv),
            ),
            details=dict(way=way, server=srv, tab=later.sources, file=disk),
        )
    finally:
        await tab.stop(); await later.stop(); await w.close()
