import { TicketDetailPage } from "@/features/tickets/components/ticket-detail-page";

/** /ops/tickets/[key] — one ticket, addressed as OPS-1042. */
export default async function OpsTicketPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <TicketDetailPage ticketKey={decodeURIComponent(key)} />;
}
