"""AI5 -- an AI agent rewrites a cell while a person is typing in it.

A person types at the end of cell 1 in a tab; at the same moment the agent, through the server, rewrites cell 1 as "fixed". Neither
edit has seen the other. The suggested answer is the one between two people who are online: the merge keeps both, one after the
other (see Z4). Other answers are possible (the agent waits, or the person decides), so the policy is pending.
"""
from ..harness import NodeClient, World, duplicates, first_sync, pump, settle, step, unb64

ID = "AI5"
TITLE = "An AI agent rewrites a cell while a person is typing in it"


async def run():
    w = World(); tab = NodeClient(name="tab")
    try:
        await w.open_room()
        h = await first_sync(w, tab)
        typed = await tab.call("append_text", index=1, text=" # check")      # the update is generated, not delivered yet
        step("tab: types ' # check' at the end of cell 1 (the update has not reached the server)")
        way = w.ai_rewrite_cell(1, "fixed")                                   # at the same moment, on the server's live copy
        step(f"AI agent: rewrites cell 1 as 'fixed' ({way})")
        for update in typed["out"]:                                           # now the tab's typing arrives
            w.room.add_message(h.cid, unb64(update))
        await settle(0.4)
        await pump(w, h, tab)
        disk = await w.quiesce()
        await pump(w, h, tab)
        srv = w.server_sources()
        return dict(
            verdict=dict(
                tab_cells=tab.cells, server_cells=len(srv), disk_cells=len(disk),
                agent_rewrite_kept=any("fixed" in s for s in srv),
                typing_kept=any("# check" in s for s in srv),
                both_in_one_cell="fixed" in srv[1] and "# check" in srv[1],
                tab_agrees_with_the_server=tab.sources == srv,
                duplicated=duplicates(srv),
            ),
            details=dict(way=way, server=srv, tab=tab.sources, file=disk),
        )
    finally:
        await tab.stop(); await w.close()
