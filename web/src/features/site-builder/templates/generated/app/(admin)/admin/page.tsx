import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "@/lib/site-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";
import LogoutButton from "./LogoutButton";
import PagesTable from "./PagesTable";

// /admin — this site's admin dashboard: every page of the site, each with
// Edit (opens the visual editor at /admin/edit) and View. Signed-out visitors
// go to /admin/login first. Ported from site-builder-source-for-developer's
// generated admin; the Super App's own Studio skips this page and opens the
// editor directly.
//
// The route group `(admin)` adds no URL segment. No middleware.ts is needed:
// each admin page checks the sb_admin_session cookie itself, and every
// /api/admin/* route checks it independently.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const cookieStore = await cookies();
  if (!isValidSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) redirect("/admin/login");

  const [site, pages] = await Promise.all([store.site(), store.list()]);

  return (
    <main className="sb-admin-shell">
      <div className="sb-admin-row">
        <div>
          <h1 className="sb-admin-title">{site.name}</h1>
          <p className="sb-admin-muted" style={{ margin: 0 }}>
            {pages.length} {pages.length === 1 ? "page" : "pages"} · content lives in <code>content/pages.json</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          <a className="sb-admin-btn" href="/admin/edit?path=/">
            Open visual editor
          </a>
          <a className="sb-admin-btn secondary" href="/" target="_blank" rel="noreferrer">
            View site
          </a>
          <LogoutButton />
        </div>
      </div>

      <PagesTable initialPages={pages} />
    </main>
  );
}
