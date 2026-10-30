// A finished clone / SEO run. Files live on disk in .workspaces/<id>/ (see
// lib/workspaces.ts) so they can be edited at /studio/<id>; the zip is built
// on demand from the current workspace contents.
import { LEGACY_FILES, runtimeFiles } from "@/features/site-builder/server/admin-files";
import { zipFiles } from "@/features/site-builder/server/project-zip";
import type { FileMap } from "@/features/site-builder/server/site-content-files";
import {
  createWorkspace,
  getWorkspaceMeta,
  readWorkspaceFiles,
  type WorkspaceMeta,
} from "@/features/site-builder/server/workspaces";

export type CloneJob = WorkspaceMeta;

export async function saveCloneJob(
  files: FileMap,
  meta: Omit<WorkspaceMeta, "id" | "createdAt">,
): Promise<CloneJob> {
  return createWorkspace(files, meta);
}

export async function getCloneJob(id: string): Promise<CloneJob | null> {
  if (!id) return null;
  return getWorkspaceMeta(id);
}

export async function zipCloneJob(id: string): Promise<Buffer> {
  const files = await readWorkspaceFiles(id);
  // Always ship the current editor / effects runtime, even for workspaces
  // created by an older generator. User content (content/*, public/assets,
  // .env.local) is left untouched.
  Object.assign(files, runtimeFiles());
  // Layouts written by an older generator lack suppressHydrationWarning on
  // <html>, so the /admin editor's data-sb-editing attribute logged a React
  // hydration warning. Patch them on the way out; new clones already have it.
  const layout = files["app/(site)/layout.tsx"];
  if (typeof layout === "string" && !layout.includes("suppressHydrationWarning")) {
    files["app/(site)/layout.tsx"] = layout.replace("<html lang=", "<html suppressHydrationWarning lang=");
  }
  for (const legacy of LEGACY_FILES) delete files[legacy];
  return zipFiles(files);
}
