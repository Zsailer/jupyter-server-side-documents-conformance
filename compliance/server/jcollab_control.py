"""The backend's side of the conformance control contract, for jupyter-collaboration (jupyter-server-ydoc).

!! Test-only. It lets any authenticated client destroy live document rooms: load it only through
server/conformance_config.py (CONFORMANCE_CONTROL=jcollab_control), never in production.

The contract is in docs/backend-contract.md. Three endpoints, under the server's base URL:

    GET  /conformance/capabilities                what this backend can do for a test
    GET  /conformance/room?path=<path>            the cells of the server's live copy of a notebook; 404 if it holds none
    POST /conformance/release-room?path=<path>    the server saves the notebook and lets go of it; the next client to
                                                  connect makes it build the notebook again from the file

This file knows how jupyter-server-ydoc keeps its rooms (`YDocExtension.ywebsocket_server`, `file_id_manager`), so it is
the part to update when that changes. jupyter-server-nbmodel (server-side execution) keeps no documents of its own: it
works on these same rooms, so nothing here is specific to it.
"""
import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

BACKEND = "jcollab"
CAPABILITIES = ["serverState", "releaseRoom"]
CLOSE_GOING_AWAY = 1001


def cells_of(source):
    """The sources of the cells of a notebook given as a JSON string or as a dict, one string per cell."""
    notebook = json.loads(source) if isinstance(source, str) else source
    cells = []
    for cell in notebook.get("cells", []):
        text = cell.get("source", "")
        cells.append("".join(text) if isinstance(text, list) else text)
    return cells


def ydoc_extension(serverapp):
    apps = serverapp.extension_manager.extension_apps.get("jupyter_server_ydoc", set())
    for app in apps:
        return app
    raise tornado.web.HTTPError(503, "jupyter_server_ydoc is not loaded.")


def rooms_for_path(serverapp, path):
    """The open document rooms of a file. Read-only: it never creates a room."""
    fid = serverapp.web_app.settings["file_id_manager"].get_id(path)
    if fid is None:
        return []
    rooms = ydoc_extension(serverapp).ywebsocket_server.rooms
    return [room for name, room in list(rooms.items()) if name.endswith(f":{fid}") and hasattr(room, "_document")]


class CapabilitiesHandler(APIHandler):
    @tornado.web.authenticated
    async def get(self):
        self.finish(json.dumps({"backend": BACKEND, "capabilities": CAPABILITIES}))


class RoomHandler(APIHandler):
    @tornado.web.authenticated
    async def get(self):
        path = self.get_argument("path")
        rooms = rooms_for_path(self.serverapp, path)
        if not rooms:
            raise tornado.web.HTTPError(404, f"No open room for path '{path}'.")
        self.finish(json.dumps({"cells": cells_of(rooms[0]._document.source)}))


class ReleaseRoomHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        path = self.get_argument("path")
        app = ydoc_extension(self.serverapp)
        for room in rooms_for_path(self.serverapp, path):
            room_id = room.room_id
            async with app._room_locks[room_id]:
                if room_id not in app.ywebsocket_server.rooms:
                    continue
                # save first: the content must be on disk to be read again when a client next connects
                saving = room._save_to_disc() or room._saving_document
                if saving is not None:
                    await saving
                clients = list(room.clients)
                for client in clients:
                    # the handler would schedule its own clean-up of a room that is already gone
                    client._cleanup_delay = None
                await app.ywebsocket_server.delete_room(room=room)
                _, _, file_id = room_id.split(":", 2)
                loader = app.file_loaders[file_id]
                if loader.number_of_subscriptions == 0:
                    await app.file_loaders.remove(file_id)
                for client in clients:
                    client.close(CLOSE_GOING_AWAY, "The server released the document.")
        self.finish(json.dumps({}))


def _jupyter_server_extension_points():
    return [{"module": "jcollab_control"}]


def _load_jupyter_server_extension(server_app):
    web_app = server_app.web_app
    base_url = web_app.settings["base_url"]
    web_app.add_handlers(
        ".*$",
        [
            (url_path_join(base_url, "conformance", "capabilities"), CapabilitiesHandler),
            (url_path_join(base_url, "conformance", "room"), RoomHandler),
            (url_path_join(base_url, "conformance", "release-room"), ReleaseRoomHandler),
        ],
    )
    server_app.log.info("jcollab_control (conformance test extension) loaded")
