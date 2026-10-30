import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";

/**
 * Factory so server and client each get their own QueryClient instance.
 *
 * Error handling: the retry policy skips client errors (4xx) so a
 * 400/404/409 surfaces immediately instead of being retried. Per-call feedback
 * (ErrorState, toasts, inline field errors) is layered on in the hooks and
 * components — we deliberately do NOT log via `console.error` here, because
 * Next's dev overlay surfaces every console.error as a red error, which would
 * flag routine, already-handled query failures. Add a real reporter (Sentry,
 * etc.) via QueryCache/MutationCache `onError` when you want centralized logging.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Don't retry client errors (validation / not-found / conflict).
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
