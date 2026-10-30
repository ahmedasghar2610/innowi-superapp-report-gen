import { Gift } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function RewardsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Rewards</h1>
      <p className="mt-1 text-table text-muted-foreground">Loyalty and rewards program management across your merchants.</p>
      <div className="mt-5">
        <ComingSoon
          title="Rewards — currently being worked on"
          description="This section is currently being worked on. Check back soon."
          icon={Gift}
        />
      </div>
    </div>
  );
}
