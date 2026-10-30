import { ShieldCheck, ShieldAlert, ShieldQuestion, Sparkles, Ban } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { VerificationConfidence } from "@/features/merchants/types";

/**
 * Attestation chip — the Super App PRD §37 confidence chip. One entry per
 * wire value of `VerificationConfidence` (Step 9 taxonomy); "Missing" is an
 * empty value and is rendered by the field itself, not by this chip. Must
 * stay aligned with `VERIFICATION_CONFIDENCE` in types/enums.ts.
 */
const CONFIG: Record<VerificationConfidence, { tone: BadgeTone; label: string; icon: LucideIcon; hint: string }> = {
  CONFIRMED: { tone: "success", label: "Confirmed", icon: ShieldCheck, hint: "A person verified this value against a source." },
  INFERRED: { tone: "accent", label: "Inferred", icon: Sparkles, hint: "Derived from a source (site, workbook note) — plausible, not confirmed." },
  UNVERIFIED: { tone: "neutral", label: "Unverified", icon: ShieldQuestion, hint: "Entered, but nobody has attested to it yet." },
  OUTDATED: { tone: "warning", label: "Outdated", icon: ShieldAlert, hint: "Was confirmed; marked stale. Re-verify with the owner." },
  PLACEHOLDER: { tone: "danger", label: "Placeholder", icon: Ban, hint: "Known not to be real data. Excluded from completeness; never publish." },
};

export function ConfidenceChip({
  confidence,
  className,
}: {
  confidence: VerificationConfidence;
  className?: string;
}) {
  const { tone, label, icon: Icon, hint } = CONFIG[confidence] ?? CONFIG.UNVERIFIED;
  return (
    <Badge tone={tone} className={className} title={`${label} — ${hint}`} icon={Icon}>
      {label}
    </Badge>
  );
}
