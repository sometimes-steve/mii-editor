"""Isolated OCW NEX client. Requests arrive on stdin; credentials stay on disk/in memory."""
import base64
import contextlib
import json
import logging
import sys

import anyio
from anynet import http, websocket
from nintendo.nex import authentication, backend, datastore_smm2 as datastore, prudp, settings

HOST = "server.opencourse.world"


def validate_config(config):
    if not isinstance(config, dict) or config.get("domain") != HOST or not isinstance(config.get("token"), str) or len(config["token"]) != 22 or any(ord(c) <= 32 or ord(c) == 127 for c in config["token"]):
        raise ValueError("Use a valid OCW config for server.opencourse.world.")
    return config


@contextlib.asynccontextmanager
async def connection(config):
    original_request = http.HTTPClient.request
    original_transport = prudp.connect_transport_socket
    original_key = websocket.secrets.token_urlsafe

    async def request(client, req, **kwargs):
        if req.headers.get("Upgrade", "").lower() == "websocket":
            req.headers.pop("Sec-WebSocket-Protocol", None)
            req.headers["NEX"] = config["token"]
            req.headers["Mod-Version"] = "0.2"
            req.headers["Game-Version"] = "3.0.3"
        return await original_request(client, req, **kwargs)

    def transport(options, host, port, context):
        # Auth and secure NEX channels both stay on the one configured OCW host.
        return websocket.connect(f"wss://{HOST}:443/", context, protocols=["NEX"], disconnect_timeout=0)

    http.HTTPClient.request = request
    prudp.connect_transport_socket = transport
    # OCW's console mod sends this literal WebSocket key; the server routes that
    # handshake differently from a standard NEX WebSocket handshake.
    websocket.secrets.token_urlsafe = lambda *args, **kwargs: "NEX"
    options = settings.load("switch")
    options.configure("fdf6617f", 40605, 60)
    auth = authentication.AuthenticationInfo()
    auth.token = ""
    auth.ngs_version = 4
    auth.token_type = 2
    try:
        async with backend.connect(options, HOST, 443) as be:
            async with be.login(str(0xCAFE), auth_info=auth) as client:
                yield client
    finally:
        http.HTTPClient.request = original_request
        prudp.connect_transport_socket = original_transport
        websocket.secrets.token_urlsafe = original_key


async def main(request):
    if request.get("action") not in {"inspect", "upload"}:
        raise ValueError("Unsupported OCW operation.")
    config = validate_config(request.get("config"))
    expected_code = request.get("expected_maker_code", "").replace("-", "").upper()
    if not expected_code:
        raise ValueError("Choose an OCW config and its maker code in the editor.")
    if request.get("maker_code", "").replace("-", "").upper() != expected_code:
        raise ValueError("Upload is restricted to the maker configured for this local OCW account.")
    with anyio.fail_after(25):
        async with connection(config) as client:
            store = datastore.DataStoreClientSMM2(client)
            param = datastore.GetUsersParam()
            target_pid = int(request["pid"])
            param.pids = [target_pid]
            param.option = 0x7FF
            response = await store.get_users(param)
            users = response.users
            if len(users) != 1 or users[0].pid != target_pid:
                raise ValueError("OCW did not return the selected maker profile.")
            user = users[0]
            if user.code != request["maker_code"].replace("-", "").upper():
                raise ValueError("The OCW profile does not match the selected maker code.")
            if request["action"] == "inspect":
                return {"connected": True, "maker_code":user.code, "pid":str(user.pid), "name":user.name,
                        "mii_data":base64.b64encode(user.unk2).decode(), "country":user.country, "region":user.region,
                        "clothes":vars(user.unk1), "flags":[user.unk3,user.unk4,user.unk5]}
            data = base64.b64decode(request["mii_data"], validate=True)
            if len(data) != 88:
                raise ValueError("Expected 88-byte Switch CharInfo.")
            sync = datastore.SyncUserProfileParam()
            sync.username = user.name
            sync.unk1 = user.unk1
            sync.unk2 = data
            sync.unk3 = user.region
            sync.country = user.country
            sync.unk4 = user.unk3
            sync.unk5 = user.unk4
            sync.unk_guid = "4c415265-636f-6d70-0100-000000000001"
            sync.unk6 = 0
            result = await store.sync_user_profile(sync)
            # OCW echoes the shared Nintendo account ID (0xCAFE), rather than
            # its public maker PID. The Node caller verifies actual storage by REST readback.
            if result.pid not in {target_pid, 0xCAFE} or result.unk2 != data:
                raise ValueError("OCW did not acknowledge the submitted Mii. Check public readback before retrying.")
            return {"submitted": True, "pid":str(result.pid), "mii_data":base64.b64encode(result.unk2).decode()}


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    request = {}
    try:
        request = json.loads(sys.stdin.read(16384))
        print(json.dumps(anyio.run(main, request)))
    except Exception as error:
        # Never emit exception groups, tracebacks or transport objects containing credentials.
        def leaves(exc):
            if isinstance(exc, BaseExceptionGroup):
                return [item for child in exc.exceptions for item in leaves(child)]
            return [f"{type(exc).__name__}: {exc}"]
        message = "; ".join(leaves(error))
        try:
            secret = request.get("config", {}).get("token")
            if isinstance(secret, str) and secret:
                message = message.replace(secret, "[redacted]")
        except Exception:
            pass
        print(json.dumps({"error": message[:500]}))
        sys.exit(1)
