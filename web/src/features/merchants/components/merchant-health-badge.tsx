import { Badge } from "@/components/ui";
import { accountHealth as healthLabels } from "@/lib/enums";
import type { AccountHealth } from "@/features/merchants/types";

/** Account-health status chip (dot + label). "—" when unset. */
export function MerchantHealthBadge({ value }: { value: AccountHealth | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const meta = healthLabels[value];
  return (
    <Badge tone={meta?.tone ?? "neutral"}>
      {meta?.label ?? value}
    </Badge>
  );
}
