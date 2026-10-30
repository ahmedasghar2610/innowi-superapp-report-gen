import { LibraryShell } from "@/features/library/components/library-shell";

/** /ops/library/* — page tree on the left, the open page on the right. */
export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return <LibraryShell>{children}</LibraryShell>;
}
