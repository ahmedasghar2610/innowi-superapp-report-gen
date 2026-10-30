"use client";

import { useCallback } from "react";
import { useAuth } from "./auth-context";
import { hasCapability, type Capability } from "./capabilities";

/**
 * `const can = useCan(); if (can("subscription.write")) …`
 * Reads the signed-in user's role (and per-person grants) from AuthContext. While the user is still
 * hydrating (`undefined`) every capability is false, so write affordances
 * appear only once the role is known — never flash-then-vanish.
 */
export function useCan() {
  const { user } = useAuth();
  const grants = user?.grantedCapabilities;
  return useCallback(
    (capability: Capability) => hasCapability(user?.role, capability, grants),
    [user?.role, grants],
  );
}
