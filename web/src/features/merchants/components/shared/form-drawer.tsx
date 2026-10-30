"use client";

import { Button, Dialog, type DialogProps, type DrawerProps } from "@/components/ui";

/** Old side-drawer widths → the centered dialog's widths. */
const SIZE: Record<NonNullable<DrawerProps["size"]>, NonNullable<DialogProps["size"]>> = {
  sm: "md",
  md: "lg",
  lg: "xl",
  xl: "2xl",
  "2xl": "2xl",
  "3xl": "3xl",
};

/**
 * The module's create/edit forms in a centered modal — the same presentation
 * as the New merchant and website questionnaires. Standardizes the footer
 * (Cancel + a submit button wired to a `<form id={formId}>` via the `form`
 * attribute) and the busy behavior (non-dismissible + spinner while saving).
 * The form fields themselves are the children.
 *
 * Kept under its historical name so the eleven entity forms that import it
 * (contacts, locations, services, documents, connections, keywords,
 * competitors, promotions, subscription, uploads) need no change; `size`
 * still accepts the drawer widths and maps them to dialog widths.
 */
export function FormDrawer({
  open,
  onClose,
  title,
  description,
  formId,
  submitLabel,
  busy,
  submitDisabled,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  formId: string;
  submitLabel: string;
  busy: boolean;
  submitDisabled?: boolean;
  size?: DrawerProps["size"];
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={SIZE[size] ?? "lg"}
      title={title}
      description={description}
      dismissible={!busy}
      hideClose={busy}
      footerBordered
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} type="button">
            Cancel
          </Button>
          <Button variant="default" type="submit" form={formId} loading={busy} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
