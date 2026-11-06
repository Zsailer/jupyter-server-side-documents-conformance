"""The backend's side of the conformance control contract, for jupyter-server-documents.

!! Test-only. It lets any authenticated client destroy live document rooms: load it only through
server/conformance_config.py (CONFORMANCE_CONTROL=jsd_control), never in production.

The contract is in docs/backend-contract.md. Three endpoints, under the server's base URL:

    GET  /conformance/capabilities                what this backend can do for a test
    GET  /conformance/room?path=<path>            the cells of the server's live copy of a notebook; 404 if it holds none
    POST /conformance/release-room?path=<path>    the server saves the notebook and lets go of it; the next client to
                                                  connect makes it build the notebook again from the file

This file knows how jupyter-server-documents keeps its rooms (`yroom_manager`, `file_id_manager`), so it is the part
to update when that changes.
"""
import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

BACKEND = "jsd"
CAPABILITIES = ["serverState", "releaseRoom"]


def cells_of(source):
    """The sources of the cells of a notebook given as a JSON string or as a dict, one string per cell."""
    notebook = json.loads(source) if isinstance(source, str) else source
    cells = []
    for cell in notebook.get("cells", []):
        text = cell.get("source", "")
        cells.append("".join(text) if isinstance(text, list) else text)
    return cells


def rooms_for_path(settings, path):
    """The open document rooms of a file. Read-only: it never creates a room."""
    fid = settings["file_id_manager"].get_id(path)
    if fid is None:
        return []
    manager = settings["yroom_manager"]
    return [room for room in manager.list_document_rooms() if room.room_id.endswith(f":{fid}")]


class CapabilitiesHandler(APIHandler):
    @tornado.web.authenticated
    async def get(self):
        self.finish(json.dumps({"backend": BACKEND, "capabilities": CAPABILITIES}))


class RoomHandler(APIHandler):
    @tornado.web.authenticated
    async def get(self):
        path = self.get_argument("path")
        rooms = rooms_for_path(self.settings, path)
        if not rooms:
            raise tornado.web.HTTPError(404, f"No open room for path '{path}'.")
        ydoc = getattr(rooms[0], "_jupyter_ydoc", None)
        if ydoc is None:
            raise tornado.web.HTTPError(404, f"The room for '{path}' holds no notebook yet.")
        self.finish(json.dumps({"cells": cells_of(ydoc.source)}))


class ReleaseRoomHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        path = self.get_argument("path")
        manager = self.settings["yroom_manager"]
        for room in rooms_for_path(self.settings, path):
            # delete_room() stops the room (clients are closed with code 1001) and waits for the final save before it
            # removes the room, so the content is on disk and is read again when a client next connects
            await manager.delete_room(room.room_id)
        self.finish(json.dumps({}))


def _jupyter_server_extension_points():
    return [{"module": "jsd_control"}]


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
    server_app.log.info("jsd_control (conformance test extension) loaded")
