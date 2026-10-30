import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/client";

/**
 * Shared option shapes for the feature query/mutation hooks. Every hook types
 * its error as `ApiError` (the client always rejects with it) and owns its
 * `queryKey`/`queryFn` or `mutationFn`, so callers may pass everything else
 * (enabled, select, onSuccess, …). Previously redefined in every *.queries.ts.
 */
export type QueryOpts<T> = Omit<UseQueryOptions<T, ApiError, T>, "queryKey" | "queryFn">;
export type MutationOpts<TData, TVars> = Omit<UseMutationOptions<TData, ApiError, TVars>, "mutationFn">;
