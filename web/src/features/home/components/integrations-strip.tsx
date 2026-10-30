import Link from "next/link";
import { CircleCheck, Clock, CircleAlert, Unplug, ChevronRight } from "lucide-react";
import type { IntegrationHealth } from "../data/command-center.mock";

/**
 * 1 · Data & Integrations (Figma node 17:120): a one-line strip with a chip
 * per integration state. Status is always icon + count + label, per the
 * Brand Book; colour reinforces, never carries, the meaning.
 */
export function IntegrationsStrip({ data }: { data: IntegrationHealth }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5">
      <span className="text-xs font-medium leading-4 text-muted-foreground">Data &amp; Integrations</span>
      <Chip icon={CircleCheck} count={data.healthy} label="healthy" className="border border-success-border bg-success-subtle text-success-subtle-foreground" />
      <Chip icon={Clock} count={data.delayed} label="delayed" className="bg-muted text-warning-text" />
      <Chip icon={CircleAlert} count={data.error} label="error" className="bg-destructive-subtle text-text-destructive" />
      <Chip icon={Unplug} count={data.notConfigured} label="not configured" className="bg-muted text-dataq-text" />
      <Link href="/settings/integrations" className="ml-2.5 inline-flex items-center gap-1 text-xs font-medium leading-4 text-primary hover:underline">
        Manage in Settings
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function Chip({
  icon: Icon,
  count,
  label,
  className,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  count: number;
  label: string;
  className: string;
}) {
  return (
    <span className={`inline-flex h-[26px] items-center gap-1.5 rounded-full pl-2.5 pr-3 text-xs leading-4 ${className}`}>
      <Icon className="size-4" aria-hidden />
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}
