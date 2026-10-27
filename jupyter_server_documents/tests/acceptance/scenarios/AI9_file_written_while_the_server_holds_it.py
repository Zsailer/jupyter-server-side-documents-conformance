"""AI9 -- an AI agent writes the file although the server still holds the notebook (it took the notebook for closed).

A person types and closes the tab a moment later. The server still holds the notebook, with typing it has not saved yet. The agent
edits the file directly. The server must notice the change before it saves and keep both: the agent's change and the person's last
typing, which nobody else holds any more (the same question as Z5, with the tab gone).
"""
from ..harness import NodeClient, World, client_edit, drop_connection, duplicates, first_sync, handshake, step

ID = "AI9"
TITLE = "An AI agent writes the file although the server still holds the notebook"


async def run():
    w = World(); tab = NodeClient(name="tab"); later = NodeClient(name="tab (opened later)")
    try:
        await w.open_room()
        h = await first_sync(w, tab)
        lock = w.room.file_api._content_lock
        async with lock:                                     # the file watcher waits here, so that the order of events is exact
            await client_edit(w, h, tab, "append_text", index=0, text=" +TYPED")
            step("tab: types ' +TYPED' at the end of cell 0 (the server has not saved it yet)")
            await drop_connection(w, tab, h)
            step("the person closes the tab; the server still holds the notebook and the typing")
            w.external_edit(lambda cells: [dict(c, source="fixed") if i == 2 else c for i, c in enumerate(cells)])
            step("AI agent: takes the notebook for closed and edits the FILE: cell 2 becomes 'fixed'")
        disk = await w.quiesce()
        await later.boot()
        await handshake(w, later)
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=later.cells, server_cells=len(srv), disk_cells=len(disk),
                agent_change_applied=srv[2] == "fixed",
                typing_kept=any("+TYPED" in s for s in srv),
                agent_change_in_the_file=disk[2] == "fixed",
                typing_in_the_file=any("+TYPED" in s for s in disk),
                duplicated=duplicates(srv),
            ),
            details=dict(server=srv, tab=later.sources, file=disk),
        )
    finally:
        await tab.stop(); await later.stop(); await w.close()
