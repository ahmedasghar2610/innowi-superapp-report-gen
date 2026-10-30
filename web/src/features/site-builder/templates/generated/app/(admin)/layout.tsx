import type { Metadata } from "next";
import "../globals.css";

// /admin's own root layout. There's no top-level app/layout.tsx in this
// project — app/(site)/layout.tsx (written per-clone by starter-files.ts)
// is the public site's root layout, and this one is /admin's, so each route
// group supplies its own <html>/<body> and neither inherits the other's
// styles. In particular /admin never loads /cloned.css, /sb-effects.css,
// /sb-widgets.css or /sb-a11y.css — those are the public site's cloned
// styles and widgets, irrelevant (and potentially conflicting) here.
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Dashboard styles (/admin and /admin/login). The editor at /admin/edit
// styles itself and only needs the page margin reset.
const ADMIN_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; }
  body {
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f4f4f2;
    color: #1a1612;
  }
  * { box-sizing: border-box; }
  .sb-admin-shell { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.5rem; }
  .sb-admin-card {
    background: #fff; border: 1px solid #e3e0d8; border-radius: 12px;
    padding: 1.5rem; box-shadow: 0 1px 2px rgba(0,0,0,.04);
  }
  .sb-admin-title { font-size: 1.5rem; margin: 0 0 .25rem; }
  .sb-admin-muted { color: #6b665e; margin: 0 0 1.25rem; }
  .sb-admin-btn {
    display: inline-flex; align-items: center; gap: .4rem; padding: .55rem .95rem;
    border-radius: 8px; border: 1px solid #1a1612; background: #1a1612; color: #fff;
    font: inherit; font-weight: 600; cursor: pointer; text-decoration: none;
  }
  .sb-admin-btn.secondary { background: #fff; color: #1a1612; }
  .sb-admin-list { list-style: none; margin: 0; padding: 0; }
  .sb-admin-list li {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    padding: .8rem 0; border-top: 1px solid #ecebe6;
  }
  .sb-admin-list li:first-child { border-top: 0; }
  .sb-admin-list code { font-size: .8rem; color: #6b665e; }
  .sb-admin-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
`;

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
