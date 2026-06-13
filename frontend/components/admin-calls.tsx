"use client";

import { useState } from "react";
import { Radio, Square } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { formatDate } from "../lib/format";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface CallRecord {
  id: string;
  slug: string;
  title: string;
  status: string;
  createdAt: string;
  host: { email: string; displayName: string };
  history: { aiMilliseconds: number } | null;
  _count: { participants: number };
}

export function AdminCalls() {
  const calls = useApiResource<CallRecord[]>("/admin/calls");
  const [message, setMessage] = useState<string | null>(null);

  async function endCall(id: string) {
    await apiFetch(`/admin/calls/${id}/end`, {
      method: "POST",
      ...jsonBody({ reason: "Ended from admin console" }),
    });
    setMessage("Room ended in LiveKit and the database audit trail.");
    await calls.refresh();
  }

  return (
    <>
      <PageHeader
        title="Calls and usage"
        description="Monitor room state, participants, AI processing, host ownership, and platform health."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      {calls.loading ? <LoadingState /> : null}
      {calls.error ? <ErrorState message={calls.error} /> : null}
      <div className="admin-card-list">
        {calls.data?.map((call) => (
          <article className="admin-record admin-call-record" key={call.id}>
            <div className="admin-record-icon">
              <Radio size={18} />
            </div>
            <div className="admin-record-main">
              <strong>{call.title}</strong>
              <span>
                {call.host.email} · {call.slug} · {formatDate(call.createdAt)}
              </span>
            </div>
            <span>{call._count.participants} participants</span>
            <span>
              {Math.round((call.history?.aiMilliseconds ?? 0) / 60_000)} AI min
            </span>
            <StatusBadge
              tone={
                ["OPEN", "ACTIVE"].includes(call.status) ? "success" : "neutral"
              }
            >
              {call.status.toLowerCase()}
            </StatusBadge>
            {["OPEN", "ACTIVE"].includes(call.status) ? (
              <button
                className="button button-danger button-sm"
                onClick={() => void endCall(call.id)}
              >
                <Square size={13} /> End room
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
