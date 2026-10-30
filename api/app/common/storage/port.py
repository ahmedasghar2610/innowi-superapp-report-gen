"""Port of file-storage.port.ts."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import BinaryIO, Optional


@dataclass
class StoredFile:
    key: str
    size_bytes: int


@dataclass
class PutFileInput:
    buffer: bytes
    original_name: str
    mime_type: Optional[str] = None
    scope: Optional[str] = None


@dataclass
class FileStreamResult:
    stream: BinaryIO
    size_bytes: int
    mime_type: Optional[str]


class FileStorage(ABC):
    @abstractmethod
    async def put(self, input: PutFileInput) -> StoredFile: ...

    @abstractmethod
    async def open(self, key: str) -> Optional[FileStreamResult]: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    @abstractmethod
    def is_managed(self, key: Optional[str]) -> bool: ...
