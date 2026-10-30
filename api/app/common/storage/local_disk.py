"""Port of local-disk.storage.ts. Same key layout and path-traversal guards."""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.common.storage.port import FileStorage, FileStreamResult, PutFileInput, StoredFile
from app.config import get_settings

PREFIX = "local/"
logger = logging.getLogger("LocalDiskStorage")


def _sanitise(name: str) -> str:
    base = Path(name).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", base)
    cleaned = cleaned.strip("-.")
    return cleaned[:120]


class LocalDiskStorage(FileStorage):
    def __init__(self) -> None:
        settings = get_settings()
        self.root = Path(settings.STORAGE_DIR).resolve()

    def is_managed(self, key: Optional[str]) -> bool:
        return isinstance(key, str) and key.startswith(PREFIX)

    def _resolve(self, key: str) -> Optional[Path]:
        rel = key[len(PREFIX):]
        abs_path = (self.root / rel).resolve()
        try:
            abs_path.relative_to(self.root)
        except ValueError:
            return None
        return abs_path

    async def put(self, input: PutFileInput) -> StoredFile:
        now = datetime.now(timezone.utc)
        yyyy = f"{now.year:04d}"
        mm = f"{now.month:02d}"
        scope = _sanitise(input.scope or "_") or "_"
        name = _sanitise(input.original_name) or "file"
        key = f"{PREFIX}{scope}/{yyyy}/{mm}/{uuid.uuid4()}-{name}"

        abs_path = self._resolve(key)
        if abs_path is None:
            raise RuntimeError(f"Generated storage key resolved outside the root: {key}")
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(input.buffer)
        return StoredFile(key=key, size_bytes=len(input.buffer))

    async def open(self, key: str) -> Optional[FileStreamResult]:
        if not self.is_managed(key):
            return None
        abs_path = self._resolve(key)
        if abs_path is None or not abs_path.exists():
            return None
        size = abs_path.stat().st_size
        return FileStreamResult(stream=open(abs_path, "rb"), size_bytes=size, mime_type=None)

    async def delete(self, key: str) -> None:
        if not self.is_managed(key):
            return
        abs_path = self._resolve(key)
        if abs_path is None:
            return
        try:
            abs_path.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("Could not delete %s: %s", key, e)


class RoutingStorage(FileStorage):
    """New files go to Supabase Storage when it is configured (SUPABASE_URL +
    SUPABASE_SERVICE_ROLE_KEY), else to local disk. Reads and deletes follow
    each key's own prefix, so files stored either way keep working."""

    def __init__(self) -> None:
        from app.common.storage import supabase

        self.local = LocalDiskStorage()
        self.remote = supabase.SupabaseStorage() if supabase.configured() else None

    def _for(self, key: Optional[str]) -> Optional[FileStorage]:
        if self.remote and self.remote.is_managed(key):
            return self.remote
        if self.local.is_managed(key):
            return self.local
        return None

    def is_managed(self, key: Optional[str]) -> bool:
        return self._for(key) is not None

    async def put(self, input: PutFileInput) -> StoredFile:
        return await (self.remote or self.local).put(input)

    async def open(self, key: str) -> Optional[FileStreamResult]:
        backend = self._for(key)
        return await backend.open(key) if backend else None

    async def delete(self, key: str) -> None:
        backend = self._for(key)
        if backend:
            await backend.delete(key)


_storage_singleton: Optional[RoutingStorage] = None


def get_storage() -> RoutingStorage:
    global _storage_singleton
    if _storage_singleton is None:
        _storage_singleton = RoutingStorage()
    return _storage_singleton
