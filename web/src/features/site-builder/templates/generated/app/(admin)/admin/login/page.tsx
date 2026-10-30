import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "@/lib/site-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";
import AdminLoginForm from "../AdminLoginForm";

// /admin/login — password form (ADMIN_PASSWORD from .env.local). Already
// signed in? Straight to the dashboard.
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const cookieStore = await cookies();
  if (isValidSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) redirect("/admin");
  const site = await store.site().catch(() => undefined);
  return <AdminLoginForm siteName={site?.name} />;
}
