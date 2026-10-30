import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  CreateUserInput,
  Integration,
  ManagedUser,
  MySettings,
  Session,
  SlaSettings,
  SlaTarget,
  UpdateMySettingsInput,
  UpdateUserInput,
  Workspace,
  WorkspaceResponse,
} from "@/features/settings/types";
import type { Project } from "@/features/tickets/types";

/** Settings (modules/settings/router.py) plus the /users API. */
export const settings = {
  me(): Promise<MySettings> {
    return api.get<MySettings>("/settings/me");
  },
  updateMe(input: UpdateMySettingsInput): Promise<MySettings> {
    return api.patch<MySettings>("/settings/me", input);
  },
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return api.post("/auth/change-password", { currentPassword, newPassword });
  },
  sessions(): Promise<Session[]> {
    return api.getList<Session>("/settings/me/sessions");
  },
  endSession(id: string): Promise<void> {
    return api.del(`/settings/me/sessions/${id}`);
  },
  logoutAll(): Promise<void> {
    return api.post("/auth/logout-all");
  },
  workspace(): Promise<WorkspaceResponse> {
    return api.get<WorkspaceResponse>("/settings/workspace");
  },
  saveWorkspace(input: Workspace): Promise<WorkspaceResponse> {
    return api.put<WorkspaceResponse>("/settings/workspace", input);
  },
  sla(): Promise<SlaSettings> {
    return api.get<SlaSettings>("/settings/sla");
  },
  saveSla(targets: SlaTarget[]): Promise<SlaSettings> {
    return api.put<SlaSettings>("/settings/sla", { targets });
  },
  resetSla(): Promise<SlaSettings> {
    return api.del<SlaSettings>("/settings/sla");
  },
  integrations(): Promise<Integration[]> {
    return api.getList<Integration>("/settings/integrations");
  },
  allProjects(): Promise<Project[]> {
    return api.getList<Project>("/ops/projects", { includeArchived: true });
  },
  createProject(name: string): Promise<Project> {
    return api.post<Project>("/ops/projects", { name });
  },
  updateProject(id: string, input: Partial<Pick<Project, "name" | "archived" | "position">>): Promise<Project> {
    return api.patch<Project>(`/ops/projects/${id}`, input);
  },
};

export const users = {
  list(params: { search?: string; limit?: number; page?: number } = {}): Promise<PagedEnvelope<ManagedUser>> {
    return api.getPage<ManagedUser>("/users", { limit: 100, order: "asc", ...params });
  },
  create(input: CreateUserInput): Promise<ManagedUser> {
    return api.post<ManagedUser>("/users", input);
  },
  update(id: string, input: UpdateUserInput): Promise<ManagedUser> {
    return api.patch<ManagedUser>(`/users/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.del(`/users/${id}`);
  },
  resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    return api.post(`/users/${id}/reset-password`);
  },
};
