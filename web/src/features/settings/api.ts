"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settings, users } from "@/lib/api/resources/settings";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { Project } from "@/features/tickets/types";
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
} from "./types";

export function useMySettings() {
  return useQuery<MySettings, ApiError>({ queryKey: queryKeys.settings.me(), queryFn: () => settings.me() });
}

export function useUpdateMySettings() {
  const qc = useQueryClient();
  return useMutation<MySettings, ApiError, UpdateMySettingsInput>({
    mutationFn: (input) => settings.updateMe(input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.settings.me(), data);
      qc.invalidateQueries({ queryKey: queryKeys.tickets.people() });
    },
  });
}

export function useChangePassword() {
  return useMutation<void, ApiError, { currentPassword: string; newPassword: string }>({
    mutationFn: ({ currentPassword, newPassword }) => settings.changePassword(currentPassword, newPassword),
  });
}

export function useSessions() {
  return useQuery<Session[], ApiError>({ queryKey: queryKeys.settings.sessions(), queryFn: () => settings.sessions() });
}

export function useEndSession() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => settings.endSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.settings.sessions() }),
  });
}

export function useLogoutAll() {
  return useMutation<void, ApiError, void>({ mutationFn: () => settings.logoutAll() });
}

export function useWorkspace() {
  return useQuery<WorkspaceResponse, ApiError>({ queryKey: queryKeys.settings.workspace(), queryFn: () => settings.workspace() });
}

export function useSaveWorkspace() {
  const qc = useQueryClient();
  return useMutation<WorkspaceResponse, ApiError, Workspace>({
    mutationFn: (input) => settings.saveWorkspace(input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.settings.workspace(), data);
      // Timezone / work week move every SLA due time shown in the app.
      qc.invalidateQueries({ queryKey: queryKeys.settings.sla() });
      qc.invalidateQueries({ queryKey: queryKeys.tickets.all });
    },
  });
}

export function useSlaSettings() {
  return useQuery<SlaSettings, ApiError>({ queryKey: queryKeys.settings.sla(), queryFn: () => settings.sla() });
}

function useSlaMutation<V>(fn: (v: V) => Promise<SlaSettings>) {
  const qc = useQueryClient();
  return useMutation<SlaSettings, ApiError, V>({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.settings.sla(), data);
      qc.invalidateQueries({ queryKey: queryKeys.tickets.all });
    },
  });
}

export const useSaveSla = () => useSlaMutation<SlaTarget[]>((t) => settings.saveSla(t));
export const useResetSla = () => useSlaMutation<void>(() => settings.resetSla());

export function useIntegrations() {
  return useQuery<Integration[], ApiError>({ queryKey: queryKeys.settings.integrations(), queryFn: () => settings.integrations() });
}

const allProjectsKey = [...queryKeys.settings.all, "projects"] as const;

export function useAllProjects() {
  return useQuery<Project[], ApiError>({ queryKey: allProjectsKey, queryFn: () => settings.allProjects() });
}

function useProjectsInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: allProjectsKey });
    qc.invalidateQueries({ queryKey: queryKeys.tickets.projects() });
  };
}

export function useCreateProject() {
  const done = useProjectsInvalidate();
  return useMutation<Project, ApiError, string>({ mutationFn: (name) => settings.createProject(name), onSuccess: done });
}

export function useUpdateProject() {
  const done = useProjectsInvalidate();
  return useMutation<Project, ApiError, { id: string } & Partial<Pick<Project, "name" | "archived" | "position">>>({
    mutationFn: ({ id, ...input }) => settings.updateProject(id, input),
    onSuccess: done,
  });
}

export function useUsers(enabled = true) {
  return useQuery<ManagedUser[], ApiError>({
    queryKey: queryKeys.settings.users(),
    queryFn: () => users.list().then((r) => r.data),
    enabled,
  });
}

function useUsersInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.settings.users() });
    qc.invalidateQueries({ queryKey: queryKeys.tickets.people() });
  };
}

export function useCreateUser() {
  const done = useUsersInvalidate();
  return useMutation<ManagedUser, ApiError, CreateUserInput>({ mutationFn: (input) => users.create(input), onSuccess: done });
}

export function useUpdateUser() {
  const done = useUsersInvalidate();
  return useMutation<ManagedUser, ApiError, { id: string } & UpdateUserInput>({
    mutationFn: ({ id, ...input }) => users.update(id, input),
    onSuccess: done,
  });
}

export function useDeleteUser() {
  const done = useUsersInvalidate();
  return useMutation<void, ApiError, string>({ mutationFn: (id) => users.remove(id), onSuccess: done });
}

export function useResetPassword() {
  return useMutation<{ temporaryPassword: string }, ApiError, string>({ mutationFn: (id) => users.resetPassword(id) });
}
