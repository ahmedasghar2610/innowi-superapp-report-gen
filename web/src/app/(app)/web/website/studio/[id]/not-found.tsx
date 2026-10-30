import Link from "next/link";
import { Button } from "@/components/ui";

// Ported from site-builder-source-for-developer/app/studio/[id]/not-found.tsx,
// restyled to match this app's not-found conventions (src/app/not-found.tsx)
// and pointed back at the Website module instead of the standalone tool's
// /clone and /seo routes.
export default function StudioNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <div className="text-table font-semibold text-muted-foreground">404</div>
        <h1 className="mb-2 mt-1.5 text-2xl font-semibold text-foreground">This clone has expired</h1>
        <p className="text-table leading-relaxed text-muted-foreground">
          Edited sites that aren&apos;t saved to My Clones are kept for 24 hours after a clone run. Run the
          clone again, or open a saved entry from My Clones, to get a fresh workspace.
        </p>
        <Link href="/web/website" className="mt-4 inline-block">
          <Button variant="default">Back to Website</Button>
        </Link>
      </div>
    </div>
  );
}
