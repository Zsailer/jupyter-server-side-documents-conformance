"""One readable line for what a scenario ended with ("3/3/3", "typing LOST", "move undone", ...).

This is only for the reports and the generated tables: whether a scenario ended well is decided by the clauses of
``suite.yaml``, never by this text. The wording is that of the exploration kit's catalogue
(``repro/issue-70-divergent-sync/catalogue.py``), so that numbers and words can be compared across the two.
"""
from __future__ import annotations

from typing import Any

#: scenarios that check ``stop()`` hygiene rather than the data-loss paths
STOP_ROWS = {"X1", "X2", "X4", "X5"}

_S_BITS = {
    "S1": [("online cell", "online_cell_kept"), ("online typing", "online_typing_kept"), ("offline typing", "offline_typing_kept")],
    "S2": [("online cell", "online_cell_kept"), ("typing", "online_typing_kept")],
    "S3": [("server-side edit", "server_side_edit_kept")],
    "S4": [("external edit", "external_edit_applied"), ("external cell", "external_cell_added"), ("offline typing", "offline_typing_kept")],
    "S5": [("offline typing", "offline_typing_kept")],
    "S6": [("save completed", "interrupted_save_completed_on_disk"), ("online cell", "online_cell_kept"), ("typing", "online_typing_kept")],
    "S7": [("offline typing", "offline_typing_kept")],
    "S8": [("external edit", "external_edit_applied"), ("external cell", "external_cell_added")],
}


#: the changes an AI agent makes in the stories where all of them must arrive
_AI_BITS = {
    "AI1": [("edit in the tab", "edit_seen_by_the_tab"), ("edit in the file", "edit_in_the_file")],
    "AI2": [("rewrite", "rewrite_seen_by_the_tab"), ("new cell", "new_cell_seen_by_the_tab"), ("changes in the file", "changes_in_the_file")],
    "AI3": [("first change", "first_change_kept"), ("second change", "second_change_kept")],
    "AI4": [("rewrite", "rewrite_kept"), ("second change", "second_change_kept"), ("third change", "third_change_kept")],
}


def _core(sid: str, v: dict) -> str:
    """The cells on client/server/disk, with the extras the first fifteen scenarios are read by."""
    g = v.get
    if sid == "F":
        return "loop alive" if g("room_message_loop_alive") else "ROOM FROZEN"
    if sid in ("H2", "H3", "K", "K2"):
        dup = g("duplicated_cells")
        s = f"{g('server_cells')} cells" + (f", DUP x{len(dup)}" if dup else "")
        if sid == "K":
            s += ", offline cell kept" if g("offline_cell_kept") else ", offline cell dropped"
        return s
    if sid == "E":
        return f"{g('client_cells_after_reconnect')}/{g('server_cells')}/{g('disk_cells')}"
    if sid == "C3":
        return f"{g('tab2_cells')}/{g('server_cells')}/{g('disk_cells')}, typing " + ("kept" if g("typing_reached_server") else "LOST")
    if sid == "C2":
        return f"{g('tab2_cells')}/{g('server_cells')}/{g('disk_cells')} (tab 1: {g('tab1_cells_after_broadcast')})"
    return f"{g('client_cells')}/{g('server_cells')}/{g('disk_cells')}"


def describe(sid: str, v: dict[str, Any] | None) -> str:
    """One readable line for a scenario's verdict (``n/a`` if it has none)."""
    if v is None:
        return "n/a"
    if v.get("notebook_wiped") or (v.get("server_cells") == 0 and sid not in STOP_ROWS | {"X3"}):
        return "**WIPED**"
    dup = " DUPLICATE" if v.get("duplicated") else ""
    if sid == "S6" and not v.get("lineage_continued"):
        return "n/a (no lineage)"
    if sid in _S_BITS:
        lost = [n for n, k in _S_BITS[sid] if not v.get(k)]
        return ("all kept" if not lost else "LOST " + ", ".join(lost)) + dup
    if sid == "S9":
        return f"{v['external_cell_copies']} copy of the new cell"
    if sid in ("S10", "S11"):
        return "checkpoint removed" if not v.get("store_files_after", v.get("checkpoint_files_after")) else "checkpoint left"
    if sid == "S12":
        return "not persisted" if not (v.get("token_announced_after_rebuild") or v.get("checkpoint_files")) else "persisted"
    if sid == "S13":
        return "ignored if newer, restored if older" if v else "n/a"
    if sid == "S14":
        return "restored without reconcile" if not v.get("spurious_reconcile") else "reconciles every restore"
    if sid == "T1":
        return f"tab {v['tab_cells']}/server {v['server_cells']}, " + ("repaired" if v["divergent"] else "merged")
    if sid == "H4":
        return f"{v['server_cells']} cells" + (", DUPLICATE" if v["duplicated"] else "") + (", B repaired" if v["tabB_divergent"] else "")
    if sid == "M1":
        return f"{v['server_cells']} cells, moved cell " + ("kept" if v["moved_cell_survives"] else "LOST")
    if sid == "M2":
        if v["moved_once_at_the_end"]:
            return "move kept"
        return "move undone" if v["copies_of_moved_cell"] == 1 else f"{v['copies_of_moved_cell']} copies of the moved cell"
    if sid == "Z1":
        return f"move {'kept' if v['move_kept'] else 'undone'}, typing {'kept' if v['typing_kept'] else 'LOST'}"
    if sid == "Z2":
        n = v["copies_of_the_moved_cell_in_the_document"]
        return "the moved cell once" if n == 1 else (
            f"the moved cell {n} times in the live notebook, {v['copies_of_the_moved_cell_on_disk']} in the file")
    if sid == "Z3":
        if v["typing_kept"]:
            return "typing kept" + (" in a recovered cell" if v["recovered_copy"] else "")
        return "cell deleted, typing LOST" if v["cell_deleted"] else "typing LOST"
    if sid == "Z4":
        return "both rewrites, one after the other" if v["both_rewrites_present"] else (
            "one of the two" if v["is_one_of_the_two"] else "?")
    if sid == "Z5":
        return f"external edit {'applied' if v['external_edit_applied'] else 'LOST'}, typing {'kept' if v['typing_kept'] else 'LOST'}"
    if sid == "Z6":
        return "typing kept" if v["typing_kept"] else "typing LOST"
    if sid == "Z7":
        if v["merged_into_its_cell"]:
            return "typing merged into its cell"
        return "typing kept as a recovered cell, not merged" if v["recovered_copy"] else ("typing kept" if v["typing_kept"] else "typing LOST")
    if sid == "N1":
        return "typing kept" if v["typing_kept"] else "typing LOST"
    if sid == "P1":
        return f"online cell {'kept' if v['online_cell_kept'] else 'LOST'}, typing {'kept' if v['typing_kept'] else 'LOST'}"
    if sid == "R1":
        return "stays deleted" if v["deleted_cell_stays_deleted"] else "COMES BACK"
    if sid == "Q1":
        return "cell kept" if v["cell_kept"] else "cell LOST"
    if sid == "W1":
        if v["both_in_one_cell"]:
            return "both kept, in one cell"
        if v["recovered_copy"] and v["a_typing_kept"]:
            return "A's typing kept as a 'recovered' cell"
        return "A's typing LOST" if not v["a_typing_kept"] else "kept"
    if sid in ("W2", "W3"):
        a, b = v["a_typing_kept"], v["b_typing_kept"]
        return "both kept" if a and b else ("B kept, A LOST" if b else ("A kept, B LOST" if a else "both LOST"))
    if sid in ("O1", "O2", "O3", "O4"):
        return "outputs " + str(v["outputs_per_cell_in_saved_file"])
    if sid in ("O5", "O6"):
        return f"doc {v['placeholders_in_rebuilt_doc']} / store {v['outputs_in_store_after_rebuild']}"
    if sid == "G2":
        return f"{v['client_cells']}/{v['server_cells']}/{v['disk_cells']}, typing {'kept' if v['offline_typing_kept'] else 'LOST'}"
    if sid == "G3":
        return f"tab {v['tab2_cells']}/server {v['server_cells']}, typing {'kept' if v['typing_reached_server'] else 'LOST'}"
    if sid == "X1":
        if v["edit_on_disk"]:
            return "edit applied and saved"
        return f"edit LOST, stop() raises {v['stop_raised']}" if v.get("stop_raised") else "edit LOST"
    if sid == "X2":
        if v["valid_edit_on_disk"] and not v["stop_raised"]:
            return "stop() completes, valid edit saved"
        return f"stop() raises {v['stop_raised']}" if v.get("stop_raised") else "FAILS"
    if sid == "X3":
        return "until_saved waits for the Task" if v["task_finished_before_until_saved"] else "until_saved resolves early"
    if sid == "X4":
        if v.get("stop_raised"):
            return f"stop() raises {v['stop_raised']}"
        return "update dropped (client had left)" if not v["edit_in_doc"] else "update applied"
    if sid == "X5":
        return "drained edit in rebuilt room" if v["edit_in_rebuilt_room"] else "edit LOST"
    if sid in _AI_BITS:
        lost = [n for n, k in _AI_BITS[sid] if not v.get(k)]
        return ("all kept" if not lost else "LOST " + ", ".join(lost)) + dup
    if sid == "AI5":
        if v["agent_rewrite_kept"] and v["typing_kept"]:
            return "both kept" + (" in one cell" if v["both_in_one_cell"] else "")
        return "the typing LOST" if v["agent_rewrite_kept"] else "the agent's rewrite LOST"
    if sid == "AI6":
        if v["typing_kept"]:
            return "typing kept" + (" in a recovered cell" if v["recovered_copy"] else "")
        return "cell deleted, typing LOST" if v["cell_deleted"] else "typing LOST"
    if sid == "AI7":
        return "the agent's edit survived" if v["edit_survived"] else "the agent's edit LOST"
    if sid == "AI8":
        if v["half_written_file_taken_for_a_notebook"]:
            return "the half-written file became the notebook"
        return "the finished file is read" if v["finished_file_read"] else "the finished file is never read"
    if sid == "AI9":
        return f"agent's change {'applied' if v['agent_change_applied'] else 'LOST'}, typing {'kept' if v['typing_kept'] else 'LOST'}"
    try:
        return _core(sid, v)
    except Exception as e:  # a verdict this reader does not know: show it, do not hide it
        return f"? {e}"
