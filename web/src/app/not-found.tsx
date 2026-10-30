import Link from "next/link";
import { Button } from "@/components/ui";

/** Global not-found. Unbuilt module routes land here until their phase ships. */
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <div className="text-table font-semibold text-muted-foreground">404</div>
        <h1 className="mb-2 mt-1.5 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="text-table leading-relaxed text-muted-foreground">
          This screen isn&apos;t part of the current build yet. The Merchant Profiling module is being
          delivered in phases.
        </p>
        <Link href="/" className="mt-4 inline-block">
          <Button variant="default">Back to Home</Button>
        </Link>
      </div>
    </div>
  );
}
