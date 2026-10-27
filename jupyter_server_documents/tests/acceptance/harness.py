"""Building blocks of the acceptance scenarios.

This is the harness of ``repro/issue-70-divergent-sync`` (the exploration kit, which runs the same scenarios
against many versions of the code), adapted to run inside pytest against THIS checkout: the server classes
are imported from the checkout, the client code is read from its ``src/docprovider``, and the configuration
(``ENV``) is filled in by the fixtures of ``conftest.py`` instead of by a command line.

What is real and what is fake
-----------------------------
REAL   YRoomManager / YNotebookRoom / YRoomFileAPI of this checkout: the SS1/SS2 handshake, the wait for
       the client's SyncStep2, client removal, the message queue, autosave and ``save()``. Notebooks are
       really written to a temp dir through jupyter_server's AsyncFileContentsManager + the file-id manager.
REAL   The browser-side sync logic (see ``node_client.mjs``), extracted from the TypeScript source of
       ``src/docprovider/yprovider.ts`` of this checkout and run on real Yjs, with a real y-websocket
       provider and a real ``@jupyter/ydoc`` YNotebook. A "tab" is one such Node process.
FAKE   * the ServerApp (no port is bound): a minimal stand-in supplies the contents manager, file-id manager
         and an event logger;
       * the WebSocket transport: ``FakeWS`` records what the server writes and the scenario decides which
         client->server messages are delivered, withheld or delivered late;
       * the passing of time: "the room is freed" is ``YRoomManager.delete_room`` followed by
         ``create_room``, which is what the periodic ``_auto_free_rooms`` task does once a room is empty and
         inactive; the server's wait for a SyncStep2 reply is shortened to ``ENV.deadline`` (the
         ``YRoom.handshake_timeout`` trait), so the scenarios that sit it out take seconds.
"""
from __future__ import annotations

import asyncio
import base64
import inspect
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

from traitlets.config import Config, LoggingConfigurable
from jupyter_server.services.contents.filemanager import AsyncFileContentsManager
from jupyter_server_fileid.manager import ArbitraryFileIdManager
from jupyter_server_documents.rooms.yroom import YRoom
from jupyter_server_documents.rooms.yroom_manager import YRoomManager
from jupyter_server_documents.websockets import YjsClientGroup

HERE = Path(__file__).resolve().parent

# --------------------------------------------------------------------------
# configuration (filled in by the fixtures of conftest.py)
# --------------------------------------------------------------------------
ENV = SimpleNamespace(
    node="node",          # the node binary
    client_ts=None,       # the client's yprovider.ts under test
    healing_ts=None,      # its healing.ts, when the tree has the client-side healing
    proto=1,              # what the client announces in ?proto= (2 = the lineage handshake)
    node_modules=None,    # directory holding yjs, y-websocket, @jupyter/ydoc, ...
    node_client=HERE / "node_client.mjs",
    tmp_root=None,        # where scratch notebooks live
    trace=False,          # narrate every step
    scale=1.0,            # multiplies the short "let the server settle" sleeps
    deadline=2.0,         # the server's wait for a SyncStep2 reply (YRoom.handshake_timeout), in seconds
    keep=False,           # keep scratch dirs
    server_config={},     # traitlets config for the server under test, e.g. {"LineageStore": {"enabled": False}}
    lose_store=False,     # the checkpoint store is lost whenever a room is rebuilt (what a lost or wiped disk does)
    steps=[],             # narration collected for the current scenario
)


def step(msg: str) -> None:
    """Record (and, with --trace, print) one line of the scenario's timeline."""
    ENV.steps.append(msg)
    if ENV.trace:
        print(f"    - {msg}", flush=True)


async def settle(seconds: float) -> None:
    """Short pause that lets the in-process server finish handling messages."""
    await asyncio.sleep(seconds * ENV.scale)


async def let_server_deadline_pass() -> None:
    """Sit out the server's SyncStep2 deadline (real time, never scaled down)."""
    step(f"... waiting past the server's {ENV.deadline:g} s SyncStep2 deadline ...")
    await asyncio.sleep(ENV.deadline + 0.6)


# --------------------------------------------------------------------------
# capture the server's own log lines (the strings the plan says to search for)
# --------------------------------------------------------------------------
SERVER_LOG: list[str] = []


class _Capture(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        SERVER_LOG.append(f"{record.levelname:<7} {record.getMessage()}")


_logger = logging.getLogger("jsd.acceptance")
_logger.setLevel(logging.INFO)
_logger.addHandler(_Capture())
_logger.propagate = False


def log_mark() -> int:
    return len(SERVER_LOG)


def log_since(mark: int, *needles: str) -> list[str]:
    lines = SERVER_LOG[mark:]
    return [l for l in lines if not needles or any(n in l for n in needles)]


# --------------------------------------------------------------------------
# server fakes
# --------------------------------------------------------------------------
class FakeEventLogger:
    def emit(self, **_kw):  # room events are irrelevant here
        pass


class FakeApp(LoggingConfigurable):
    outputs_manager = None  # same as the repo's conftest.MockServerDocsApp

    def __init__(self, *a, serverapp, **kw):
        super().__init__(*a, **kw)
        self.serverapp = serverapp
        self._log = None

    @property
    def log(self):
        return self.serverapp.log


class FakeWS:
    """Stands in for the tornado WebSocketHandler the room writes to."""

    def __init__(self):
        self.to_client: list[bytes] = []
        self.closed = False
        self.close_code = None
        self.ws_connection = True
        # What the real handler reads from `?proto=` (yroom_ws.py). Clients of the lineage
        # generation announce 2; everything older does not announce anything (= 1).
        self.jsd_proto = ENV.proto

    def write_message(self, message, binary=True):
        self.to_client.append(bytes(message))

    def close(self, code=None, reason=None):
        self.closed = True
        self.close_code = code
        self.ws_connection = None


def add_client(room, ws, allow_write: bool = True):
    """`allow_write` (read-only clients) exists only in the Apple fork."""
    if "allow_write" in inspect.signature(room.clients.add).parameters:
        return room.clients.add(ws, allow_write=allow_write)
    if not allow_write:
        raise NotImplementedError("read-only clients are not supported by this server tree")
    return room.clients.add(ws)


def supports_read_only() -> bool:
    return "allow_write" in inspect.signature(YjsClientGroup.add).parameters


class World:
    """One notebook on disk + a real YRoomManager serving it.

    The notebook has three code cells, ids cell-0..2, source ``print(i)  # original cell i``.
    """

    def __init__(self, n_cells: int = 3):
        self.tmp = Path(tempfile.mkdtemp(prefix="jsd70-", dir=ENV.tmp_root))
        # Persisted lineage: one store per world, outside the notebook directory
        self.lineage_dir = self.tmp / "lineage"
        self.path = self.tmp / "nb.ipynb"
        cells = [
            {
                "cell_type": "code",
                "execution_count": None,
                "id": f"cell-{i}",
                "metadata": {},
                "outputs": [],
                "source": f"print({i})  # original cell {i}",
            }
            for i in range(n_cells)
        ]
        self.path.write_text(
            json.dumps({"cells": cells, "metadata": {}, "nbformat": 4, "nbformat_minor": 5})
        )
        self.fid = ArbitraryFileIdManager(
            root_dir=str(self.tmp), db_path=str(self.tmp / "fid.db"), config=Config()
        )
        self.cm = AsyncFileContentsManager(root_dir=str(self.tmp))
        serverapp = SimpleNamespace(
            web_app=SimpleNamespace(settings={"file_id_manager": self.fid}),
            contents_manager=self.cm,
            event_logger=FakeEventLogger(),
            log=_logger,
        )
        # LineageStore reads its directory from config. Server trees without persisted lineages ignore it.
        config = Config({"LineageStore": {"directory": str(self.lineage_dir)}})
        config.merge(Config(ENV.server_config))
        self.app = FakeApp(serverapp=serverapp, config=config)
        self.manager = YRoomManager(parent=self.app)
        self.room_id = f"json:notebook:{self.fid.index(str(self.path))}"
        self.room: YRoom | None = None

    async def open_room(self) -> YRoom:
        if ENV.lose_store and getattr(self, "_opened_once", False):
            self.drop_lineage()      # a room that is rebuilt finds no checkpoint
        self._opened_once = True
        self.room = self.manager.create_room(self.room_id)
        self.room.handshake_timeout = ENV.deadline   # the production default is 5 s
        await self.room.file_api.until_content_loaded
        step(f"server: room created from disk ({self.server_cells()} cells, server clientID {self.server_client_id()})")
        return self.room

    async def recreate_room(self) -> YRoom:
        """What auto-free + the next websocket connect does in production."""
        step("server: room is freed (empty + inactive) and saved to disk ...")
        assert await self.manager.delete_room(self.room_id)
        room = await self.open_room()
        step("server: ... and a NEW room is built from the file under a fresh Yjs clientID")
        return room

    # -- helpers for the persisted-lineage scenarios: store, crashes, external edits, server-side edits ---
    def lineage_id(self) -> str | None:
        return getattr(self.room.file_api, "lineage_id", None) if self.room and self.room.file_api else None

    def lineage_files(self) -> list[str]:
        return sorted(p.name for p in self.lineage_dir.glob("*")) if self.lineage_dir.exists() else []

    def drop_lineage(self) -> None:
        """The checkpoint store is lost (ephemeral disk, deleted, unreadable)."""
        shutil.rmtree(self.lineage_dir, ignore_errors=True)

    def snapshot_state(self) -> dict:
        """Remember the file and the lineage store as they are now (to emulate a crash later)."""
        st = self.path.stat()
        return dict(
            file=self.path.read_text(),
            times=(st.st_atime_ns, st.st_mtime_ns),
            lineage={p.name: p.read_bytes() for p in self.lineage_dir.glob("*")} if self.lineage_dir.exists() else {},
        )

    def restore_state(self, snap: dict) -> None:
        """Put the file and the lineage store back: the process died before anything newer was written.

        The file's mtime is restored too: it is the identity the checkpoint is paired with (`last_modified`),
        so a crash must find the old file with its old mtime, not a file that looks edited out of band.
        """
        self.path.write_text(snap["file"])
        os.utime(self.path, ns=snap["times"])
        shutil.rmtree(self.lineage_dir, ignore_errors=True)
        self.lineage_dir.mkdir(parents=True, exist_ok=True)
        for name, data in snap["lineage"].items():
            (self.lineage_dir / name).write_bytes(data)

    def external_edit(self, mutate) -> None:
        """Edit the notebook file outside the server (git, another editor): mutate(cells) -> cells."""
        nb = json.loads(self.path.read_text())
        nb["cells"] = mutate(nb["cells"])
        self.path.write_text(json.dumps(nb))

    def server_edit(self, fn) -> None:
        """Edit the room's document directly, on the server (kernel output, an agent, a REST call)."""
        fn(self.room._jupyter_ydoc)

    # -- an AI agent (such as Claude Code) editing the notebook --------------------------------------------
    def server_holds_notebook(self) -> bool:
        """Whether the server holds the notebook: a room exists, from the first client (or consumer) until the room is freed."""
        return self.manager.has_room(self.room_id)

    def ai_edit(self, live, file) -> str:
        """What an AI agent does to change the notebook: edit the server's live copy while the server holds the notebook,
        and the file when it does not.

        ``live(jupyter_ydoc)`` is the edit on the live copy, ``file(cells) -> cells`` the same edit on the cells of the file.
        Returns the way taken, "live" or "file". The choice is the agent's, made at the moment of each edit: it is what lets a
        story switch from one way to the other when a person opens the notebook or leaves it.
        """
        if self.server_holds_notebook():
            self.server_edit(live)
            return "live"
        self.external_edit(file)
        return "file"

    def ai_rewrite_cell(self, index: int, source: str) -> str:
        """The agent replaces the text of a cell. On the live copy it does so in place (the cell stays the same cell)."""
        def live(ydoc):
            text = ydoc.ycells[index]["source"]
            text.clear()
            text += source

        def file(cells):
            cells[index]["source"] = source
            return cells
        return self.ai_edit(live, file)

    def ai_add_cell(self, source: str) -> str:
        """The agent adds a cell at the end."""
        def live(ydoc):
            ydoc.append_cell({"cell_type": "code", "source": source})

        def file(cells):
            new = {"cell_type": "code", "execution_count": None, "id": f"ai-{len(cells)}", "metadata": {}, "outputs": [], "source": source}
            return cells + [new]
        return self.ai_edit(live, file)

    def ai_delete_cell(self, index: int) -> str:
        """The agent deletes a cell."""
        def live(ydoc):
            del ydoc.ycells[index]

        def file(cells):
            return cells[:index] + cells[index + 1:]
        return self.ai_edit(live, file)

    # -- observations --------------------------------------------------------
    def server_cells(self) -> int:
        return len(self.room._jupyter_ydoc.source["cells"])

    def server_sources(self) -> list[str]:
        return [c["source"] for c in self.room._jupyter_ydoc.source["cells"]]

    def server_raw(self) -> list[tuple[str, str]]:
        """(id, source) of every live cell item, WITHOUT jupyter_ydoc's read-time de-duplication."""
        return [(str(c.get("id")), str(c.get("source"))) for c in self.room._jupyter_ydoc.ycells]

    def server_sv(self) -> dict[str, int]:
        sv = YRoom._decode_state_vector(self.room._ydoc.get_state())
        return {str(k): v for k, v in sv.items()}

    def server_client_id(self) -> str:
        return str(self.room._ydoc.client_id)

    async def disk_sources(self) -> list[str]:
        # jupyter_server rewrites the notebook in place, so a read can land on a
        # partial file. Retry WITHOUT blocking the loop the server saves on.
        for _ in range(80):
            try:
                cells = json.loads(self.path.read_text())["cells"]
                return ["".join(c["source"]) if isinstance(c["source"], list) else c["source"] for c in cells]
            except (json.JSONDecodeError, FileNotFoundError):
                await asyncio.sleep(0.1)
        raise RuntimeError("notebook on disk stayed unreadable")

    async def disk_cells(self) -> int:
        return len(await self.disk_sources())

    async def quiesce(self, timeout: float = 8.0) -> list[str]:
        """Let in-flight messages apply, then wait for autosave to catch up.

        Autosave is asynchronous (poll interval ~0.5 s). Returns the file's cell
        sources once they equal the server document's (or after `timeout`).
        """
        await settle(0.8)
        deadline = time.monotonic() + timeout
        while True:
            disk = await self.disk_sources()
            if disk == self.server_sources() or time.monotonic() > deadline:
                step(f"autosave settled: the saved file has {len(disk)} cells, the server document has {self.server_cells()}")
                return disk
            await asyncio.sleep(0.25)

    async def close(self):
        try:
            for r in list(self.manager.get_rooms()):
                if not r.stopped:
                    r.stop(immediately=True)
        except Exception:
            pass
        self.manager._auto_free_rooms_task.cancel()
        if not ENV.keep:
            shutil.rmtree(self.tmp, ignore_errors=True)


# --------------------------------------------------------------------------
# the browser tab (Node process running the real client logic)
# --------------------------------------------------------------------------
class NodeClient:
    def __init__(self, document_id: bool = True, name: str = "client"):
        self.document_id = document_id
        self.name = name
        self._n = 0
        self.last: dict = {}

    async def start(self):
        args = [ENV.node, str(ENV.node_client), str(ENV.client_ts)]
        if not self.document_id:
            args.append("--no-document-id")
        env = dict(os.environ, JSD_ACCEPTANCE_NODE_MODULES=str(ENV.node_modules))
        env["JSD_ACCEPTANCE_HEALING"] = str(ENV.healing_ts) if ENV.healing_ts else ""
        self._stderr_path = Path(ENV.tmp_root) / f"node-stderr-{self.name.replace(' ', '_')}.log"
        with open(self._stderr_path, "ab") as stderr:
            self.proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=stderr,
                env=env,
            )

    async def call(self, op: str, **kw) -> dict:
        self._n += 1
        try:
            self.proc.stdin.write((json.dumps({"id": self._n, "op": op, **kw}) + "\n").encode())
            await self.proc.stdin.drain()
            line = await self.proc.stdout.readline()
            if not line:
                raise ConnectionResetError("node client exited")
        except ConnectionResetError as e:
            tail = self._stderr_path.read_text()[-1500:]
            raise RuntimeError(f"node client died during {op!r}: {e}\n--- node stderr ---\n{tail}")
        resp = json.loads(line)
        if resp["error"]:
            raise RuntimeError(resp["error"])
        self.last = resp
        return resp

    async def boot(self):
        """Start the process and read its (empty) initial state."""
        await self.start()
        await self.call("state")
        return self

    @property
    def cells(self) -> int:
        return self.last["state"]["cells"]

    @property
    def sources(self) -> list[str]:
        return self.last["state"]["sources"]

    @property
    def client_id(self) -> str:
        return self.last["state"]["clientID"]

    @property
    def sv(self) -> dict:
        return self.last["state"]["sv"]

    async def stop(self):
        if not hasattr(self, "proc"):
            return
        try:
            self.proc.stdin.close()
            await asyncio.wait_for(self.proc.wait(), 5)
        except Exception:
            self.proc.kill()


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def unb64(s: str) -> bytes:
    return base64.b64decode(s)


def kind(msg: bytes) -> str:
    """Name a y-protocols message: SS1, SS2, Update or awareness."""
    if msg[0] == 1:
        return "awareness"
    if msg[0] == 100:
        return "lineage"
    return {0: "SS1", 1: "SS2", 2: "Update"}.get(msg[1], f"sync?{msg[1]}")


# --------------------------------------------------------------------------
# connections
# --------------------------------------------------------------------------
class Handshake:
    """The record of one websocket connection and its SS1/SS2 handshake."""

    def __init__(self, name: str):
        self.name = name
        self.divergent: bool | None = None   # the variant's own gate (see node_client.mjs)
        self.trace: list[dict] = []
        self.delivered: list[str] = []
        self.dropped: list[str] = []
        self.dropped_msgs: list[bytes] = []
        self.ws: FakeWS | None = None
        self.cid: str | None = None


async def handshake(
    world: World,
    node: NodeClient,
    *,
    drop: tuple[str, ...] = (),
    allow_write: bool = True,
    wait_after: float = 0.4,
) -> Handshake:
    """One websocket connection: client SS1 -> real YRoom -> client -> client replies.

    `drop` lists client->server message kinds that never reach the server:
    "SS2" = the handshake reply, "Update" = a SyncUpdate (e.g. the document_id write).
    Dropped messages are kept in ``h.dropped_msgs`` so a scenario can deliver them late.
    """
    room = world.room
    h = Handshake(node.name)
    r = await node.call("connect")
    ss1 = [unb64(m) for m in r["out"]]
    assert [kind(m) for m in ss1] == ["SS1"], [kind(m) for m in ss1]
    step(f"{node.name}: opens a websocket and sends SS1 (client state vector {node.sv})")

    h.ws = FakeWS()
    h.cid = add_client(room, h.ws, allow_write=allow_write)
    room.add_message(h.cid, ss1[0])
    await settle(0.3)  # let the room run handle_sync_step1

    server_kinds = [kind(m) for m in h.ws.to_client]
    outgoing: list[bytes] = []
    for msg in h.ws.to_client:
        r = await node.call("recv", b64=b64(msg))
        h.trace += r["trace"]
        outgoing += [unb64(m) for m in r["out"]]
    h.ws.to_client.clear()
    h.divergent = h.trace[-1]["divergent"] if h.trace else None
    step(f"server -> {node.name}: {server_kinds}")
    if h.trace:
        t = h.trace[-1]
        step(
            f"{node.name}: divergence gate says divergent={t['divergent']}; client state vector {t['clientSV']} "
            f"vs server state vector {t['serverSV']}"
        )
        step(f"{node.name}: after applying the server state the client holds {node.cells} cells")

    for msg in outgoing:
        k = kind(msg)
        if k in drop:
            h.dropped.append(k)
            h.dropped_msgs.append(msg)
            step(f"{node.name} -> server: {k}  ** WITHHELD (not delivered to the server) **")
            continue
        h.delivered.append(k)
        step(f"{node.name} -> server: {k}  delivered")
        room.add_message(h.cid, msg)
    await settle(wait_after)
    return h


async def drop_connection(world: World, node: NodeClient, h: Handshake) -> None:
    """The socket goes away: y-websocket sees the close, tornado's on_close removes the client."""
    await node.call("disconnect")
    world.room.clients.remove(h.cid)
    step(f"{node.name}: connection closed (client + server side)")


async def pump(world: World, h: Handshake, node: NodeClient) -> int:
    """Deliver what the room queued for this connection to its client; send any replies back."""
    msgs = list(h.ws.to_client)
    h.ws.to_client.clear()
    outs = []
    for m in msgs:
        r = await node.call("recv", b64=b64(m))
        outs += [unb64(x) for x in r["out"]]
    for o in outs:
        world.room.add_message(h.cid, o)
    await settle(0.15)
    return len(msgs)


async def client_edit(world: World, h: Handshake, node: NodeClient, op: str, **kw) -> None:
    """The client edits locally; the resulting Update goes to the server on its open connection."""
    r = await node.call(op, **kw)
    for o in r["out"]:
        world.room.add_message(h.cid, unb64(o))
    await settle(0.25)


def duplicates(sources: list[str]) -> list[str]:
    return sorted({s for s in sources if sources.count(s) > 1})


async def first_sync(world: World, node: NodeClient) -> Handshake:
    """A brand-new browser tab opens the notebook and completes its first handshake."""
    await node.boot()
    h = await handshake(world, node)
    assert h.divergent is False, "a fresh client must not be divergent"
    assert node.cells == world.server_cells() == 3, (node.cells, world.server_cells())
    return h
