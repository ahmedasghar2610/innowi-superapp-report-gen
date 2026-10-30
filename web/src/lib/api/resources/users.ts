import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type { Role, UserStatus } from "@/features/auth/types";

/** /users — Super App accounts (Admin / Super Admin only: capability users.manage). */
export interface AppUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  /** Extra access given to this one person (capabilities.USER_GRANTABLE). */
  grantedCapabilities?: string[];
}

export interface CreateUserInput {
  email: string;
  /** Temporary password, typed by the admin (min 8). The person changes it in Settings. */
  password: string;
  firstName?: string;
  lastName?: string;
  role: Exclude<Role, "SUPER_ADMIN">;
}

export type InvitableRole = Exclude<Role, "SUPER_ADMIN">;

export interface Invitation {
  id: string;
  email: string;
  role: InvitableRole;
  invitedBy: string | null;
  expiresAt: string;
  emailedAt: string | null;
  createdAt: string;
}

export interface InvitationCreated {
  invitation: Invitation;
  /** The link to send — shown once, never retrievable again (only a hash is stored). */
  inviteUrl: string;
  emailed: boolean;
}

export interface UpdateUserInput {
  role?: Role;
  status?: UserStatus;
  /** Replaces the person's extra access (only grantable capabilities). */
  grantedCapabilities?: string[];
}

export const users = {
  list(): Promise<PagedEnvelope<AppUser>> {
    return api.getPage<AppUser>("/users", { limit: 100 });
  },
  create(input: CreateUserInput): Promise<AppUser> {
    return api.post<AppUser>("/users", input);
  },
  update(id: string, input: UpdateUserInput): Promise<AppUser> {
    return api.patch<AppUser>(`/users/${id}`, input);
  },
};

/** /invitations — admin side (users.manage). */
export const invitations = {
  list(): Promise<Invitation[]> {
    return api.getList<Invitation>("/invitations");
  },
  create(email: string, role: InvitableRole): Promise<InvitationCreated> {
    return api.post<InvitationCreated>("/invitations", { email, role });
  },
  resend(id: string): Promise<InvitationCreated> {
    return api.post<InvitationCreated>(`/invitations/${id}/resend`);
  },
  revoke(id: string): Promise<void> {
    return api.del(`/invitations/${id}`);
  },
};
