"""AI8 -- an AI agent is still writing the file when the server reads it.

The agent rewrites the file directly while nobody has the notebook open. Before the write is finished, a person opens the notebook and
the server reads the file. A half-written file must never become the notebook (and must never be saved over the agent's work); the
server must wait and, once the file is complete, give the person the agent's finished work.
"""
import asyncio
import json

from ..harness import ENV, NodeClient, World, duplicates, handshake, step

ID = "AI8"
TITLE = "An AI agent is still writing the file when the server reads it"


async def _loaded_within(room, seconds: float) -> bool:
    try:
        await asyncio.wait_for(room.file_api.until_content_loaded, seconds)
        return True
    except asyncio.TimeoutError:
        return False


async def run():
    w = World(); tab = NodeClient(name="tab")
    try:
        nb = json.loads(w.path.read_text())
        nb["cells"][1]["source"] = "fixed"
        nb["cells"].append({"cell_type": "code", "execution_count": None, "id": "ai-3", "metadata": {}, "outputs": [], "source": "tests"})
        finished = json.dumps(nb)
        w.path.write_text(finished[: len(finished) // 2])
        step("AI agent: starts to rewrite the file; the write is not finished (half of it is there)")
        w.room = w.manager.create_room(w.room_id)            # a person opens the notebook: the server reads the file
        w.room.handshake_timeout = ENV.deadline
        read_half_written = await _loaded_within(w.room, 1.0)
        step(f"server: took the half-written file for a notebook: {read_half_written}")
        w.path.write_text(finished)
        step("AI agent: finishes writing the file")
        reads_finished = await _loaded_within(w.room, 5.0)
        step(f"server: reads the finished file: {reads_finished}")
        srv: list[str] = []
        tab_cells = None
        if reads_finished:
            await tab.boot()
            await handshake(w, tab)
            tab_cells = tab.cells
            await w.quiesce()
            srv = w.server_sources()
        disk = await w.disk_sources()
        return dict(
            verdict=dict(
                half_written_file_taken_for_a_notebook=read_half_written,
                finished_file_read=reads_finished,
                tab_cells=tab_cells, server_cells=len(srv) if reads_finished else None, disk_cells=len(disk),
                agents_work_in_the_file=len(disk) == 4 and disk[1] == "fixed" and "tests" in disk,
                agents_work_in_the_tab=bool(tab_cells) and tab.sources[1] == "fixed" and "tests" in tab.sources,
                duplicated=duplicates(srv),
            ),
            details=dict(server=srv, tab=tab.sources if tab_cells else None, file=disk),
        )
    finally:
        await tab.stop(); await w.close()
