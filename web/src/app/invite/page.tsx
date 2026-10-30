import { Suspense } from "react";
import type { Metadata } from "next";
import { AcceptInviteForm } from "@/features/auth/accept-invite-form";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "Accept invitation — Innowi",
};

/** Public page the invitation e-mail links to: the person picks their own password. */
export default function InvitePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark size={36} />
          <span className="text-base font-semibold tracking-[-0.01em] text-foreground">Innowi</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Set up your account</h1>
        <p className="mt-1.5 mb-7 text-sm leading-5 text-muted-foreground">
          You&apos;ve been invited to the Innowi Super App. Choose a password to finish.
        </p>
        <Suspense fallback={null}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </div>
  );
}
