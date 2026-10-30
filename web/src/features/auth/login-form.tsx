"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, ArrowRight, TriangleAlert } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { fieldErrorsFrom, isApiError } from "@/lib/api/client";
import { loginSchema, loginDefaults, type LoginFormValues } from "./login.schema";
import { loginRequest } from "./auth-api";
import { useAuth } from "./auth-context";

const FIELD_NAMES: (keyof LoginFormValues)[] = ["email", "password"];

/** Only allow redirecting back into the app, never off-site or to /login itself. */
function safeNext(raw: string | null): string {
  // No explicit destination: "/" with ?start=1 applies the person's start page
  // (Settings → Profile); a plain "/" is always the assistant.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/?start=1";
  return raw;
}

/**
 * Sign-in form. POSTs to our own /api/auth/login route handler (which sets
 * httpOnly cookies — see AUTH_RBAC.md §4), then hydrates the auth context
 * with the returned user and redirects to `?next=` or the home screen.
 *
 * Styled from the app's semantic tokens, which ARE the Brand Book: every
 * value in globals.css was diffed against the Innowi Super Admin DS Figma
 * file's Semantic tokens table and all 38 light/dark values match. The inline
 * hex this file used to carry included five Tailwind defaults that were never
 * Innowi colours, and it kept the screen locked to light mode.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, setUser } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // If GET /auth/me (via AuthProvider, on mount) comes back with a real user,
  // the session is genuinely still valid — send them into the app instead of
  // showing the sign-in form again. This is deliberately a real API check,
  // not "does a refresh-token cookie exist": middleware used to redirect
  // /login → / on cookie presence alone, which bounced a user with a stale
  // cookie back here in a loop with no way to actually sign in. `user` stays
  // `undefined` while /auth/me is still resolving, so this only fires once
  // we know for sure.
  useEffect(() => {
    if (user) {
      router.replace(safeNext(searchParams.get("next")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: loginDefaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { user } = await loginRequest(values);
      setUser(user);
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401) {
          setFormError("Incorrect email or password.");
          return;
        }
        if (err.isValidation) {
          const fieldErrors = fieldErrorsFrom(err, FIELD_NAMES);
          let matched = false;
          for (const [field, message] of Object.entries(fieldErrors)) {
            setError(field as keyof LoginFormValues, { message });
            matched = true;
          }
          if (!matched) setFormError(err.messages.join(" "));
          return;
        }
        setFormError(err.messages.join(" ") || "Something went wrong. Please try again.");
        return;
      }
      setFormError("Something went wrong. Please try again.");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-warning-soft px-3.5 py-3 text-table leading-5 text-warning-text"
        >
          <TriangleAlert className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
          {formError}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-table font-medium text-accent-foreground"
        >
          Email
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@innowi.com"
          aria-invalid={!!errors.email}
          className="h-11 rounded-lg text-sm"
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-table text-destructive">{errors.email.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="password"
            className="text-table font-medium text-accent-foreground"
          >
            Password
          </label>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!errors.password}
            className="h-11 rounded-lg pr-10 text-sm [&::-ms-reveal]:hidden [&::-ms-clear]:hidden [&::-webkit-credentials-auto-fill-button]:hidden"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-accent-foreground"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password ? (
          <p className="text-table text-destructive">{errors.password.message}</p>
        ) : null}
      </div>

      {/*
        Remember me — controls how long the browser keeps the session, NOT
        whether it saves the password. Ticked, the auth cookies get a 30-day
        maxAge and survive closing the browser; unticked they are session
        cookies and the next visit lands back here. Defaults to unticked, so a
        shared machine never silently holds a month-long session.

        (Chrome's own "save password?" prompt is separate and can't be turned
        off by a site — browsers ignore autocomplete="off" on password fields
        by design. That is a browser setting, not an app one.)
      */}
      <label
        htmlFor="rememberMe"
        className="-mt-1 flex w-fit cursor-pointer select-none items-center gap-2 text-table text-accent-foreground"
      >
        <input
          id="rememberMe"
          type="checkbox"
          className="size-4 cursor-pointer rounded border-border accent-primary"
          {...register("rememberMe")}
        />
        Keep me signed in on this device
      </label>

      <Button
        type="submit"
        variant="default"
        loading={isSubmitting}
        className="mt-1 h-11 w-full rounded-lg text-sm font-semibold"
      >
        {!isSubmitting && (
          <>
            Sign in
            <ArrowRight className="size-4" />
          </>
        )}
        {isSubmitting && "Signing in…"}
      </Button>
    </form>
  );
}
