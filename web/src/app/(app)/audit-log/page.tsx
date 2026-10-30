import type { Metadata } from "next";
import { AuditLogPage } from "@/features/audit/components/audit-log-page";

export const metadata: Metadata = {
  title: "Audit Log — Innowi",
};

export default function AuditLogRoute() {
  return <AuditLogPage />;
}
