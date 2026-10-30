import { CreditCard } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function PaymentsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Payments</h1>
      <p className="mt-1 text-table text-muted-foreground">Payments, invoicing and billing across your merchants.</p>
      <div className="mt-5">
        <ComingSoon
          title="Payments — currently being worked on"
          description="This section is currently being worked on. Check back soon."
          icon={CreditCard}
        />
      </div>
    </div>
  );
}
