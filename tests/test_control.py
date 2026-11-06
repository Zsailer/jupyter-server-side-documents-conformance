import asyncio
import json
import sys
import types
import unittest
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "compliance" / "server"


def stub_jupyter():
    """jupyter-server and tornado are not installed where these tests run: stand in for the little of them that is used."""
    tornado = types.ModuleType("tornado")
    web = types.ModuleType("tornado.web")

    class HTTPError(Exception):
        def __init__(self, status, message=""):
            super().__init__(message)
            self.status = status

    web.HTTPError = HTTPError
    web.authenticated = lambda f: f
    tornado.web = web

    base = types.ModuleType("jupyter_server.base.handlers")

    class APIHandler:
        def __init__(self, settings, args):
            self.settings = settings
            self.args = args
            self.out = None

        def get_argument(self, name):
            return self.args[name]

        def finish(self, body):
            self.out = json.loads(body)

    base.APIHandler = APIHandler
    utils = types.ModuleType("jupyter_server.utils")
    utils.url_path_join = lambda *parts: "/".join(p.strip("/") for p in parts)
    for name, mod in {
        "tornado": tornado,
        "tornado.web": web,
        "jupyter_server": types.ModuleType("jupyter_server"),
        "jupyter_server.base": types.ModuleType("jupyter_server.base"),
        "jupyter_server.base.handlers": base,
        "jupyter_server.utils": utils,
    }.items():
        sys.modules[name] = mod


stub_jupyter()
sys.path.insert(0, str(SERVER))
import jsd_control as control  # noqa: E402


class Room:
    def __init__(self, room_id, source):
        self.room_id = room_id
        self._jupyter_ydoc = types.SimpleNamespace(source=source) if source is not None else None


class Manager:
    def __init__(self, rooms):
        self.rooms = rooms
        self.deleted = []

    def list_document_rooms(self):
        return self.rooms

    async def delete_room(self, room_id):
        self.deleted.append(room_id)


def settings_with(rooms):
    ids = types.SimpleNamespace(get_id=lambda path: "F1" if path == "a.ipynb" else None)
    return {"file_id_manager": ids, "yroom_manager": Manager(rooms)}


class ControlTest(unittest.TestCase):
    def test_the_cells_of_a_notebook_are_their_sources_as_text(self):
        notebook = {"cells": [{"source": "c0"}, {"source": ["line 1\n", "line 2"]}, {}]}
        self.assertEqual(control.cells_of(notebook), ["c0", "line 1\nline 2", ""])
        self.assertEqual(control.cells_of(json.dumps(notebook)), ["c0", "line 1\nline 2", ""])

    def test_it_says_what_it_can_do(self):
        h = control.CapabilitiesHandler({}, {})
        asyncio.run(h.get())
        self.assertEqual(h.out, {"backend": "jsd", "capabilities": ["serverState", "releaseRoom"]})

    def test_the_room_of_a_path_is_found_by_its_file_id_and_only_its_own(self):
        rooms = [Room("json:notebook:F1", None), Room("json:notebook:F2", None)]
        found = control.rooms_for_path(settings_with(rooms), "a.ipynb")
        self.assertEqual([r.room_id for r in found], ["json:notebook:F1"])
        self.assertEqual(control.rooms_for_path(settings_with(rooms), "unknown.ipynb"), [])

    def test_the_server_copy_is_its_cells_or_a_404(self):
        h = control.RoomHandler(settings_with([Room("json:notebook:F1", {"cells": [{"source": "x"}]})]), {"path": "a.ipynb"})
        asyncio.run(h.get())
        self.assertEqual(h.out, {"cells": ["x"]})
        for rooms, path in (([], "a.ipynb"), ([Room("json:notebook:F1", None)], "a.ipynb")):
            h = control.RoomHandler(settings_with(rooms), {"path": path})
            with self.assertRaises(sys.modules["tornado"].web.HTTPError) as caught:
                asyncio.run(h.get())
            self.assertEqual(caught.exception.status, 404)

    def test_releasing_a_room_deletes_that_room_and_nothing_else(self):
        s = settings_with([Room("json:notebook:F1", None), Room("json:notebook:F2", None)])
        h = control.ReleaseRoomHandler(s, {"path": "a.ipynb"})
        asyncio.run(h.post())
        self.assertEqual(s["yroom_manager"].deleted, ["json:notebook:F1"])
        # a path with no room is not an error: there is nothing to release
        h = control.ReleaseRoomHandler(settings_with([]), {"path": "a.ipynb"})
        asyncio.run(h.post())
        self.assertEqual(h.out, {})


if __name__ == "__main__":
    unittest.main()
