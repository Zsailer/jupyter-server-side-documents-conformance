import asyncio
import json
import sys
import types
import unittest

from test_control import SERVER, stub_jupyter  # noqa: F401 - importing it puts the stand-ins for jupyter-server in place

import jcollab_control as control  # noqa: E402


class Client:
    def __init__(self):
        self._cleanup_delay = 60
        self.closed = None

    def close(self, code, reason):
        self.closed = (code, self._cleanup_delay)


class Room:
    def __init__(self, room_id, source, log):
        self.room_id = room_id
        self._document = types.SimpleNamespace(source=source)
        self._saving_document = None
        self.clients = {Client()}
        self.log = log

    def _save_to_disc(self):
        self.log.append(("save", self.room_id))
        return None


class WebsocketServer:
    def __init__(self, rooms, log):
        self.rooms = {r.room_id: r for r in rooms}
        self.log = log

    async def delete_room(self, room):
        self.log.append(("delete", room.room_id))
        self.rooms.pop(room.room_id)


class Loaders(dict):
    def __init__(self, log):
        super().__init__({"F1": types.SimpleNamespace(number_of_subscriptions=0)})
        self.log = log

    async def remove(self, file_id):
        self.log.append(("loader removed", file_id))


def serverapp_with(rooms, log):
    ids = types.SimpleNamespace(get_id=lambda path: "F1" if path == "a.ipynb" else None)
    ydoc = types.SimpleNamespace(
        ywebsocket_server=WebsocketServer(rooms, log),
        file_loaders=Loaders(log),
        _room_locks={r.room_id: asyncio.Lock() for r in rooms},
    )
    manager = types.SimpleNamespace(extension_apps={"jupyter_server_ydoc": [ydoc]})
    return types.SimpleNamespace(web_app=types.SimpleNamespace(settings={"file_id_manager": ids}), extension_manager=manager), ydoc


def handler(cls, serverapp, path=None):
    h = cls({}, {"path": path})
    h.serverapp = serverapp
    return h


class JcollabControlTest(unittest.TestCase):
    def test_it_says_what_it_can_do(self):
        h = control.CapabilitiesHandler({}, {})
        asyncio.run(h.get())
        self.assertEqual(h.out, {"backend": "jcollab", "capabilities": ["serverState", "releaseRoom"]})

    def test_the_room_of_a_path_is_found_by_its_file_id_and_only_its_own(self):
        log = []
        app, _ = serverapp_with([Room("json:notebook:F1", {}, log), Room("json:notebook:F2", {}, log)], log)
        self.assertEqual([r.room_id for r in control.rooms_for_path(app, "a.ipynb")], ["json:notebook:F1"])
        self.assertEqual(control.rooms_for_path(app, "unknown.ipynb"), [])

    def test_the_server_copy_is_its_cells_or_a_404(self):
        app, _ = serverapp_with([Room("json:notebook:F1", {"cells": [{"source": "x"}]}, [])], [])
        h = handler(control.RoomHandler, app, "a.ipynb")
        asyncio.run(h.get())
        self.assertEqual(h.out, {"cells": ["x"]})
        app, _ = serverapp_with([], [])
        with self.assertRaises(sys.modules["tornado"].web.HTTPError) as caught:
            asyncio.run(handler(control.RoomHandler, app, "a.ipynb").get())
        self.assertEqual(caught.exception.status, 404)

    def test_releasing_a_room_saves_it_lets_go_of_it_and_disconnects_its_clients(self):
        log = []
        other = Room("json:notebook:F2", {}, log)
        room = Room("json:notebook:F1", {}, log)
        client = next(iter(room.clients))
        app, ydoc = serverapp_with([room, other], log)
        h = handler(control.ReleaseRoomHandler, app, "a.ipynb")
        asyncio.run(h.post())
        self.assertEqual(log, [("save", "json:notebook:F1"), ("delete", "json:notebook:F1"), ("loader removed", "F1")])
        self.assertEqual(list(ydoc.ywebsocket_server.rooms), ["json:notebook:F2"])
        # closed with "going away", and told not to clean up a room that is already gone
        self.assertEqual(client.closed, (control.CLOSE_GOING_AWAY, None))
        # a path with no room is not an error: there is nothing to release
        h = handler(control.ReleaseRoomHandler, app, "a.ipynb")
        asyncio.run(h.post())
        self.assertEqual(h.out, {})


if __name__ == "__main__":
    unittest.main()
