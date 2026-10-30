"""Port of upload.helpers.ts: upload size limit + safe streaming Content-Disposition."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse

from app.common.storage.port import FileStreamResult
from app.config import get_settings


_CHUNK = 1024 * 1024


# Vercel refuses request bodies over 4.5 MB before they reach the API, so on a
# serverless host the effective limit is 4 MB (with a clear message) whatever
# MAX_UPLOAD_MB says.
SERVERLESS_UPLOAD_LIMIT_MB = 4


def effective_upload_limit_mb() -> int:
    from app.common import jobs

    limit = get_settings().MAX_UPLOAD_MB
    return min(limit, SERVERLESS_UPLOAD_LIMIT_MB) if jobs.inline() else limit


async def read_upload_within_limit(file: UploadFile | None) -> bytes:
    """Mirrors multer's fileSize limit -> 413 mapping, and its empty/missing-file 400.

    Reads in chunks and aborts as soon as the cap is passed. Reading the whole
    body first and *then* measuring it (the previous approach) means a client can
    make the process allocate an arbitrarily large buffer before the 413 is
    raised — multer enforced the limit mid-stream, so this does too.
    """
    limit_mb = effective_upload_limit_mb()
    max_bytes = limit_mb * 1024 * 1024

    if file is None or not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A file is required")

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds the {limit_mb}MB upload limit",
            )
        chunks.append(chunk)

    if total == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")

    return b"".join(chunks)


def stream_file_response(file: FileStreamResult, file_name: str, mime_type: str | None) -> StreamingResponse:
    ascii_name = "".join(c if 0x20 <= ord(c) <= 0x7E and c not in '"\\' else "_" for c in file_name)
    headers = {
        "Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(file_name)}',
        "Cache-Control": "private, no-store",
        "Content-Length": str(file.size_bytes),
    }
    return StreamingResponse(
        file.stream,
        media_type=mime_type or file.mime_type or "application/octet-stream",
        headers=headers,
    )
