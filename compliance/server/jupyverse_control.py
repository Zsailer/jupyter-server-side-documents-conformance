"""Start jupyverse for the conformance tests, with the backend's side of the conformance control contract.

!! Test-only. It lets any client destroy live document rooms and it gives the page access to JupyterLab's JavaScript
objects through the global `window`. Never run jupyverse like this in production.

Run it with the Python of the environment that has jupyverse, in the folder the tests work in:

    python jupyverse_control.py --port 8899

It does what `jupyverse --port 8899 --set frontend.collaborative=true` does (in an environment with the `noauth` and
`collaboration` extras of jupyverse, see environments/jupyverse), plus one extra
jupyverse module (`ControlModule`, below) that

- exposes the app in the page as `window.jupyterapp`, which the tests drive (it is what Galata expects of a server);
- serves the control contract (docs/backend-contract.md), three endpoints under the server's base URL:

    GET  /conformance/capabilities                what this backend can do for a test
    GET  /conformance/room?path=<path>            the cells of the server's live copy of a notebook; 404 if it holds none
    POST /conformance/release-room?path=<path>    the server saves the notebook and lets go of it; the next client to
                                                  connect makes it build the notebook again from the file

The module is added by this launcher, not installed: jupyverse only loads modules it finds as entry points of installed
packages, and the suite does not install anything into the environment it is pointed at.

This file knows how jupyverse keeps its rooms (`Yjs.yrooms`, `YRoom`, `FileId`), so it is the part to update when that
changes. jupyverse has no server-side execution that keeps documents of its own.
"""
import argparse
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from anyio import fail_after, sleep
from fastapi import APIRouter, HTTPException
from fps import Module
from fps.cli._cli import main as fps_main
from jupyverse_api import App, Router
from jupyverse_api.cli import get_pluggin_config
from jupyverse_lab import PageConfig
from jupyverse_yjs import Yjs

BACKEND = "jupyverse"
CAPABILITIES = ["serverState", "releaseRoom"]
CLOSE_GOING_AWAY = 1001
MODULE = "jupyverse_control"


def cells_of(source):
    """The sources of the cells of a notebook given as a JSON string or as a dict, one string per cell."""
    notebook = json.loads(source) if isinstance(source, str) else source
    cells = []
    for cell in notebook.get("cells", []):
        text = cell.get("source", "")
        cells.append("".join(text) if isinstance(text, list) else text)
    return cells


async def rooms_for_path(yjs, path):
    """The open document rooms of a file. Read-only: it never creates a room."""
    fid = await yjs.file_id.get_id(path)
    if fid is None:
        return []
    return [room for name, room in list(yjs.yrooms._rooms.items()) if name.endswith(f":{fid}")]


async def save(room):
    """Write the room's notebook to its file now, as the room does after its save delay."""
    if room._write_to_file_cancel_scope is not None:
        room._write_to_file_cancel_scope.cancel()
        room._write_to_file_cancel_scope = None
    file_path = await room._get_file_path(room._id_of_file)
    model = await room._contents.read_content(file_path, True, room._file_format, untrust=False)
    source = await room._jupyter_ydoc.aget()
    if model.content != source:
        await room._contents.write_content(
            {"content": source, "format": room._file_format, "path": file_path, "type": room._file_type}
        )
        room._jupyter_ydoc.dirty = False


async def release(yjs, room):
    # save first: the content must be on disk to be read again when a client next connects
    await save(room)
    clients = list(room.clients)
    for client in clients:
        try:
            await client._websocket.close(CLOSE_GOING_AWAY, "The server released the document.")
        except Exception:
            pass  # already gone
    with fail_after(10):
        while room.clients:
            await sleep(0.05)
    # the room would close after its clean-up delay; it closes now
    if room._close_room_cancel_scope is not None:
        room._close_room_cancel_scope.cancel()
    room._close_event.set()
    with fail_after(10):
        while yjs.yrooms._rooms.get(room.id) is room:
            await sleep(0.05)


class Control(Router):
    def __init__(self, app, yjs):
        super().__init__(app=app)
        router = APIRouter()

        @router.get("/conformance/capabilities")
        async def capabilities():
            return {"backend": BACKEND, "capabilities": CAPABILITIES}

        @router.get("/conformance/room")
        async def room(path: str):
            rooms = await rooms_for_path(yjs, path)
            if not rooms:
                raise HTTPException(404, f"No open room for path '{path}'.")
            return {"cells": cells_of(rooms[0].jupyter_ydoc.get())}

        @router.post("/conformance/release-room")
        async def release_room(path: str):
            for room in await rooms_for_path(yjs, path):
                await release(yjs, room)
            return {}

        self.include_router(router)


class NoPathsend:
    """Do not let a response be sent with the server's zero-copy `pathsend`.

    anycorn (the server under jupyverse) then fails to send a file that does not fit in the socket buffer at once, as the
    JavaScript of JupyterLab does: "File descriptor N is used by transport", and the page never finishes loading. Without
    the extension, Starlette sends a file as an ordinary stream.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            extensions = dict(scope.get("extensions") or {})
            extensions.pop("http.response.pathsend", None)
            extensions.pop("http.response.zerocopysend", None)
            scope = {**scope, "extensions": extensions}
        await self.app(scope, receive, send)


class PathInBody:
    """Make saves of the Contents API work as Galata makes them, which jupyverse does not accept as they are.

    - `PUT /api/contents/<path>` with a body that has no `path` is a validation error in jupyverse, which wants the path in
      the body as well as in the URL. It is copied from the URL.
    - `PUT` with `"type": "directory"` is how Galata makes the folder a story works in. Jupyverse writes the body to a
      *file* of that name instead (it makes folders with `POST`). The folder is made here.

    Neither has to do with what the stories are about: they only let the tests set themselves up.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        prefix = "/api/contents/"
        if scope["type"] == "http" and scope["method"] == "PUT" and scope["path"].startswith(prefix):
            body = b""
            while True:
                message = await receive()
                body += message.get("body", b"")
                if not message.get("more_body"):
                    break
            path = scope["path"][len(prefix):]
            try:
                content = json.loads(body or b"{}")
                if isinstance(content, dict):
                    if content.get("type") == "directory":
                        return await self.make_directory(path, send)
                    if "path" not in content:
                        content["path"] = path
                        body = json.dumps(content).encode()
            except ValueError:
                pass
            sent = False

            async def replay():
                nonlocal sent
                if sent:
                    return await receive()
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}

            headers = [(k, v) for k, v in scope["headers"] if k != b"content-length"]
            headers.append((b"content-length", str(len(body)).encode()))
            scope = {**scope, "headers": headers}
            return await self.app(scope, replay, send)
        await self.app(scope, receive, send)

    @staticmethod
    async def make_directory(path, send):
        folder = Path(path)
        folder.mkdir(parents=True, exist_ok=True)
        created = datetime.fromtimestamp(folder.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")
        model = {
            "name": folder.name,
            "path": path,
            "type": "directory",
            "format": None,
            "content": None,
            "mimetype": None,
            "size": None,
            "writable": True,
            "created": created,
            "last_modified": created,
        }
        payload = json.dumps(model).encode()
        await send({"type": "http.response.start", "status": 201, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
        await send({"type": "http.response.body", "body": payload})


class ControlModule(Module):
    async def prepare(self):
        app = await self.get(App)
        page_config = await self.get(PageConfig)
        yjs = await self.get(Yjs)

        async def expose(config):
            config["exposeAppInBrowser"] = True

        page_config.register(expose)
        app._app.add_middleware(NoPathsend)
        app._app.add_middleware(PathInBody)
        self.put(Control(app, yjs))
        self.done()


def link_galata_extension():
    """Make the page helpers of Galata, which the tests need (`window.galata`), a JupyterLab extension jupyverse serves.

    Jupyter Server is told where to find it (`LabServerApp.extra_labextensions_path`). Jupyverse only looks in the
    `share/jupyter/labextensions` of its own environment, so the extension that ships in the `jupyterlab` package is linked
    there.
    """
    import jupyterlab

    source = Path(jupyterlab.__file__).parent / "galata" / "@jupyterlab" / "galata-extension"
    target = Path(sys.prefix) / "share" / "jupyter" / "labextensions" / "@jupyterlab" / "galata-extension"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source, target_is_directory=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    link_galata_extension()
    config = get_pluggin_config(())
    config["jupyverse"]["modules"][MODULE] = {"type": f"{MODULE}:ControlModule"}
    settings = [
        "debug=False",
        "open_browser=False",
        f"host={args.host}",
        f"port={args.port}",
        "websocket_permessage_deflate=False",
        "allow_origins=[]",
        "query_params={}",
        "frontend.collaborative=true",
    ]
    fps_main.callback(
        "",
        set_=settings,
        config=io.StringIO(json.dumps(config)),
        show_config=False,
        help_all=False,
        backend="asyncio",
        timeout=None,
        stop_timeout=1,
    )


if __name__ == "__main__":
    main()
