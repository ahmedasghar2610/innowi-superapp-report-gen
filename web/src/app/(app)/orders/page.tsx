import { ShoppingCart } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function OrdersPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Orders</h1>
      <p className="mt-1 text-table text-muted-foreground">Order volume, sales and channel mix across your merchants.</p>
      <div className="mt-5">
        <ComingSoon title="Orders — currently being worked on" icon={ShoppingCart} />
      </div>
    </div>
  );
}
