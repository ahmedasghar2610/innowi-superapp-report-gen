// Persist finished clone / SEO runs to .workspaces/<id>/ so they can be
// downloaded as a zip, listed in "My Clones", and (later) edited.
//
// Two lifecycles layered on the same directory:
//  - Every finished run gets a workspace dir, pruned after 24h by default
//    (pruneWorkspaces) — this is the original Site Builder behaviour and
//    still applies to a run nobody looked at again.
//  - "Save to My Clones" (saveClone) additionally writes the workspace's id
//    into a small durable index file (clones-index.json, next to
//    .workspaces/ rather than inside it, so pruning never touches it) and
//    marks the workspace itself with a ".saved" marker. Saved workspaces are
//    exempt from the 24h prune, so a clone a user has kept stays visitable
//    (and its zip stays downloadable) indefinitely — until they explicitly
//    remove it (removeClone), which deletes both the index entry and the
//    workspace directory.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createContentStore, type ContentStore } from "@/features/site-builder/server/content-store";
import type { FileMap } from "@/features/site-builder/server/site-content-files";

export const WORKSPACES_DIR = path.join(process.cwd(), ".workspaces");
const TTL_MS = 24 * 60 * 60 * 1000;
const META_FILE = ".workspace.json";
const SAVED_MARKER = ".saved";

// Kept outside .workspaces/ on purpose: pruneWorkspaces() only ever looks at
// entries inside WORKSPACES_DIR, so this file is never at risk of being swept
// up by a readdir there, and it stays valid even if a workspace directory is
// later removed out from under it (listClones tolerates a missing dir).
const CLONES_INDEX_FILE = path.join(process.cwd(), ".workspaces-index.json");

export type WorkspaceMeta = {
  id: string;
  filename: string;
  siteName: string;
  origin: string;
  kind: "clone" | "seo";
  createdAt: string;
  pageCount: number;
};

/** One row of the durable "My Clones" list — a saved workspace's summary. */
export type CloneSummary = WorkspaceMeta & {
  savedAt: string;
};

const ID_RE = /^[a-f0-9-]{8,64}$/i;

export function workspaceDir(id: string): string {
  if (!ID_RE.test(id)) throw new Error("Invalid workspace id.");
  return path.join(WORKSPACES_DIR, id);
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function pruneWorkspaces(): Promise<void> {
  let ids: string[] = [];
  try {
    ids = await readdir(WORKSPACES_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    ids.map(async (id) => {
      const dir = path.join(WORKSPACES_DIR, id);
      try {
        if (await exists(path.join(dir, SAVED_MARKER))) return; // kept indefinitely
        const info = await stat(dir);
        if (now - info.mtimeMs > TTL_MS) await rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }),
  );
}

export async function createWorkspace(
  files: FileMap,
  meta: Omit<WorkspaceMeta, "id" | "createdAt">,
): Promise<WorkspaceMeta> {
  await pruneWorkspaces();
  const id = crypto.randomUUID();
  const dir = workspaceDir(id);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    if (!target.startsWith(dir)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const full: WorkspaceMeta = { ...meta, id, createdAt: new Date().toISOString() };
  await writeFile(path.join(dir, META_FILE), JSON.stringify(full, null, 2));
  return full;
}

export async function getWorkspaceMeta(id: string): Promise<WorkspaceMeta | null> {
  try {
    const raw = await readFile(path.join(workspaceDir(id), META_FILE), "utf8");
    return JSON.parse(raw) as WorkspaceMeta;
  } catch {
    return null;
  }
}

export async function workspaceExists(id: string): Promise<boolean> {
  try {
    return await exists(path.join(workspaceDir(id), META_FILE));
  } catch {
    return false;
  }
}

export function workspaceStore(id: string): ContentStore {
  return createContentStore(workspaceDir(id));
}

async function walk(dir: string, prefix = ""): Promise<FileMap> {
  const out: FileMap = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, await walk(full, rel));
    } else if (rel !== META_FILE && rel !== SAVED_MARKER && !rel.endsWith(".tmp")) {
      out[rel] = await readFile(full);
    }
  }
  return out;
}

/** Full file map of a workspace, ready for zipping. */
export async function readWorkspaceFiles(id: string): Promise<FileMap> {
  return walk(workspaceDir(id));
}

/** Read one file under the workspace's public/ folder (for the live preview). */
export async function readWorkspacePublicFile(id: string, rel: string): Promise<Buffer | null> {
  const base = path.join(workspaceDir(id), "public");
  const target = path.resolve(base, rel);
  if (!target.startsWith(base)) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ My Clones index */

async function readIndex(): Promise<CloneSummary[]> {
  try {
    const raw = await readFile(CLONES_INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CloneSummary[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(rows: CloneSummary[]): Promise<void> {
  const tmp = `${CLONES_INDEX_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await rename(tmp, CLONES_INDEX_FILE);
}

/**
 * Keep a finished workspace past the 24h TTL and add it to "My Clones".
 * Idempotent — saving an already-saved id just refreshes its index row.
 */
export async function saveClone(id: string): Promise<CloneSummary> {
  const meta = await getWorkspaceMeta(id);
  if (!meta) throw new Error("Unknown or expired workspace.");
  await writeFile(path.join(workspaceDir(id), SAVED_MARKER), "");

  const rows = await readIndex();
  const savedAt = new Date().toISOString();
  const summary: CloneSummary = { ...meta, savedAt };
  const next = [summary, ...rows.filter((r) => r.id !== id)];
  await writeIndex(next);
  return summary;
}

/** All saved clones, newest first. Entries whose workspace has vanished are dropped. */
export async function listClones(): Promise<CloneSummary[]> {
  const rows = await readIndex();
  const checked = await Promise.all(
    rows.map(async (row) => ((await exists(path.join(workspaceDir(row.id), META_FILE))) ? row : null)),
  );
  const alive = checked.filter((r): r is CloneSummary => r !== null);
  if (alive.length !== rows.length) await writeIndex(alive); // drop stale rows lazily
  return alive.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getClone(id: string): Promise<CloneSummary | null> {
  const rows = await readIndex();
  return rows.find((r) => r.id === id) ?? null;
}

/** Remove a saved clone entirely — both its index row and its workspace files. */
export async function removeClone(id: string): Promise<void> {
  const rows = await readIndex();
  await writeIndex(rows.filter((r) => r.id !== id));
  try {
    await rm(workspaceDir(id), { recursive: true, force: true });
  } catch {
    // already gone
  }
}
