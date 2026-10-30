/*
 * Shown for "/" when no DEFAULT_SITE is configured, and for any slug that
 * neither the API nor data/sites/ knows about.
 *
 * Deliberately unbranded — a 404 has no site behind it, so there are no brand
 * colours or logo to use, and naming any particular merchant here would be the
 * same favouritism the root route avoids.
 */
export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-neutral-400">404</p>
      <h1 className="mt-3 text-3xl font-bold text-neutral-900">No site at this address</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-500">
        Every site published here lives at its own address. Check the link you followed, or open
        the site from the Website module in the Super App.
      </p>
    </main>
  );
}
