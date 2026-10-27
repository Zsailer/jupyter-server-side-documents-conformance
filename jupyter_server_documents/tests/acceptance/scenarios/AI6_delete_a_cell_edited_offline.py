"""AI6 -- an AI agent deletes a cell that a person edited while offline (Z3 with an agent as the one who deletes).

A person's tab loses its connection and they type into cell 1. Meanwhile the agent, through the server, deletes cell 1. Then the tab
reconnects. The suggested answer is that of Z3: the deletion wins, as it does between two people. Whether the answer should change
when the one who deleted is an agent is the open question, so the policy is pending.
"""
from ..harness import NodeClient, World, drop_connection, duplicates, first_sync, handshake, step

ID = "AI6"
TITLE = "An AI agent deletes a cell that a person edited while offline"


async def run():
    w = World(); tab = NodeClient(name="tab")
    try:
        await w.open_room()
        h = await first_sync(w, tab)
        await drop_connection(w, tab, h)
        await tab.call("append_text", index=1, text=" +B-TYPED")
        step("tab (offline): types ' +B-TYPED' at the end of cell 1")
        way = w.ai_delete_cell(1)
        step(f"AI agent: deletes cell 1 (the server still holds the notebook, so: {way})")
        await handshake(w, tab)
        disk = await w.quiesce()
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=tab.cells, server_cells=len(srv), disk_cells=len(disk),
                cell_deleted=not any("original cell 1" in s for s in srv),
                typing_kept=any("+B-TYPED" in s for s in srv),
                recovered_copy=any(s.lstrip().startswith("# recovered") for s in srv),
                duplicated=duplicates(srv),
            ),
            details=dict(way=way, server=srv, tab=tab.sources, file=disk),
        )
    finally:
        await tab.stop(); await w.close()
