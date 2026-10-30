import { Users } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function GuestsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Guests</h1>
      <p className="mt-1 text-table text-muted-foreground">Guest acquisition, repeat behaviour and segments.</p>
      <div className="mt-5">
        <ComingSoon title="Guests — currently being worked on" icon={Users} />
      </div>
    </div>
  );
}
