// Ported from site-builder-source-for-developer/app/api/seo/route.ts.
// Same request/response shape and NDJSON streaming contract as the source —
// only the import paths changed.
import { saveCloneJob } from "@/features/site-builder/server/clone-jobs";
import { progressLine, type CloneProgress } from "@/features/site-builder/server/clone-progress";
import { crawlSite } from "@/features/site-builder/server/crawler";
import { emptyMapping, type ColumnMapping } from "@/features/site-builder/server/csv-map";
import { htmlToNextFiles } from "@/features/site-builder/server/html-to-next";
import { mergeCsvPagesIntoClone } from "@/features/site-builder/server/seo-into-clone";
import { readSiteFile } from "@/features/site-builder/server/site-content-files";
import { hostKey, parseHttpUrl } from "@/features/site-builder/server/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps function duration (Pro: 800s; Hobby: 300s). 3600 fails the deploy.
export const maxDuration = 800;

function send(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: CloneProgress,
) {
  controller.enqueue(encoder.encode(progressLine(event)));
}

export async function POST(request: Request) {
  let body: {
    url?: string;
    downloadImages?: boolean;
    mapping?: ColumnMapping;
    rows?: Record<string, string>[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const rawUrl = typeof body.url === "string" ? body.url : "";
  try {
    parseHttpUrl(rawUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid URL" },
      { status: 400 },
    );
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const mapping = { ...emptyMapping(), ...body.mapping };
  const downloadImages = body.downloadImages !== false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: CloneProgress) => send(controller, encoder, event);
      try {
        emit({
          phase: "load",
          percent: 4,
          message: "Loading complete website before cloning…",
        });
        const site = await crawlSite(rawUrl, emit);
        if (site.pages.length === 0) {
          throw new Error("No HTML pages were crawled.");
        }
        emit({
          phase: "assets",
          percent: 74,
          message: `Website fully loaded (${site.pages.length} pages). Cloning into Next.js…`,
          current: site.pages.length,
          total: site.pages.length,
        });
        let files = await htmlToNextFiles(site, downloadImages, emit);
        emit({
          phase: "pages",
          percent: 90,
          message: "Creating extra pages from CSV URL structure…",
        });
        const merged = mergeCsvPagesIntoClone(files, site.origin, rows, mapping);
        files = merged.files;
        emit({
          phase: "zip",
          percent: 94,
          message: `Added ${merged.created} CSV pages. Saving editable workspace…`,
        });
        const host = hostKey(new URL(site.startUrl).hostname).replace(/[^a-z0-9.-]/gi, "");
        const filename = `seo-${host || "site"}.zip`;
        const totalPages = site.pages.length + merged.created;
        const job = await saveCloneJob(files, {
          filename,
          siteName: readSiteFile(files)?.name || host || "SEO site",
          origin: site.origin,
          kind: "seo",
          pageCount: totalPages,
        });
        emit({
          phase: "done",
          percent: 100,
          message: "Ready",
          downloadId: job.id,
          filename,
          // Studio is a follow-up not ported in this pass; carried through
          // as inert data (see app/api/clone/route.ts).
          studioPath: `/studio/${job.id}`,
          current: totalPages,
          total: totalPages,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "SEO build failed";
        emit({
          phase: "error",
          percent: 0,
          message,
          error: message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
