import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACCESS_TOKEN_COOKIE } from "@/features/auth/cookies";
import { apiUrl } from "@/features/auth/server-api-base";
import { AssistantPage } from "@/features/assistant/assistant-page";

/**
 * / — the SuperApp assistant. Right after sign-in (the login form lands on
 * /?start=1) people who picked another start page (Settings → Profile → Start
 * page: Tickets or Assigned to me) are sent there instead; every other visit
 * to / (the Assistant menu entry, the logo) shows the assistant. Any failure
 * (API down, no cookie) lands on the assistant at a plain /.
 */
export default async function HomeRoute({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  if (start !== "1") return <AssistantPage />;
  let target: string | null = null;
  try {
    const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
    if (token) {
      const res = await fetch(apiUrl("/settings/me"), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const body = (await res.json()) as { preferences?: { startPage?: string } };
        const start = body.preferences?.startPage;
        if (start === "tickets") target = "/ops/tickets";
        else if (start === "my-work") target = "/ops/my-work";
      }
    }
  } catch {
    /* keep the assistant */
  }
  // No other start page: drop ?start=1 so a reload or a shared link is just "/".
  redirect(target ?? "/");
}
