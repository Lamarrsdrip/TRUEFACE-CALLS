"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Check, Copy, Square, Users, Video } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
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
  inviteUrl: string | null;
  hostUrl: string | null;
  isHost: boolean;
  expiresAt: string;
  host: { displayName: string; email: string };
}

export function CallHistoryClient() {
  const { data, loading, error, refresh } =
    useApiResource<Call[]>("/calls/rooms");
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function copy(call: Call) {
    if (!call.inviteUrl) return;
    await navigator.clipboard.writeText(call.inviteUrl);
    setCopied(call.id);
    setTimeout(() => setCopied(null), 1600);
  }

  async function end(call: Call) {
    await apiFetch(`/rooms/${call.id}/end`, {
      method: "POST",
      ...jsonBody({}),
    });
    setMessage("Room ended. Its history remains available.");
    await refresh();
  }

  return (
    <>
      <PageHeader
        title="My call rooms"
        description="Return to active rooms, copy secure invite links again, and review recent or expired calls."
        actions={
          <Link href="/create-call" className="button button-primary">
            <Video size={16} /> Create call
          </Link>
        }
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      {loading ? <LoadingState label="Loading calls" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {data?.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No call rooms"
            description="Create a room once and its secure link will remain available here until expiry."
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
              <p>
                Hosted by {call.host.displayName} · created{" "}
                {formatDate(call.createdAt)} · expires{" "}
                {formatDate(call.expiresAt)}
              </p>
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
            <div className="room-row-actions">
              {call.inviteUrl &&
              !["ENDED", "EXPIRED"].includes(call.status) &&
              new Date(call.expiresAt) > new Date() ? (
                <>
                  <Link
                    href={call.hostUrl ?? call.inviteUrl}
                    className="button button-primary button-sm"
                  >
                    Rejoin
                  </Link>
                  <button
                    className="button button-secondary button-sm"
                    onClick={() => void copy(call)}
                  >
                    {copied === call.id ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    Copy link
                  </button>
                  <button
                    className="button button-danger button-sm"
                    onClick={() => void end(call)}
                  >
                    <Square size={13} /> End
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
