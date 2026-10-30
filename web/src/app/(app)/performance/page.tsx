import { TrendingUp } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function PerformancePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Performance</h1>
      <p className="mt-1 text-table text-muted-foreground">Performance reporting and trends across your merchants.</p>
      <div className="mt-5">
        <ComingSoon
          title="Performance — currently being worked on"
          description="This section is currently being worked on. Check back soon."
          icon={TrendingUp}
        />
      </div>
    </div>
  );
}
