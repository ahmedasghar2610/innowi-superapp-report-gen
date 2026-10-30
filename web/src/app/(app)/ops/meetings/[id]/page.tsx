import { MeetingDetailPage } from "@/features/meetings/components/meeting-detail-page";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingDetailPage id={id} />;
}
