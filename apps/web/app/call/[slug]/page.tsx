import { CallRoomClient } from "../../../components/call-room-client";

export default async function CallPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CallRoomClient slug={slug} />;
}
