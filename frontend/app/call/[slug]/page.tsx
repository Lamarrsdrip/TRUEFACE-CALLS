import { Suspense } from "react";
import { CallRoomClient } from "../../../components/call-room-client";
import { LoadingState } from "../../../components/ui";

export default async function CallPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<LoadingState label="Opening secure call" />}>
      <CallRoomClient slug={slug} />
    </Suspense>
  );
}
