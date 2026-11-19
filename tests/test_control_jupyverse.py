import asyncio
import contextlib
import json
import os
import sys
import tempfile
import types
import unittest

from test_control import SERVER  # noqa: F401 - importing it puts compliance/server on the path


def stub_jupyverse():
    """jupyverse, fps, fastapi and anyio are not installed where these tests run: stand in for the little of them that is used."""
    modules = {}

    def module(name, **attrs):
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        modules[name] = mod
        return mod

    @contextlib.contextmanager
    def fail_after(_seconds):
        yield

    class Base:
        def __init__(self, *args, **kwargs):
            pass

        def include_router(self, router, **kwargs):
            pass

    class APIRouter:
        def get(self, path):
            return lambda f: f

        post = get

    module("anyio", fail_after=fail_after, sleep=asyncio.sleep)
    module("fastapi", APIRouter=APIRouter, HTTPException=type("HTTPException", (Exception,), {}))
    module("fps", Module=Base)
    module("fps.cli")
    module("fps.cli._cli", main=types.SimpleNamespace(callback=lambda *a, **k: None))
    module("jupyverse_api", App=Base, Router=Base)
    module("jupyverse_api.cli", get_pluggin_config=lambda disable: {"jupyverse": {"modules": {}}})
    module("jupyverse_lab", PageConfig=Base)
    module("jupyverse_yjs", Yjs=Base)
    sys.modules.update(modules)


stub_jupyverse()

import jupyverse_control as control  # noqa: E402


class Socket:
    def __init__(self, log):
        self.log = log

    async def close(self, code, reason):
        self.log.append(("close", code))


class Client:
    def __init__(self, room, log):
        self._websocket = Socket(log)
        self.room = room


class Room:
    def __init__(self, room_id, yjs, source, log, with_client=False):
        self.id = room_id
        self.jupyter_ydoc = types.SimpleNamespace(get=lambda: source, dirty=True, aget=self._aget)
        self._source = source
        self._write_to_file_cancel_scope = None
        self._close_room_cancel_scope = None
        self._id_of_file = "F1"
        self._file_format, self._file_type = "json", "notebook"
        self._jupyter_ydoc = self.jupyter_ydoc
        self.log = log
        self.yjs = yjs
        self.clients = {Client(self, log)} if with_client else set()
        self._contents = types.SimpleNamespace(read_content=self._read, write_content=self._write)
        self._close_event = types.SimpleNamespace(set=self._closed)

    async def _aget(self):
        return self._source

    async def _get_file_path(self, _id):
        return "a.ipynb"

    async def _read(self, *args, **kwargs):
        return types.SimpleNamespace(content={"stale": True})

    async def _write(self, content):
        self.log.append(("save", content["path"]))

    def _closed(self):
        self.log.append(("closed", self.id))
        self.yjs.yrooms._rooms.pop(self.id, None)


def yjs_with(specs, log):
    """specs: (room id, source, has a client) for each room."""
    yjs = types.SimpleNamespace()
    ids = {"a.ipynb": "F1"}

    async def get_id(path):
        return ids.get(path)

    yjs.file_id = types.SimpleNamespace(get_id=get_id)
    yjs.yrooms = types.SimpleNamespace(_rooms={})
    for room_id, source, with_client in specs:
        yjs.yrooms._rooms[room_id] = Room(room_id, yjs, source, log, with_client)
    return yjs


async def call(middleware, scope, body=b""):
    sent = []
    seen = {}

    async def app(scope, receive, send):
        seen["scope"] = scope
        seen["body"] = (await receive())["body"]
        await send({"type": "http.response.start", "status": 200, "headers": []})

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        sent.append(message)

    await middleware(app)(scope, receive, send)
    return seen, sent


class JupyverseControlTest(unittest.TestCase):
    def test_the_cells_of_a_notebook_whether_given_as_text_or_as_an_object(self):
        notebook = {"cells": [{"source": "x"}, {"source": ["a", "b"]}]}
        self.assertEqual(control.cells_of(notebook), ["x", "ab"])
        self.assertEqual(control.cells_of(json.dumps(notebook)), ["x", "ab"])

    def test_the_room_of_a_path_is_found_by_its_file_id_and_only_its_own(self):
        yjs = yjs_with([("json:notebook:F1", {}, False), ("json:notebook:F2", {}, False)], [])
        self.assertEqual([r.id for r in asyncio.run(control.rooms_for_path(yjs, "a.ipynb"))], ["json:notebook:F1"])
        self.assertEqual(asyncio.run(control.rooms_for_path(yjs, "unknown.ipynb")), [])

    def test_releasing_a_room_saves_it_disconnects_its_clients_and_lets_go_of_it(self):
        log = []
        yjs = yjs_with([("json:notebook:F1", {"cells": []}, True), ("json:notebook:F2", {}, False)], log)
        room = yjs.yrooms._rooms["json:notebook:F1"]

        async def release():
            task = asyncio.ensure_future(control.release(yjs, room))
            await asyncio.sleep(0.1)
            room.clients.clear()  # the room notices that its clients are gone
            await task

        asyncio.run(release())
        self.assertEqual(log, [("save", "a.ipynb"), ("close", control.CLOSE_GOING_AWAY), ("closed", "json:notebook:F1")])
        self.assertEqual(list(yjs.yrooms._rooms), ["json:notebook:F2"])

    def test_the_page_is_not_offered_zero_copy_sending(self):
        seen, _ = asyncio.run(
            call(control.NoPathsend, {"type": "http", "extensions": {"http.response.pathsend": {}, "tls": {}}})
        )
        self.assertEqual(seen["scope"]["extensions"], {"tls": {}})

    def test_a_save_of_the_contents_api_gets_the_path_of_its_url(self):
        scope = {"type": "http", "method": "PUT", "path": "/api/contents/d/a.ipynb", "headers": [(b"content-length", b"2")]}
        seen, _ = asyncio.run(call(control.PathInBody, scope, b'{"type": "file", "format": "text"}'))
        self.assertEqual(json.loads(seen["body"])["path"], "d/a.ipynb")
        dict_headers = dict(seen["scope"]["headers"])
        self.assertEqual(int(dict_headers[b"content-length"]), len(seen["body"]))
        # other requests pass through untouched
        scope = {"type": "http", "method": "GET", "path": "/api/contents/d", "headers": []}
        seen, _ = asyncio.run(call(control.PathInBody, scope, b"x"))
        self.assertEqual(seen["body"], b"x")

    def test_a_save_of_a_directory_makes_a_directory(self):
        scope = {"type": "http", "method": "PUT", "path": "/api/contents/d/sub", "headers": []}
        before = os.getcwd()
        with tempfile.TemporaryDirectory() as root:
            os.chdir(root)
            try:
                seen, sent = asyncio.run(call(control.PathInBody, scope, b'{"type": "directory", "format": "json"}'))
                self.assertTrue(os.path.isdir(os.path.join(root, "d", "sub")))
            finally:
                os.chdir(before)
        self.assertEqual(seen, {})  # jupyverse never saw it: it would have made a file
        self.assertEqual(sent[0]["status"], 201)
        self.assertEqual(json.loads(sent[1]["body"])["type"], "directory")


if __name__ == "__main__":
    unittest.main()
