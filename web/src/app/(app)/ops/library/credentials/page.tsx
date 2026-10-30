"use client";

import { KeyRound } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { CredentialLog, CredentialsPanel } from "@/features/library/components/credentials-panel";

/** /ops/library/credentials — the credentials vault (marketing staff only; never the sales roles). */
export default function OpsCredentialsPage() {
  const { user } = useAuth();
  const can = useCan();
  if (user === undefined) return null;
  if (!can("credentials.view")) {
    return (
      <Card>
        <EmptyState icon={KeyRound} title="No access to the vault" description="The credentials vault is for the marketing team. Ask an Admin if you need a login." />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <CredentialsPanel title="Credentials vault" />
      <CredentialLog />
    </div>
  );
}
