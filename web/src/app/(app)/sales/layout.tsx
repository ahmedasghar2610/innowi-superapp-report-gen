import { SalesShell } from "@/features/sales/components/sales-shell";

/** Every /sales route shares one access check and the manager's "Showing" choice. */
export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return <SalesShell>{children}</SalesShell>;
}
