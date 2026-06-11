"use client";

import { CalendarDays, Users } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { formatDate } from "../lib/format";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "./ui";

interface Call {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  history: {
    participantCount: number;
    aiMilliseconds: number;
    terminationReason: string | null;
  } | null;
  _count: { participants: number };
}

export function CallHistoryClient() {
  const { data, loading, error } = useApiResource<Call[]>("/calls/history");
  return (
    <>
      <PageHeader
        title="Call history"
        description="Room lifecycle and metered AI usage are retained as operational records."
      />
      {loading ? <LoadingState label="Loading calls" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {data?.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No call history"
            description="Completed and active rooms will appear here."
          />
        </div>
      ) : null}
      <div className="history-list">
        {data?.map((call) => (
          <article className="history-row" key={call.id}>
            <div className="feature-icon">
              <CalendarDays size={18} />
            </div>
            <div>
              <h2>{call.title}</h2>
              <p>{formatDate(call.createdAt)}</p>
            </div>
            <span className="history-participants">
              <Users size={15} />
              {call.history?.participantCount ?? call._count.participants}
            </span>
            <span>
              {Math.round((call.history?.aiMilliseconds ?? 0) / 60_000)} AI min
            </span>
            <StatusBadge tone={call.status === "ENDED" ? "neutral" : "success"}>
              {call.status.toLowerCase()}
            </StatusBadge>
          </article>
        ))}
      </div>
    </>
  );
}
