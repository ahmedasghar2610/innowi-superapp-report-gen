import type { Metadata } from "next";
import { TeamMembersPage } from "@/features/users/team-members-page";

export const metadata: Metadata = { title: "Team members — Innowi" };

export default function TeamMembersRoute() {
  return <TeamMembersPage />;
}
