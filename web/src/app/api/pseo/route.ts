// Clone a website + build its programmatic-SEO pages from a content-tree
// workbook (.xlsx, the 18-sheet pSEO format). Same NDJSON streaming contract
// as /api/clone and /api/seo; the final "done" event also carries `report`.
import { saveCloneJob } from "@/features/site-builder/server/clone-jobs";
import { progressLine, type CloneProgress } from "@/features/site-builder/server/clone-progress";
import { crawlSite } from "@/features/site-builder/server/crawler";
import { htmlToNextFiles } from "@/features/site-builder/server/html-to-next";
import { applyPseo, type PseoReport } from "@/features/site-builder/server/pseo/build";
import { buildPlan } from "@/features/site-builder/server/pseo/model";
import { readWorkbook } from "@/features/site-builder/server/pseo/xlsx";
import { readSiteFile } from "@/features/site-builder/server/site-content-files";
import { hostKey, parseHttpUrl } from "@/features/site-builder/server/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps function duration (Pro: 800s; Hobby: 300s). 3600 fails the deploy.
export const maxDuration = 800;

const MAX_XLSX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  let body: {
    url?: string;
    xlsxBase64?: string;
    fileName?: string;
    downloadImages?: boolean;
    respectSchedule?: boolean;
    qualityGate?: boolean;
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
    return Response.json({ error: error instanceof Error ? error.message : "Invalid URL" }, { status: 400 });
  }
  const bytes = Buffer.from(typeof body.xlsxBase64 === "string" ? body.xlsxBase64 : "", "base64");
  if (!bytes.length) return Response.json({ error: "Attach the pSEO workbook (.xlsx)." }, { status: 400 });
  if (bytes.length > MAX_XLSX_BYTES) return Response.json({ error: "The workbook is larger than 15 MB." }, { status: 413 });

  // Read the workbook before crawling so a wrong file fails in a second, not after the crawl.
  let plan: ReturnType<typeof buildPlan>;
  try {
    plan = buildPlan(await readWorkbook(bytes));
  } catch (error) {
    return Response.json(
      { error: `Couldn't read the workbook: ${error instanceof Error ? error.message : "unknown error"}` },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: CloneProgress & { report?: PseoReport }) => controller.enqueue(encoder.encode(progressLine(event)));
      try {
        emit({
          phase: "load",
          percent: 4,
          message: `Workbook read: ${plan.pages.length} pages for ${plan.business.name}. Loading the website…`,
        });
        const site = await crawlSite(rawUrl, emit);
        if (site.pages.length === 0) throw new Error("No HTML pages were crawled.");
        emit({
          phase: "assets",
          percent: 74,
          message: `Website loaded (${site.pages.length} pages). Cloning into Next.js…`,
          current: site.pages.length,
          total: site.pages.length,
        });
        let files = await htmlToNextFiles(site, body.downloadImages !== false, emit);
        emit({ phase: "pages", percent: 90, message: `Building ${plan.pages.length} pSEO pages from the workbook…` });
        const applied = applyPseo(files, plan, {
          respectSchedule: body.respectSchedule !== false,
          qualityGate: body.qualityGate !== false,
        });
        files = applied.files;
        const report = applied.report;
        emit({
          phase: "zip",
          percent: 95,
          message: `${report.generated} pages generated, ${report.kept} kept · ${report.live} live, ${report.scheduled} scheduled, ${report.hold} on hold. Saving…`,
        });
        const host = hostKey(new URL(site.startUrl).hostname).replace(/[^a-z0-9.-]/gi, "");
        const filename = `pseo-${host || "site"}.zip`;
        const pageCount = Object.keys(JSON.parse(String(files["content/pages.json"] || "{}")).pages || {}).length;
        const job = await saveCloneJob(files, {
          filename,
          siteName: plan.business.name || readSiteFile(files)?.name || host || "pSEO site",
          origin: site.origin,
          kind: "seo",
          pageCount,
        });
        emit({
          phase: "done",
          percent: 100,
          message: "Ready",
          downloadId: job.id,
          filename,
          studioPath: `/studio/${job.id}`,
          current: pageCount,
          total: pageCount,
          report,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "pSEO build failed";
        emit({ phase: "error", percent: 0, message, error: message });
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
