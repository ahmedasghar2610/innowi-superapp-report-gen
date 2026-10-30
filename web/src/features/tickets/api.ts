"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications, tickets } from "@/lib/api/resources/tickets";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  ActivityItem,
  AppNotification,
  CatchUp,
  CommentInput,
  CreateTicketInput,
  SavedView,
  Person,
  Project,
  Ticket,
  TicketCatalog,
  TicketCounts,
  TicketCountsQuery,
  TicketAttachment,
  TicketDetail,
  TicketListQuery,
  WatchersResponse,
  TeamReport,
  TeamReportQuery,
  UpdateTicketInput,
} from "./types";

/* Ticket query + mutation hooks. Every write invalidates the ticket lists and
   counts (the list, board, "Assigned to me" and the merchant tab all read
   them) and refreshes the ticket's own detail + activity. */

export function useTickets(query?: TicketListQuery, options?: QueryOpts<PagedEnvelope<Ticket>>) {
  return useQuery<PagedEnvelope<Ticket>, ApiError>({
    queryKey: queryKeys.tickets.list(query ?? {}),
    queryFn: () => tickets.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useTicketCounts(query?: TicketCountsQuery, options?: QueryOpts<TicketCounts>) {
  return useQuery<TicketCounts, ApiError>({
    queryKey: queryKeys.tickets.counts(query ?? {}),
    queryFn: () => tickets.counts(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useTicket(key: string | undefined, options?: QueryOpts<TicketDetail>) {
  return useQuery<TicketDetail, ApiError>({
    queryKey: queryKeys.tickets.detail(key ?? ""),
    queryFn: () => tickets.get(key as string),
    enabled: !!key,
    ...options,
  });
}

export function useTicketActivity(key: string | undefined) {
  return useQuery<ActivityItem[], ApiError>({
    queryKey: queryKeys.tickets.activity(key ?? ""),
    queryFn: () => tickets.activity(key as string),
    enabled: !!key,
  });
}

export function useTeamReport(query?: TeamReportQuery) {
  return useQuery<TeamReport, ApiError>({
    queryKey: queryKeys.tickets.report(query ?? {}),
    queryFn: () => tickets.report(query),
    placeholderData: keepPreviousData,
  });
}

/** Reference data changes rarely — cache it for the session. */
export function useTicketCatalog() {
  return useQuery<TicketCatalog, ApiError>({
    queryKey: queryKeys.tickets.catalog(),
    queryFn: () => tickets.catalog(),
    staleTime: Infinity,
  });
}

export function useTicketPeople() {
  return useQuery<Person[], ApiError>({
    queryKey: queryKeys.tickets.people(),
    queryFn: () => tickets.people(),
    staleTime: 5 * 60_000,
  });
}

export function useTicketProjects() {
  return useQuery<Project[], ApiError>({
    queryKey: queryKeys.tickets.projects(),
    queryFn: () => tickets.projects(),
    staleTime: 5 * 60_000,
  });
}

function useInvalidateTicket() {
  const qc = useQueryClient();
  return (key?: string, fresh?: TicketDetail) => {
    qc.invalidateQueries({ queryKey: queryKeys.tickets.lists() });
    qc.invalidateQueries({ queryKey: [...queryKeys.tickets.all, "counts"] });
    if (key) {
      if (fresh) qc.setQueryData(queryKeys.tickets.detail(key), fresh);
      else qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(key) });
      qc.invalidateQueries({ queryKey: queryKeys.tickets.activity(key) });
    }
  };
}

export function useCreateTicket() {
  const invalidate = useInvalidateTicket();
  return useMutation<TicketDetail, ApiError, CreateTicketInput>({
    mutationFn: (input) => tickets.create(input),
    onSuccess: (t) => invalidate(t.key, t),
  });
}

export function useUpdateTicket(key: string) {
  const invalidate = useInvalidateTicket();
  return useMutation<TicketDetail, ApiError, UpdateTicketInput>({
    mutationFn: (input) => tickets.update(key, input),
    onSuccess: (t) => invalidate(key, t),
  });
}

/** Status change from a card/row where the key varies per call (Board). */
export function useMoveTicket() {
  const invalidate = useInvalidateTicket();
  return useMutation<TicketDetail, ApiError, { key: string; input: UpdateTicketInput }>({
    mutationFn: ({ key, input }) => tickets.update(key, input),
    onSuccess: (t, { key }) => invalidate(key, t),
  });
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTicket();
  return useMutation<void, ApiError, string>({
    mutationFn: (key) => tickets.remove(key),
    onSuccess: (_, key) => {
      qc.removeQueries({ queryKey: queryKeys.tickets.detail(key) });
      invalidate();
    },
  });
}

export function useAddSubtask(key: string) {
  const invalidate = useInvalidateTicket();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (title) => tickets.addSubtask(key, title),
    onSuccess: () => invalidate(key),
  });
}

/** Ticking a sub-task updates the checkbox immediately (optimistic), and
 *  rolls back if the API refuses. */
export function useUpdateSubtask(key: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTicket();
  type Vars = { id: string; title?: string; done?: boolean };
  return useMutation<unknown, ApiError, Vars, { previous?: TicketDetail }>({
    mutationFn: ({ id, ...input }) => tickets.updateSubtask(id, input),
    onMutate: async ({ id, title, done }) => {
      const detailKey = queryKeys.tickets.detail(key);
      await qc.cancelQueries({ queryKey: detailKey });
      const previous = qc.getQueryData<TicketDetail>(detailKey);
      if (previous) {
        const subtasks = previous.subtasks.map((s) =>
          s.id === id ? { ...s, ...(title !== undefined ? { title } : {}), ...(done !== undefined ? { done } : {}) } : s,
        );
        qc.setQueryData<TicketDetail>(detailKey, {
          ...previous,
          subtasks,
          subtasksDone: subtasks.filter((s) => s.done).length,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.tickets.detail(key), ctx.previous);
    },
    onSettled: () => invalidate(key),
  });
}

export function useRemoveSubtask(key: string) {
  const invalidate = useInvalidateTicket();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (id) => tickets.removeSubtask(id),
    onSuccess: () => invalidate(key),
  });
}

export function useAddComment(key: string) {
  const invalidate = useInvalidateTicket();
  return useMutation<unknown, ApiError, CommentInput>({
    mutationFn: (input) => tickets.comment(key, input),
    onSuccess: () => invalidate(key),
  });
}

/* ---- Library links ----------------------------------------------------- */
export function useLibraryLinks(key: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(key) });
  const link = useMutation<void, ApiError, string>({ mutationFn: (pageId) => tickets.linkPage(key, pageId), onSuccess: done });
  const unlink = useMutation<void, ApiError, string>({ mutationFn: (pageId) => tickets.unlinkPage(key, pageId), onSuccess: done });
  return { link, unlink };
}

/* ---- saved views ------------------------------------------------------- */
const viewsKey = [...queryKeys.tickets.all, "views"] as const;

export function useSavedViews() {
  return useQuery<SavedView[], ApiError>({ queryKey: viewsKey, queryFn: () => tickets.views() });
}

export function useSaveView() {
  const qc = useQueryClient();
  return useMutation<SavedView, ApiError, { name: string; filters: Record<string, unknown> }>({
    mutationFn: ({ name, filters }) => tickets.saveView(name, filters),
    onSuccess: () => qc.invalidateQueries({ queryKey: viewsKey }),
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({ mutationFn: (id) => tickets.deleteView(id), onSuccess: () => qc.invalidateQueries({ queryKey: viewsKey }) });
}

/* ---- catch-up / handover ----------------------------------------------- */
const catchUpKey = [...queryKeys.tickets.all, "catch-up"] as const;

export function useCatchUp() {
  return useQuery<CatchUp, ApiError>({ queryKey: catchUpKey, queryFn: () => tickets.catchUp(), staleTime: 60_000 });
}

export function useDismissCatchUp() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({ mutationFn: () => tickets.dismissCatchUp(), onSuccess: () => qc.invalidateQueries({ queryKey: catchUpKey }) });
}

export function useHandover(enabled: boolean) {
  return useQuery<{ since: string; text: string }, ApiError>({
    queryKey: [...queryKeys.tickets.all, "handover"],
    queryFn: () => tickets.handover(),
    enabled,
    staleTime: 0,
  });
}


/* ---- attachments ------------------------------------------------------- */
function useRefreshDetail(key: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(key) });
    qc.invalidateQueries({ queryKey: queryKeys.tickets.activity(key) });
  };
}

export function useUploadAttachment(key: string) {
  const refresh = useRefreshDetail(key);
  return useMutation<TicketAttachment, ApiError, File>({ mutationFn: (file) => tickets.upload(key, file), onSuccess: refresh });
}

export function useRemoveAttachment(key: string) {
  const refresh = useRefreshDetail(key);
  return useMutation<void, ApiError, string>({ mutationFn: (id) => tickets.removeAttachment(id), onSuccess: refresh });
}

/* ---- watchers ---------------------------------------------------------- */
export function useWatchers(key: string) {
  const refresh = useRefreshDetail(key);
  const qc = useQueryClient();
  const done = () => {
    refresh();
    qc.invalidateQueries({ queryKey: queryKeys.tickets.lists() });
  };
  const watch = useMutation<WatchersResponse, ApiError, string | undefined>({ mutationFn: (userId) => tickets.watch(key, userId), onSuccess: done });
  const unwatch = useMutation<WatchersResponse, ApiError, string | undefined>({ mutationFn: (userId) => tickets.unwatch(key, userId), onSuccess: done });
  return { watch, unwatch };
}

/* ---- notification bell ------------------------------------------------- */
export function useNotifications(enabled = true) {
  return useQuery<{ data: AppNotification[]; unread: number }, ApiError>({
    queryKey: queryKeys.notifications.all,
    queryFn: () => notifications.list({ limit: 30 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { ids?: string[]; all?: boolean }>({
    mutationFn: (input) => notifications.markRead(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}
