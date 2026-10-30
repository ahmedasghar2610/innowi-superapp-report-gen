import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/login-form";
import { BrandMark as Mark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "Sign in — Innowi",
};

/**
 * Sign-in screen.
 *
 * Built from the same semantic tokens as the rest of the app. This file used
 * to hardcode the Brand Book's hex values inline, on the theory that the
 * tokens were "close but not identical" — they are in fact identical. Every
 * token in globals.css was diffed against the Innowi Super Admin DS Figma
 * file's Color page (Semantic tokens table) and all 38 light/dark values
 * match the ramp steps it specifies.
 *
 * What the inline hex actually cost: five of the values weren't Innowi's at
 * all but Tailwind's default grey/red ramp (#6B7280, #E5E7EB, #D1D5DB,
 * #DC2626, #9E1B1B), and inline styles can't respond to `.dark`, so this
 * screen stayed light while the rest of the app themed.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8">
          <BrandMark />
        </div>

        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">
          Sign in
        </h1>
        <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
          Welcome back — enter your credentials to access the portal.
        </p>

        <div className="mt-7">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-8 text-center text-xs leading-4 text-muted-foreground">
          Innowi Marketing Operations Portal
        </p>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <Mark size={36} />
      <span className="text-base font-semibold tracking-[-0.01em] text-foreground">
        Innowi
      </span>
    </div>
  );
}
