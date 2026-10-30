import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  /**
   * Ticked: the session survives closing the browser (30 days).
   * Unticked: session cookies only, so the next visit asks for credentials.
   * Defaults to unticked — a shared machine should not silently keep a
   * month-long session because nobody looked at the checkbox.
   */
  rememberMe: z.boolean(),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const loginDefaults: LoginFormValues = { email: "", password: "", rememberMe: false };
