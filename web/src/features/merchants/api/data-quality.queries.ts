"use client";

import { useQuery } from "@tanstack/react-query";
import { dataQuality } from "@/lib/api/resources/data-quality";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type { DataQualityResponse } from "@/features/merchants/types";

/** GET /profiling/data-quality — whole portfolio in one call; cheap on the server. */
export function useDataQuality(options?: QueryOpts<DataQualityResponse>) {
  return useQuery<DataQualityResponse, ApiError>({
    queryKey: queryKeys.profiling.dataQuality(),
    queryFn: () => dataQuality.get(),
    staleTime: 60_000,
    ...options,
  });
}
