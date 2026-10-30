export type ClonePhase =
  | "launch"
  | "load"
  | "crawl"
  | "pages"
  | "assets"
  | "zip"
  | "done"
  | "error";

export type CloneProgress = {
  phase: ClonePhase;
  percent: number;
  message: string;
  current?: number;
  total?: number;
  downloadId?: string;
  filename?: string;
  /** Builder studio URL for editing the finished site, e.g. /studio/<id>. */
  studioPath?: string;
  error?: string;
};

/** Human label for the progress bar. Stage 1 loads the whole site; Stage 2 clones it. */
export function phaseLabel(phase: ClonePhase): string {
  switch (phase) {
    case "launch":
    case "load":
      return "Stage 1 · Loading complete website";
    case "crawl":
      return "Stage 1 · Website loaded";
    case "pages":
    case "assets":
      return "Stage 2 · Cloning";
    case "zip":
      return "Stage 2 · Packaging";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

export function progressLine(event: CloneProgress): string {
  return `${JSON.stringify(event)}\n`;
}

export function crawlPercent(loaded: number, queued: number): number {
  const total = loaded + queued;
  if (total <= 0) return 8;
  return Math.min(72, 8 + Math.round((loaded / total) * 64));
}
