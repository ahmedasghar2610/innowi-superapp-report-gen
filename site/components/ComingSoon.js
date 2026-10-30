/**
 * Shown at a site's URL while it isn't public (anything but Live / Update
 * required). No content from the site is sent to the browser — the API only
 * returns the name and status to anonymous visitors.
 */
export default function ComingSoon({ site }) {
  const name = site?.name || site?.slug || "This website";
  const inactive = site?.status === "inactive";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f5f2] px-6 text-center">
      <div className="max-w-md">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-black/40">{inactive ? "Unavailable" : "Coming soon"}</p>
        <h1 className="mb-4 text-4xl font-bold text-black md:text-5xl">{name}</h1>
        <p className="text-base text-black/60">
          {inactive
            ? "This website is currently offline."
            : "Our new website is on its way. Please check back soon."}
        </p>
      </div>
    </main>
  );
}

/** Metadata for a site that isn't public: keep it out of search results. */
export function comingSoonMetadata(site) {
  const name = site?.name || site?.slug || "Website";
  return { title: site?.status === "inactive" ? name : `${name} — coming soon`, robots: { index: false, follow: false } };
}

/** Thin bar over a preview of a site that isn't public yet. */
export function PreviewBanner({ status }) {
  return (
    <div
      role="status"
      style={{ position: "fixed", zIndex: 2147483000, bottom: 12, left: "50%", transform: "translateX(-50%)" }}
      className="rounded-full bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-lg"
    >
      Preview — not public ({String(status || "").replace(/_/g, " ")})
    </div>
  );
}
