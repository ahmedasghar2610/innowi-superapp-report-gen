import { MerchantWorkspaceShell } from "@/features/merchants/components/merchant-workspace-shell";

/**
 * /merchants/[merchantId] — Merchant Workspace shell.
 * Server layout: resolves the route param and hands it to the client shell,
 * which fetches the merchant and renders header + summary + tabs around the
 * active tab (`children`).
 *
 * The parallel `@modal` slot renders the Edit drawer as an intercepted route
 * (`@modal/(.)edit`) so /merchants/[merchantId]/edit opens over the workspace.
 * The drawer portals to <body>, so it sits beside the shell rather than inside
 * its content; on a hard load of /edit the standalone `edit/page.tsx` renders
 * and the slot falls back to `@modal/default.tsx` (null).
 */
export default async function MerchantLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return (
    <>
      <MerchantWorkspaceShell merchantId={merchantId}>{children}</MerchantWorkspaceShell>
      {modal}
    </>
  );
}
