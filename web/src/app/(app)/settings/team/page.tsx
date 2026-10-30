import { redirect } from "next/navigation";

/** Team & access lives on /team-members (invites, roles, status, extra access). */
export default function Page() {
  redirect("/team-members");
}
