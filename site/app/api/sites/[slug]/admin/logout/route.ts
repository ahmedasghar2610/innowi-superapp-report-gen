import { cookies } from "next/headers";
import { adminCookie } from "@/lib/editor";
import { json } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { slug: string } }) {
  cookies().delete(adminCookie(params.slug));
  return json({ ok: true });
}
