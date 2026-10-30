/**
 * @deprecated Superseded by `./client`. Kept as a compatibility shim so any
 * lingering import keeps working — import the client directly instead:
 *   import { apiClient, api } from "@/lib/api/client";
 * You can safely delete this file once nothing imports from it.
 */
export { apiClient, apiClient as api } from "./client";
