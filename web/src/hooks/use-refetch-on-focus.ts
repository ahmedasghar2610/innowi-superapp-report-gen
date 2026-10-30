"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Re-fetch these queries when the user comes back to this tab.
 *
 * The app turns `refetchOnWindowFocus` off globally (lib/query/query-client.ts)
 * to avoid noise, but some data is changed in *another* tab — a site's /admin
 * visual editor writes hours / phone back to the merchant Profile and the
 * website's answers. Screens that show that data opt in with this hook.
 */
export function useRefetchOnFocus(keys: QueryKey[]) {
  const qc = useQueryClient();
  const signature = JSON.stringify(keys);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      for (const key of JSON.parse(signature) as QueryKey[]) void qc.invalidateQueries({ queryKey: key });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [qc, signature]);
}
