"""Port of local-disk.storage.spec.ts."""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

import pytest

from app.common.storage.local_disk import LocalDiskStorage
from app.common.storage.port import PutFileInput


@pytest.fixture
def storage(monkeypatch, tmp_path):
    s = LocalDiskStorage.__new__(LocalDiskStorage)
    s.root = tmp_path.resolve()
    return s


@pytest.mark.asyncio
async def test_put_open_roundtrip(storage):
    stored = await storage.put(PutFileInput(buffer=b"hello", original_name="Menu (Fall).pdf", scope="m1"))
    assert storage.is_managed(stored.key) is True
    assert re.match(r"^local/m1/\d{4}/\d{2}/[0-9a-fA-F-]{36}-Menu-Fall-\.pdf$", stored.key)
    assert stored.size_bytes == 5
    opened = await storage.open(stored.key)
    assert opened is not None
    assert opened.size_bytes == 5
    assert opened.stream.read() == b"hello"
    opened.stream.close()


@pytest.mark.asyncio
async def test_delete_removes_file_idempotent(storage):
    stored = await storage.put(PutFileInput(buffer=b"x", original_name="a.txt"))
    await storage.delete(stored.key)
    assert await storage.open(stored.key) is None
    await storage.delete(stored.key)  # idempotent, no raise


@pytest.mark.asyncio
async def test_unmanaged_references_never_touched(storage):
    assert storage.is_managed("s3://bucket/menu.pdf") is False
    assert storage.is_managed(None) is False
    assert await storage.open("s3://bucket/menu.pdf") is None
    await storage.delete("/etc/passwd")  # no raise


@pytest.mark.asyncio
async def test_path_traversal_refused(storage):
    assert await storage.open("local/../../etc/passwd") is None
    await storage.delete("local/../../etc/passwd")  # no raise


@pytest.mark.asyncio
async def test_original_name_sanitised(storage):
    stored = await storage.put(PutFileInput(buffer=b"x", original_name="../../evil name?.png"))
    assert ".." not in stored.key
    abs_path = (storage.root / stored.key[len("local/"):]).resolve()
    assert str(abs_path).startswith(str(storage.root))
