import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { adminCookie, EDITOR_ENABLED, editorSession } from "@/lib/editor";
import { getSite } from "@/lib/sites";
import AdminLoginForm from "@/components/admin/AdminLoginForm";
import AdminEditorClient from "@/components/admin/AdminEditorClient";

/*
 * /<slug>/admin — this website's visual editor, reached only by adding /admin
 * to its URL (nothing links here). Signed out: the password form. Signed in:
 * the full Site Builder editor. The password is set per website in the
 * Super App; the session is a token for this one website (see lib/editor.js).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const token = cookies().get(adminCookie(params.slug))?.value;
  const site = await getSite(params.slug, { token });
  return {
    title: site ? `Edit ${site.business?.name || site.name || site.slug}` : "Admin",
    robots: { index: false, follow: false },
  };
}

export default async function AdminPage({ params }) {
  if (!EDITOR_ENABLED) notFound();
  const token = cookies().get(adminCookie(params.slug))?.value;
  const site = await getSite(params.slug, { token });
  if (!site) notFound();

  const session = await editorSession(site.slug, token);
  const name = site.business?.name || site.name || site.slug;

  if (!session) return <AdminLoginForm slug={site.slug} siteName={name} />;
  return <AdminEditorClient slug={site.slug} siteName={name} />;
}
