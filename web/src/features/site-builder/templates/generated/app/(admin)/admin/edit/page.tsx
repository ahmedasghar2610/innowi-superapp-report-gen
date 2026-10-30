import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "@/lib/site-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";
import AdminEditorClient from "../AdminEditorClient";

// /admin/edit?path=/… — the visual editor for one page, opened from the
// dashboard. "Back to pages" returns to /admin.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ path?: string }>;

export default async function AdminEditPage({ searchParams }: { searchParams: SearchParams }) {
  const cookieStore = await cookies();
  if (!isValidSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) redirect("/admin/login");
  const { path } = await searchParams;
  const site = await store.site().catch(() => undefined);
  return <AdminEditorClient siteName={site?.name} initialPath={path || "/"} />;
}
