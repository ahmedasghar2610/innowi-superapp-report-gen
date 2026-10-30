"""Every lookup the assistant has, plus the chart tool."""
from __future__ import annotations

from typing import Any

from app.modules.assistant import actions, catalog, tools_other, tools_sales
from app.modules.assistant.tools_base import Ctx, Tool, ToolError

CHART_TYPES = ("bar", "horizontal_bar", "line", "area", "donut")
FORMATS = ("count", "money", "percent")
MAX_POINTS = 40
MAX_SERIES = 4


def _clean_chart(args: dict[str, Any]) -> dict[str, Any]:
    kind = args.get("type")
    if kind not in CHART_TYPES:
        raise ToolError(f"type must be one of {', '.join(CHART_TYPES)}")
    title = str(args.get("title") or "").strip()[:100]
    if not title:
        raise ToolError("title is required")
    labels = args.get("labels")
    if not isinstance(labels, list) or not (1 <= len(labels) <= MAX_POINTS):
        raise ToolError(f"labels must be a list of 1-{MAX_POINTS} items")
    labels = [str(x)[:40] for x in labels]
    series = args.get("series")
    if not isinstance(series, list) or not (1 <= len(series) <= MAX_SERIES):
        raise ToolError(f"series must be a list of 1-{MAX_SERIES} items")
    if kind == "donut" and len(series) != 1:
        raise ToolError("a donut chart takes exactly one series")
    clean = []
    for s in series:
        if not isinstance(s, dict):
            raise ToolError("each series is {name, values}")
        values = s.get("values")
        if not isinstance(values, list) or len(values) != len(labels):
            raise ToolError("each series needs exactly one value per label")
        nums = []
        for v in values:
            if v is None:
                nums.append(None)
                continue
            try:
                nums.append(float(v))
            except (TypeError, ValueError):
                raise ToolError("values must be numbers")
        clean.append({"name": str(s.get("name") or "")[:40], "values": nums})
    fmt = args.get("format") or "count"
    if fmt not in FORMATS:
        raise ToolError(f"format must be one of {', '.join(FORMATS)}")
    return {"type": kind, "title": title, "subtitle": str(args.get("subtitle") or "").strip()[:140] or None,
            "labels": labels, "series": clean, "format": fmt}


async def show_chart(ctx: Ctx, args: dict) -> dict[str, Any]:
    chart = _clean_chart(args)
    ctx.charts.append(chart)
    return {"shown": True, "note": "The chart is on screen where you called this. Don't repeat its numbers as a table."}


CHART_TOOL = Tool(
    name="show_chart", label="Drawing a chart", run=show_chart,
    description=("Draw a chart on screen, at this point in your answer. Use it when a trend over time or a comparison "
                 "of 3+ items is easier to see than to read. Only chart numbers that came from a lookup. "
                 "bar/line/area: labels are the x-axis (e.g. months); horizontal_bar for long names or rankings; "
                 "donut for parts of a whole (one series, at most 8 slices)."),
    properties={
        "type": {"type": "string", "enum": list(CHART_TYPES)},
        "title": {"type": "string"},
        "subtitle": {"type": "string", "description": "Optional one line, e.g. the date range or filter."},
        "labels": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_POINTS},
        "series": {
            "type": "array", "maxItems": MAX_SERIES,
            "items": {"type": "object", "properties": {"name": {"type": "string"},
                                                       "values": {"type": "array", "items": {"type": ["number", "null"]}}},
                      "required": ["name", "values"]},
        },
        "format": {"type": "string", "enum": list(FORMATS), "description": "How to show the values. Default count."},
    },
    required=("type", "title", "labels", "series"),
)

ALL_TOOLS: list[Tool] = [*tools_sales.TOOLS, *tools_other.TOOLS, CHART_TOOL, *actions.ACTION_TOOLS, *catalog.CATALOG_TOOLS]
BY_NAME: dict[str, Tool] = {t.name: t for t in ALL_TOOLS}
assert len(BY_NAME) == len(ALL_TOOLS), "duplicate tool name"


def tools_for(ctx: Ctx) -> list[Tool]:
    return [t for t in ALL_TOOLS if t.allowed(ctx)]
