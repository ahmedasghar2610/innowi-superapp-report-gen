import { redirect } from "next/navigation";

/** /ops — the Ops CRM section opens on the Tickets list. */
export default function OpsIndex() {
  redirect("/ops/tickets");
}
