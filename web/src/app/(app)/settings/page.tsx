import { redirect } from "next/navigation";

/** /settings opens on your own profile. */
export default function SettingsIndex() {
  redirect("/settings/profile");
}
