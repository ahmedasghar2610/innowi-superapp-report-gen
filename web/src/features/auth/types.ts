/**
 * Auth types — mirrors AUTH_RBAC.md §1, §4, §6.
 * Role/UserStatus are the two enums the auth module introduces.
 */

export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MARKETING_MANAGER"
  | "MARKETING_EXECUTIVE"
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE";

export type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

export interface AuthUser {
  id: string;
  email: string;
  /** Present on the auth.user row (AUTH_RBAC.md §6); optional here in case
   *  a future /auth/me response is trimmed down to id/email/role only. */
  firstName?: string;
  lastName?: string;
  role: Role;
  status: UserStatus;
  /** Capabilities granted to this person on top of their role, e.g.
   *  "ticket.manage". Absent on older API builds. */
  grantedCapabilities?: string[];
}

/** POST /auth/login body. */
export interface LoginPayload {
  email: string;
  password: string;
  /**
   * "Remember me". Consumed by OUR /api/auth/login route handler to decide
   * cookie persistence — it is deliberately NOT forwarded to the backend,
   * whose LoginDto sets `extra="forbid"` and would 400 on an unknown key.
   */
  rememberMe?: boolean;
}

/** POST /auth/login response. */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

/** POST /auth/refresh body + response share the pair shape. */
export interface RefreshPayload {
  refreshToken: string;
}

export type RefreshResponse = LoginResponse;

/** POST /auth/change-password body. */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MARKETING_MANAGER: "Marketing Manager",
  MARKETING_EXECUTIVE: "Marketing Executive",
  SALES_MANAGER: "Sales Manager",
  SALES_EXECUTIVE: "Sales Executive",
};

export function userInitials(user: Pick<AuthUser, "firstName" | "lastName" | "email">): string {
  const a = user.firstName?.[0] ?? "";
  const b = user.lastName?.[0] ?? "";
  const initials = (a + b).toUpperCase();
  return initials || user.email?.[0]?.toUpperCase() || "?";
}

export function userDisplayName(user: Pick<AuthUser, "firstName" | "lastName" | "email">): string {
  const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return full || user.email;
}
