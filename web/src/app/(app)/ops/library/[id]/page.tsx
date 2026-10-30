import { Suspense } from "react";
import { LibraryPageView } from "@/features/library/components/library-page-view";

/** /ops/library/[id] — one Library page. */
export default async function OpsLibraryPageView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <LibraryPageView pageId={id} />
    </Suspense>
  );
}
