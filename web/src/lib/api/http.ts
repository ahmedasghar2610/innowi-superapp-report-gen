/**
 * @deprecated Superseded by `./client`. The typed request helpers now live on
 * the `api` object exported from the client:
 *   import { api } from "@/lib/api/client";   // api.get / getList / getPage / post / patch / del
 * This shim re-exports them (also aliased as `http`) for backward compatibility
 * and can be deleted once nothing imports from it.
 */
export { api, api as http } from "./client";
