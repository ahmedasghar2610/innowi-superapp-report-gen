"use client";

import { useEffect, useRef } from "react";

/**
 * A third-party reviews widget (Trustindex, Elfsight, …) pasted into the Super
 * App as embed code. HTML set through innerHTML never runs its <script> tags,
 * so each one is re-created to make the browser load it.
 *
 * The code is entered by Innowi staff with website edit rights — the same
 * people who publish everything else on the page.
 */
export default function ReviewsWidget({ code }) {
  const ref = useRef(null);

  useEffect(() => {
    const host = ref.current;
    if (!host || !code) return;
    host.innerHTML = code;
    host.querySelectorAll("script").forEach((old) => {
      const script = document.createElement("script");
      for (const { name, value } of Array.from(old.attributes)) script.setAttribute(name, value);
      script.text = old.text;
      old.replaceWith(script);
    });
    return () => {
      host.innerHTML = "";
    };
  }, [code]);

  // data-sb-embed carries the code into a saved /admin page, where
  // public/sb-site.js injects it the same way (React isn't running there).
  return <div ref={ref} data-sb-embed={code} className="min-h-[120px]" />;
}
