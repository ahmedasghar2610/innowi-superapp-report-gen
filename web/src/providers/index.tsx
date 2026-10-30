"use client";

import { QueryProvider } from "./query-provider";
import { ToastProvider } from "@/components/ui/toast";
import { MiaProvider } from "@/features/mia/mia-context";
import { AuthProvider } from "@/features/auth/auth-context";

/** Composes all client-side providers. Add future providers (theme, auth) here. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <QueryProvider>
        <ToastProvider>
          <MiaProvider>{children}</MiaProvider>
        </ToastProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
