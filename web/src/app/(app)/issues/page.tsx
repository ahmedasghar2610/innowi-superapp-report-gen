import { Suspense } from "react";
import { IssuesPage } from "@/features/portfolio/issues-page";

export default function IssuesRoute() {
  return (
    <Suspense>
      <IssuesPage />
    </Suspense>
  );
}
