/** Roadmap types (API: app/schemas/roadmap.py). */
export type Area = "SALES" | "MERCHANTS" | "MARKETING" | "PLATFORM";
export type ItemStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type Priority = "HIGH" | "NORMAL" | "LOW";

export interface Owner {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface RoadmapItem {
  id: string;
  phaseId: string;
  title: string;
  description?: string | null;
  area: Area;
  status: ItemStatus;
  priority: Priority;
  ownerId?: string | null;
  /** ISO date (yyyy-mm-dd). */
  targetDate?: string | null;
  doneOn?: string | null;
  notes?: string | null;
  link?: string | null;
  sortOrder: number;
  updatedByEmail?: string | null;
  updatedAt: string;
}

export interface Counts {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  todo: number;
}

export interface Phase {
  id: string;
  name: string;
  goal?: string | null;
  /** First day of the month (yyyy-mm-01). */
  startMonth: string;
  endMonth: string;
  sortOrder: number;
  counts: Counts;
  items: RoadmapItem[];
}

export interface Roadmap {
  phases: Phase[];
  owners: Owner[];
  counts: Counts;
  canManage: boolean;
  me: string;
}

export interface PhaseInput {
  name: string;
  goal?: string | null;
  startMonth: string;
  endMonth: string;
}

export interface ItemInput {
  phaseId?: string;
  title?: string;
  description?: string | null;
  area?: Area;
  status?: ItemStatus;
  priority?: Priority;
  ownerId?: string | null;
  targetDate?: string | null;
  notes?: string | null;
  link?: string | null;
}
