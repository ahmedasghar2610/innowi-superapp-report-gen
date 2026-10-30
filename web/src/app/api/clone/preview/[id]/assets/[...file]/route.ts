// Static assets (images, fonts, /cloned.css, the sb-effects/a11y/widgets
// runtime) for the live clone preview above.
// Ported from site-builder-source-for-developer/app/api/studio/[id]/public/[...file]/route.ts.
import { runtimeFile } from "@/features/site-builder/server/runtime-bundle";
import { contentTypeFor, prefixPublicUrls, studioAssetPrefix } from "@/features/site-builder/server/studio-preview";
import { readWorkspacePublicFile } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; file: string[] }>;

// Runtime files shipped in every zip. The live preview serves the current
// copy from the bundled templates so it always matches the latest runtime,
// rather than whatever was on disk at clone time.
const RUNTIME_FILES = /^sb-(effects|widgets|a11y)\.(js|css)$/;

export async function GET(_request: Request, { params }: { params: Params }) {
  const { id, file } = await params;
  const rel = file.map(decodeURIComponent).join("/");
  let bytes: Buffer | null;
  try {
    bytes = RUNTIME_FILES.test(rel)
      ? Buffer.from(runtimeFile(`templates/generated/public/${rel}`), "utf8")
      : await readWorkspacePublicFile(id, rel);
  } catch {
    bytes = null;
  }
  if (!bytes) return new Response("Not found", { status: 404 });

  const type = contentTypeFor(rel);
  if (rel === "cloned.css") {
    // The cloned stylesheet references /assets/... too.
    const css = prefixPublicUrls(bytes.toString("utf8"), studioAssetPrefix(id));
    return new Response(css, {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Cache-Control": RUNTIME_FILES.test(rel) ? "no-store" : "private, max-age=300",
    },
  });
}
