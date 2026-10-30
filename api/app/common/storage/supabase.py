"""Supabase Storage backend for uploaded files (ticket attachments, merchant
documents). Serverless hosts have no lasting disk — Vercel only offers /tmp,
which is wiped whenever an instance is recycled — so files must live in object
storage there.

Keys look like ``sb/<scope>/<yyyy>/<mm>/<uuid>-<name>`` and map to objects in
SUPABASE_STORAGE_BUCKET (a private bucket). The API talks to Storage's REST
API with the service-role key, so the bucket needs no policies and nothing is
publicly reachable; files are streamed to signed-in users through the API.
"""
from __future__ import annotations

import io
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

import httpx

from app.common.storage.port import FileStorage, FileStreamResult, PutFileInput, StoredFile
from app.config import get_settings

PREFIX = "sb/"
logger = logging.getLogger("SupabaseStorage")


def _sanitise(name: str) -> str:
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-.")
    return cleaned[:120]


def configured() -> bool:
    s = get_settings()
    return bool(s.SUPABASE_URL and s.SUPABASE_SERVICE_ROLE_KEY)


class SupabaseStorage(FileStorage):
    def __init__(self) -> None:
        s = get_settings()
        self.base = (s.SUPABASE_URL or "").rstrip("/") + "/storage/v1"
        self.bucket = s.SUPABASE_STORAGE_BUCKET
        key = s.SUPABASE_SERVICE_ROLE_KEY or ""
        # Legacy service_role keys are JWTs and go in both headers; the newer
        # sb_secret_… keys are only accepted in `apikey`.
        self.headers = {"apikey": key}
        if key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {key}"

    def is_managed(self, key: Optional[str]) -> bool:
        return isinstance(key, str) and key.startswith(PREFIX) and ".." not in key

    def _object_url(self, path: str, authenticated: bool = False) -> str:
        kind = "object/authenticated" if authenticated else "object"
        return f"{self.base}/{kind}/{quote(self.bucket)}/{quote(path)}"

    async def put(self, input: PutFileInput) -> StoredFile:
        now = datetime.now(timezone.utc)
        scope = _sanitise(input.scope or "_") or "_"
        name = _sanitise(input.original_name) or "file"
        path = f"{scope}/{now.year:04d}/{now.month:02d}/{uuid.uuid4()}-{name}"
        headers = {**self.headers, "Content-Type": input.mime_type or "application/octet-stream", "x-upsert": "false"}
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as http:
            res = await http.post(self._object_url(path), content=input.buffer, headers=headers)
        if res.status_code >= 300:
            raise RuntimeError(f"Supabase Storage upload failed ({res.status_code}): {res.text[:200]}")
        return StoredFile(key=PREFIX + path, size_bytes=len(input.buffer))

    async def open(self, key: str) -> Optional[FileStreamResult]:
        if not self.is_managed(key):
            return None
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as http:
            res = await http.get(self._object_url(key[len(PREFIX):], authenticated=True), headers=self.headers)
        if res.status_code == 404 or (res.status_code == 400 and "not_found" in res.text.lower().replace(" ", "_")):
            return None  # Storage reports a missing object as 400 "not_found" (or 404)
        if res.status_code >= 300:
            raise RuntimeError(f"Supabase Storage download failed ({res.status_code})")
        return FileStreamResult(stream=io.BytesIO(res.content), size_bytes=len(res.content), mime_type=res.headers.get("content-type"))

    async def delete(self, key: str) -> None:
        if not self.is_managed(key):
            return
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as http:
                res = await http.request(
                    "DELETE", f"{self.base}/object/{quote(self.bucket)}", json={"prefixes": [key[len(PREFIX):]]}, headers=self.headers
                )
            if res.status_code >= 300:
                logger.warning("Could not delete %s (%s)", key, res.status_code)
        except httpx.HTTPError as e:
            logger.warning("Could not delete %s: %s", key, e)
