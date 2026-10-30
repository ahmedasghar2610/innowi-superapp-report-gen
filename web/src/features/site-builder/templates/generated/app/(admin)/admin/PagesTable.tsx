"use client";

import { useMemo, useState } from "react";
import type { PageSummary } from "@/lib/content-store";

// /admin page list with publishing controls. Pages built from a pSEO
// workbook carry a status: live, scheduled (drip date) or on hold (with the
// reasons — below the word floor, gated Tier 3, missing article…). Plain
// cloned sites have no status, so every page simply shows as live.
type Filter = "all" | "live" | "scheduled" | "hold";

function statusOf(p: PageSummary): "live" | "scheduled" | "hold" {
  const s = p.publish?.status;
  if (s === "scheduled") return p.publish?.at && p.publish.at <= new Date().toISOString().slice(0, 10) ? "live" : "scheduled";
  return s === "hold" ? "hold" : "live";
}

const BADGE: Record<string, React.CSSProperties> = {
  live: { background: "#e7f6ec", color: "#136c2e" },
  scheduled: { background: "#eef2ff", color: "#3730a3" },
  hold: { background: "#fff4e5", color: "#8a4b00" },
};

export default function PagesTable({ initialPages }: { initialPages: PageSummary[] }) {
  const [pages, setPages] = useState(initialPages);
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasStatus = pages.some((p) => p.publish || p.pageType);
  const types = useMemo(() => [...new Set(pages.map((p) => p.pageType).filter(Boolean))] as string[], [pages]);
  const counts = useMemo(() => {
    const c = { all: pages.length, live: 0, scheduled: 0, hold: 0 };
    for (const p of pages) c[statusOf(p)] += 1;
    return c;
  }, [pages]);
  const shown = pages.filter(
    (p) =>
      (filter === "all" || statusOf(p) === filter) &&
      (!type || p.pageType === type) &&
      (!query || `${p.title} ${p.path}`.toLowerCase().includes(query.toLowerCase())),
  );

  async function setStatus(paths: string[], status: "live" | "hold") {
    if (!paths.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", paths, status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      const set = new Set(paths);
      setPages((prev) =>
        prev.map((p) =>
          set.has(p.path)
            ? { ...p, publish: status === "live" ? { status: "live" } : { status: "hold", reasons: ["Put on hold in /admin."] } }
            : p,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

  const tab = (f: Filter, label: string) => (
    <button
      key={f}
      type="button"
      className={`sb-admin-btn${filter === f ? "" : " secondary"}`}
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
    >
      {label} ({counts[f]})
    </button>
  );

  return (
    <div className="sb-admin-card">
      {hasStatus ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center", marginBottom: "1rem" }}>
          {tab("all", "All")}
          {tab("live", "Live")}
          {tab("scheduled", "Scheduled")}
          {tab("hold", "On hold")}
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Page type" style={{ padding: ".45rem", borderRadius: 8 }}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search pages"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: ".45rem .6rem", borderRadius: 8, border: "1px solid #ccc", minWidth: 180 }}
          />
          {filter === "hold" || filter === "scheduled" ? (
            <button
              type="button"
              className="sb-admin-btn"
              disabled={busy || !shown.length}
              onClick={() => {
                if (window.confirm(`Publish all ${shown.length} pages shown?`)) void setStatus(shown.map((p) => p.path), "live");
              }}
            >
              Publish all shown
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      ) : null}
      <ul className="sb-admin-list">
        {shown.map((page) => {
          const st = statusOf(page);
          return (
            <li key={page.path}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{page.title || page.path}</div>
                <code>{page.path}</code>
                {hasStatus ? (
                  <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap", alignItems: "center", marginTop: ".3rem", fontSize: 12 }}>
                    <span style={{ ...BADGE[st], padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                      {st === "scheduled" ? `Scheduled ${page.publish?.at}` : st === "hold" ? "On hold" : "Live"}
                    </span>
                    {page.pageType ? <span className="sb-admin-muted">{page.pageType}</span> : null}
                    {st === "hold" && page.publish?.reasons?.length ? (
                      <span className="sb-admin-muted">{page.publish.reasons.join(" ")}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: ".5rem", flexShrink: 0 }}>
                {hasStatus ? (
                  st === "live" ? (
                    <button type="button" className="sb-admin-btn secondary" disabled={busy || page.path === "/"} onClick={() => void setStatus([page.path], "hold")}>
                      Hold
                    </button>
                  ) : (
                    <button type="button" className="sb-admin-btn" disabled={busy} onClick={() => void setStatus([page.path], "live")}>
                      Publish now
                    </button>
                  )
                ) : null}
                <a className="sb-admin-btn secondary" href={`/admin/edit?path=${encodeURIComponent(page.path)}`}>
                  Edit
                </a>
                <a className="sb-admin-btn secondary" href={page.path} target="_blank" rel="noreferrer">
                  View
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      {!shown.length ? <p className="sb-admin-muted">No pages match.</p> : null}
    </div>
  );
}
