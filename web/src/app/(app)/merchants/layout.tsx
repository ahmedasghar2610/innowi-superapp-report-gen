/**
 * /merchants segment layout with a parallel `@modal` slot.
 *
 * The slot renders the Create Merchant drawer as an intercepted route
 * (`@modal/(.)new`) when the user navigates to /merchants/new from within the
 * app, so the drawer opens *over* the current list/workspace without a full
 * page transition. On a hard load or refresh of /merchants/new the intercept
 * is bypassed and the standalone `new/page.tsx` renders instead; the slot then
 * falls back to `@modal/default.tsx` (null).
 */
export default function MerchantsLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
