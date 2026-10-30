import { AppShell } from "@/components/layout/app-shell";

/** Wraps every in-app route in the shared shell (sidebar + top bar). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
