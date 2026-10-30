"use client";

// Loads /sb-effects.js (entrance animations, sliders, counters, menus) and
// re-scans the page after client-side navigations. The runtime is idempotent
// and also watches the DOM, so calling init() repeatedly is safe.

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";

declare global {
  interface Window {
    SBEffects?: { init: (root?: Element | null) => void; refresh: () => void; destroy: () => void };
  }
}

export default function EffectsRuntime() {
  const pathname = usePathname();

  useEffect(() => {
    window.SBEffects?.init(document.body);
  }, [pathname]);

  return (
    <Script
      src="/sb-effects.js"
      strategy="afterInteractive"
      onLoad={() => window.SBEffects?.init(document.body)}
    />
  );
}
