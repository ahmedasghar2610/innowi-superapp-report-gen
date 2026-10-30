"use client";

// /<slug>/admin sign-in. Ported from the Site Builder's generated-site
// AdminLoginForm; posts to this site's own login route and reloads, so the
// server page re-reads the cookie and opens the editor.
import { useState } from "react";
import type React from "react";

export default function AdminLoginForm({ slug, siteName }: { slug: string; siteName?: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(slug)}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "Incorrect password.");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.badge}>🔒</div>
        <h1 style={styles.heading}>{siteName ? `${siteName} — Admin` : "Admin"}</h1>
        <p style={styles.subheading}>Enter the website's admin password to edit its pages.</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoFocus
          style={styles.input}
        />
        {error ? <p style={styles.error}>{error}</p> : null}
        <button type="submit" disabled={busy || !password} style={styles.button}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "grid",
    placeItems: "center",
    minHeight: "100vh",
    padding: 24,
    background: "#f5f6f8",
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: "#32425b",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: "36px 32px",
    textAlign: "center",
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.06)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    margin: "0 auto 18px",
    borderRadius: 999,
    background: "#eaf0fe",
    fontSize: 22,
  },
  heading: { margin: "0 0 6px", fontSize: 20, fontWeight: 600, fontFamily: "inherit", color: "#32425b" },
  subheading: { margin: "0 0 20px", fontSize: 14, color: "#6b7280" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #d0d5dd",
    borderRadius: 8,
    outline: "none",
    marginBottom: 12,
  },
  error: { margin: "0 0 12px", fontSize: 13, color: "#b42318", textAlign: "left" },
  button: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 600,
    color: "#ffffff",
    background: "#2563eb",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
};
