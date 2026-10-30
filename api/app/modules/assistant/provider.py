"""Model backends for the assistant.

The engine only sees the small event types below, so a different backend (a
local model behind Ollama, for one) can be added as another `Provider`
without touching the lookups or the screen. Today there is one: a hosted
Messages-style API, called directly over httpx with streaming on. The service
URL, model and any extra headers come from settings (see app/config.py).

Wire format (Messages API streaming, checked against the provider's streaming
documentation on 2026-10-18):
message_start, then per content block content_block_start /
content_block_delta (text_delta | input_json_delta) / content_block_stop,
then message_delta (stop_reason, cumulative usage) and message_stop; `ping`
and `error` may appear anywhere.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional, Protocol, Union

import httpx


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens


@dataclass
class RoundEnd:
    """One model call finished. `content` is the assistant turn to send back next round."""
    stop_reason: Optional[str]
    content: list[dict[str, Any]]
    usage: Usage = field(default_factory=Usage)


Event = Union[TextDelta, ToolCall, RoundEnd]


class ProviderError(Exception):
    """A failure worth showing to the person in plain words."""

    def __init__(self, message: str, *, detail: str = ""):
        super().__init__(message)
        self.detail = detail


class Provider(Protocol):
    name: str
    model: str

    def stream(self, *, system: list[dict[str, Any]], messages: list[dict[str, Any]],
               tools: list[dict[str, Any]], max_tokens: int) -> AsyncIterator[Event]:
        ...


_FRIENDLY = {
    401: "The assistant's API key was rejected. An admin needs to check ASSISTANT_API_KEY.",
    403: "The assistant's API key isn't allowed to use this model.",
    404: "The configured assistant model wasn't found. An admin needs to check ASSISTANT_MODEL.",
    429: "The assistant is getting too many requests right now. Try again in a minute.",
    529: "The AI service is overloaded right now. Try again in a minute.",
}


class MessagesApiProvider:
    name = "messages-api"

    def __init__(self, *, api_key: str, model: str, base_url: str,
                 extra_headers: Optional[dict[str, str]] = None,
                 transport: Optional[httpx.AsyncBaseTransport] = None, timeout_s: float = 90.0):
        self.model = model
        self._api_key = api_key
        self._url = base_url.rstrip("/") + "/v1/messages"
        self._extra_headers = dict(extra_headers or {})
        self._transport = transport
        self._timeout = httpx.Timeout(timeout_s, connect=15.0)

    async def stream(self, *, system, messages, tools, max_tokens) -> AsyncIterator[Event]:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            "stream": True,
        }
        if tools:
            body["tools"] = tools
        headers = {
            **self._extra_headers,
            "x-api-key": self._api_key,
            "content-type": "application/json",
        }
        async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
            try:
                async with client.stream("POST", self._url, headers=headers, json=body) as res:
                    if res.status_code != 200:
                        raw = (await res.aread()).decode("utf-8", "replace")
                        raise ProviderError(
                            _FRIENDLY.get(res.status_code, f"The AI service returned an error ({res.status_code})."),
                            detail=raw[:300],
                        )
                    async for event in _parse(res.aiter_lines()):
                        yield event
            except httpx.TimeoutException as e:
                raise ProviderError("The AI service took too long to answer. Try again.", detail=str(e)) from e
            except httpx.HTTPError as e:
                raise ProviderError("Couldn't reach the AI service. Try again.", detail=str(e)) from e


async def _sse(lines: AsyncIterator[str]) -> AsyncIterator[tuple[str, str]]:
    """(event name, data) pairs from a text/event-stream."""
    name, data = "", []
    async for line in lines:
        if line == "":
            if data:
                yield name, "\n".join(data)
            name, data = "", []
        elif line.startswith(":"):
            continue
        elif line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))
    if data:
        yield name, "\n".join(data)


def _usage(raw: Optional[dict]) -> Usage:
    raw = raw or {}
    return Usage(
        input_tokens=int(raw.get("input_tokens") or 0),
        output_tokens=int(raw.get("output_tokens") or 0),
        cache_read_tokens=int(raw.get("cache_read_input_tokens") or 0),
        cache_write_tokens=int(raw.get("cache_creation_input_tokens") or 0),
    )


async def _parse(lines: AsyncIterator[str]) -> AsyncIterator[Event]:
    blocks: dict[int, dict[str, Any]] = {}
    partial: dict[int, list[str]] = {}
    usage = Usage()
    stop_reason: Optional[str] = None
    async for _name, data in _sse(lines):
        try:
            ev = json.loads(data)
        except ValueError:
            continue
        kind = ev.get("type")
        if kind == "message_start":
            usage = _usage((ev.get("message") or {}).get("usage"))
        elif kind == "content_block_start":
            idx = int(ev.get("index", 0))
            block = dict(ev.get("content_block") or {})
            if block.get("type") == "text":
                block["text"] = block.get("text") or ""
            blocks[idx] = block
            partial[idx] = []
        elif kind == "content_block_delta":
            idx = int(ev.get("index", 0))
            delta = ev.get("delta") or {}
            if delta.get("type") == "text_delta":
                text = delta.get("text") or ""
                blocks.setdefault(idx, {"type": "text", "text": ""})["text"] += text
                if text:
                    yield TextDelta(text)
            elif delta.get("type") == "input_json_delta":
                partial.setdefault(idx, []).append(delta.get("partial_json") or "")
        elif kind == "content_block_stop":
            idx = int(ev.get("index", 0))
            block = blocks.get(idx)
            if block and block.get("type") == "tool_use":
                raw = "".join(partial.get(idx, []))
                try:
                    block["input"] = json.loads(raw) if raw.strip() else {}
                except ValueError:
                    block["input"] = {}
                if not isinstance(block["input"], dict):
                    block["input"] = {}
                yield ToolCall(id=block["id"], name=block["name"], input=block["input"])
        elif kind == "message_delta":
            stop_reason = (ev.get("delta") or {}).get("stop_reason") or stop_reason
            later = _usage(ev.get("usage"))
            # message_delta usage is cumulative; keep the larger of each count.
            usage.output_tokens = max(usage.output_tokens, later.output_tokens)
            usage.input_tokens = max(usage.input_tokens, later.input_tokens)
            usage.cache_read_tokens = max(usage.cache_read_tokens, later.cache_read_tokens)
            usage.cache_write_tokens = max(usage.cache_write_tokens, later.cache_write_tokens)
        elif kind == "error":
            err = ev.get("error") or {}
            if err.get("type") == "overloaded_error":
                raise ProviderError(_FRIENDLY[529], detail=json.dumps(err)[:300])
            raise ProviderError("The AI service stopped with an error. Try again.", detail=json.dumps(err)[:300])
        elif kind == "message_stop":
            break
    content = [blocks[i] for i in sorted(blocks) if blocks[i].get("type") in ("text", "tool_use")]
    # An empty text block is rejected when sent back; drop it.
    content = [b for b in content if not (b.get("type") == "text" and not b.get("text"))]
    yield RoundEnd(stop_reason=stop_reason, content=content, usage=usage)
