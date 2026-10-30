"use client";

import { useRef, useState } from "react";
import type React from "react";
import type { CsvPreview, PageSummary } from "./types";

type Props = {
  pages: PageSummary[];
  currentPath: string;
  currentTitle: string;
  onGoTo: (path: string) => void;
  onCreate: (path: string, title: string) => Promise<void>;
  onDuplicate: (path: string, title: string) => Promise<void>;
  onCsvPreview: (csv: string) => Promise<CsvPreview | null>;
  onCsvImport: (csv: string) => Promise<void>;
  onDelete: () => void;
};

type Mode = "list" | "add" | "duplicate" | "csv";

export default function PagesPanel({
  pages,
  currentPath,
  currentTitle,
  onGoTo,
  onCreate,
  onDuplicate,
  onCsvPreview,
  onCsvImport,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<Mode>("list");
  const [newPath, setNewPath] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function open(next: Mode) {
    if (next === "duplicate") {
      setNewPath(currentPath === "/" ? "/home-copy" : `${currentPath}-copy`);
      setNewTitle(currentTitle ? `${currentTitle} (copy)` : "");
    } else {
      setNewPath("");
      setNewTitle("");
    }
    setPreview(null);
    setCsvText("");
    setCsvName("");
    setMode((current) => (current === next ? "list" : next));
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newPath.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(newPath.trim(), newTitle.trim());
      setMode("list");
    } finally {
      setBusy(false);
    }
  }

  async function submitDuplicate(e: React.FormEvent) {
    e.preventDefault();
    if (!newPath.trim() || busy) return;
    setBusy(true);
    try {
      await onDuplicate(newPath.trim(), newTitle.trim());
      setMode("list");
    } finally {
      setBusy(false);
    }
  }

  async function pickCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    setCsvName(file.name);
    setCsvText(text);
    setBusy(true);
    try {
      setPreview(await onCsvPreview(text));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!csvText || busy) return;
    setBusy(true);
    try {
      await onCsvImport(csvText);
      setMode("list");
      setPreview(null);
      setCsvText("");
    } finally {
      setBusy(false);
    }
  }

  const newCount = preview ? preview.pages.filter((p) => !p.exists).length : 0;
  const mappedColumns = preview
    ? Object.entries(preview.mapping).filter(([, column]) => column)
    : [];

  return (
    <div className="sbve-panel-body">
      <section className="sbve-section">
        <h3>
          Pages
          <span className="sbve-row" style={{ marginTop: 0 }}>
            <button type="button" className={`sbve-btn small ${mode === "add" ? "primary" : ""}`} onClick={() => open("add")}>
              {mode === "add" ? "Cancel" : "+ Add"}
            </button>
            <button type="button" className={`sbve-btn small ${mode === "csv" ? "primary" : ""}`} onClick={() => open("csv")} title="Create many pages from a spreadsheet">
              {mode === "csv" ? "Cancel" : "Import CSV"}
            </button>
          </span>
        </h3>

        {mode === "add" ? (
          <form onSubmit={submitAdd} className="sbve-pages-form">
            <label className="sbve-label" htmlFor="sbve-new-path">URL path</label>
            <input
              id="sbve-new-path"
              className="sbve-input"
              placeholder="/services/roof-repair"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              autoFocus
            />
            <label className="sbve-label" htmlFor="sbve-new-title">Title</label>
            <input id="sbve-new-title" className="sbve-input" placeholder="Roof repair" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <p className="sbve-hint">Header and footer are copied from the page you are viewing.</p>
            <div className="sbve-row">
              <button type="submit" className="sbve-btn small primary" disabled={!newPath.trim() || busy}>
                Create page
              </button>
            </div>
          </form>
        ) : null}

        {mode === "duplicate" ? (
          <form onSubmit={submitDuplicate} className="sbve-pages-form">
            <p className="sbve-hint" style={{ marginTop: 0 }}>
              Copies everything on <code>{currentPath}</code> — content, images and styles — to a new URL.
            </p>
            <label className="sbve-label" htmlFor="sbve-dup-path">New URL path</label>
            <input
              id="sbve-dup-path"
              className="sbve-input"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              autoFocus
            />
            <label className="sbve-label" htmlFor="sbve-dup-title">Title</label>
            <input id="sbve-dup-title" className="sbve-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <div className="sbve-row">
              <button type="submit" className="sbve-btn small primary" disabled={!newPath.trim() || busy}>
                Duplicate page
              </button>
              <button type="button" className="sbve-btn small" onClick={() => setMode("list")}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {mode === "csv" ? (
          <div className="sbve-pages-form">
            <input ref={fileInput} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={pickCsv} />
            {!preview ? (
              <>
                <p className="sbve-hint" style={{ marginTop: 0 }}>
                  One row per page. Columns like <code>url</code> or <code>slug</code>, <code>title</code>,{" "}
                  <code>keyword</code>, <code>location</code>, <code>category</code> and <code>content</code> are
                  detected automatically. New pages reuse the header and footer of the page you are viewing.
                </p>
                <div className="sbve-row">
                  <button type="button" className="sbve-btn small primary" onClick={() => fileInput.current?.click()} disabled={busy}>
                    {busy ? "Reading…" : "Choose CSV file"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="sbve-hint" style={{ marginTop: 0 }}>
                  <strong>{csvName}</strong> — {preview.rowCount} {preview.rowCount === 1 ? "row" : "rows"},{" "}
                  {newCount} new {newCount === 1 ? "page" : "pages"}
                  {preview.pages.length - newCount > 0 ? `, ${preview.pages.length - newCount} already exist (skipped)` : ""}.
                </p>
                {mappedColumns.length > 0 ? (
                  <p className="sbve-hint">
                    Columns: {mappedColumns.map(([field, column]) => `${column} → ${field}`).join(", ")}
                  </p>
                ) : null}
                <ul className="sbve-csv-preview">
                  {preview.pages.slice(0, 50).map((page) => (
                    <li key={page.path} className={page.exists ? "exists" : ""}>
                      <span className="t">{page.title}</span>
                      <span className="p">{page.path}{page.exists ? " · exists" : ""}</span>
                    </li>
                  ))}
                  {preview.pages.length > 50 ? <li className="more">…and {preview.pages.length - 50} more</li> : null}
                </ul>
                <div className="sbve-row">
                  <button type="button" className="sbve-btn small primary" onClick={runImport} disabled={busy || newCount === 0}>
                    {busy ? "Importing…" : `Import ${newCount} ${newCount === 1 ? "page" : "pages"}`}
                  </button>
                  <button type="button" className="sbve-btn small" onClick={() => fileInput.current?.click()} disabled={busy}>
                    Choose another file
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {pages.length === 0 ? (
          <p className="sbve-empty">No pages yet.</p>
        ) : (
          <ul className="sbve-pages">
            {pages.map((page) => (
              <li key={page.path}>
                <button
                  type="button"
                  className={`page ${page.path === currentPath ? "active" : ""}`}
                  onClick={() => onGoTo(page.path)}
                  title={page.path}
                >
                  <span className="t">{page.title || page.path}</span>
                  <span className="p">{page.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sbve-row">
          <button type="button" className={`sbve-btn small ${mode === "duplicate" ? "primary" : ""}`} onClick={() => open("duplicate")}>
            Duplicate this page
          </button>
          {currentPath !== "/" ? (
            <button type="button" className="sbve-btn small danger" onClick={onDelete}>
              Delete this page
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
