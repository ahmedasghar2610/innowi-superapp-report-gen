import type { Metadata } from "next";
import { MyDayPage } from "@/features/sales/components/my-day-page";

export const metadata: Metadata = { title: "My Day — Salesforce — Innowi" };

export default function SalesHomeRoute() {
  return <MyDayPage />;
}
