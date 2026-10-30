import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  ActivityItem,
  AppNotification,
  CatchUp,
  CommentInput,
  CreateTicketInput,
  SavedView,
  Person,
  Project,
  Subtask,
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
} from "@/features/tickets/types";
import { buildQuery } from "../client";

/**
 * Ops CRM tickets (innowi-superapp-api-fastapi modules/ops/router.py).
 * Tickets are addressed by key ("OPS-1042").
 */
export const tickets = {
  list(query?: TicketListQuery): Promise<PagedEnvelope<Ticket>> {
    return api.getPage<Ticket>("/ops/tickets", query);
  },
  counts(query?: TicketCountsQuery): Promise<TicketCounts> {
    return api.get<TicketCounts>("/ops/tickets/counts", query);
  },
  get(key: string): Promise<TicketDetail> {
    return api.get<TicketDetail>(`/ops/tickets/${encodeURIComponent(key)}`);
  },
  create(input: CreateTicketInput): Promise<TicketDetail> {
    return api.post<TicketDetail>("/ops/tickets", input);
  },
  update(key: string, input: UpdateTicketInput): Promise<TicketDetail> {
    return api.patch<TicketDetail>(`/ops/tickets/${encodeURIComponent(key)}`, input);
  },
  remove(key: string): Promise<void> {
    return api.del(`/ops/tickets/${encodeURIComponent(key)}`);
  },

  addSubtask(key: string, title: string): Promise<Subtask> {
    return api.post<Subtask>(`/ops/tickets/${encodeURIComponent(key)}/subtasks`, { title });
  },
  updateSubtask(id: string, input: { title?: string; done?: boolean }): Promise<Subtask> {
    return api.patch<Subtask>(`/ops/subtasks/${id}`, input);
  },
  removeSubtask(id: string): Promise<void> {
    return api.del(`/ops/subtasks/${id}`);
  },

  activity(key: string): Promise<ActivityItem[]> {
    return api.getList<ActivityItem>(`/ops/tickets/${encodeURIComponent(key)}/activity`);
  },
  comment(key: string, input: CommentInput): Promise<unknown> {
    return api.post(`/ops/tickets/${encodeURIComponent(key)}/comments`, input);
  },
  linkPage(key: string, pageId: string): Promise<void> {
    return api.post(`/ops/tickets/${encodeURIComponent(key)}/library`, { pageId });
  },
  unlinkPage(key: string, pageId: string): Promise<void> {
    return api.del(`/ops/tickets/${encodeURIComponent(key)}/library/${pageId}`);
  },
  views(): Promise<SavedView[]> {
    return api.getList<SavedView>("/ops/views");
  },
  saveView(name: string, filters: Record<string, unknown>): Promise<SavedView> {
    return api.post<SavedView>("/ops/views", { name, filters });
  },
  deleteView(id: string): Promise<void> {
    return api.del(`/ops/views/${id}`);
  },
  catchUp(): Promise<CatchUp> {
    return api.get<CatchUp>("/ops/catch-up");
  },
  dismissCatchUp(): Promise<void> {
    return api.post("/ops/catch-up/dismiss");
  },
  handover(since?: string): Promise<{ since: string; text: string }> {
    return api.get("/ops/handover", since ? { since } : undefined);
  },

  attachments(key: string): Promise<TicketAttachment[]> {
    return api.getList<TicketAttachment>(`/ops/tickets/${encodeURIComponent(key)}/attachments`);
  },
  upload(key: string, file: File): Promise<TicketAttachment> {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<TicketAttachment>(`/ops/tickets/${encodeURIComponent(key)}/attachments`, form);
  },
  removeAttachment(id: string): Promise<void> {
    return api.del(`/ops/attachments/${id}`);
  },
  watch(key: string, userId?: string): Promise<WatchersResponse> {
    return api.post<WatchersResponse>(`/ops/tickets/${encodeURIComponent(key)}/watchers`, userId ? { userId } : {});
  },
  unwatch(key: string, userId = "me"): Promise<WatchersResponse> {
    return api.del<WatchersResponse>(`/ops/tickets/${encodeURIComponent(key)}/watchers/${userId}`);
  },

  report(query?: TeamReportQuery): Promise<TeamReport> {
    return api.get<TeamReport>("/ops/reports", query);
  },
  /** Same-origin URL for the CSV export (the /api/v1 proxy adds the auth header). */
  exportUrl(query?: TicketListQuery): string {
    return api.fileUrl(`/ops/tickets/export${buildQuery(query)}`);
  },

  catalog(): Promise<TicketCatalog> {
    return api.get<TicketCatalog>("/ops/catalog");
  },
  people(): Promise<Person[]> {
    return api.getList<Person>("/ops/people");
  },
  projects(): Promise<Project[]> {
    return api.getList<Project>("/ops/projects");
  },
};

/** The notification bell (modules/ops/ticket_extras.py). */
export const notifications = {
  list(params: { unread?: boolean; limit?: number } = {}): Promise<{ data: AppNotification[]; unread: number }> {
    return api.get("/ops/notifications", params);
  },
  markRead(input: { ids?: string[]; all?: boolean }): Promise<void> {
    return api.post("/ops/notifications/read", input);
  },
};
