import axios from "axios";
import { normalizeError } from "@/lib/api/errors";
import type { AuthUser, LoginPayload } from "./types";

/**
 * Client for THIS app's own `/api/auth/*` route handlers (not the backend
 * directly, and not through the `/api/v1` proxy) — those handlers are what
 * set/read the httpOnly cookies. A separate small Axios instance because
 * these calls carry no `Authorization` header and shouldn't get pulled into
 * the main client's 401→refresh→redirect handling in lib/api/client.ts.
 */
const authClient = axios.create({
  baseURL: "/api/auth",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
  timeout: 20_000,
});

export async function loginRequest(payload: LoginPayload): Promise<{ user: AuthUser }> {
  try {
    const res = await authClient.post<{ user: AuthUser }>("/login", payload);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function meRequest(): Promise<AuthUser> {
  try {
    const res = await authClient.get<AuthUser>("/me");
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function logoutRequest(): Promise<void> {
  try {
    await authClient.post("/logout");
  } catch (err) {
    throw normalizeError(err);
  }
}
