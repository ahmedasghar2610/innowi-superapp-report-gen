import { SettingsShell } from "@/features/settings/components/settings-shell";

/** /settings/* — section list on the left, the open section on the right. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
