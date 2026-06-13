"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface FaceRecord {
  id: string;
  name: string;
  qualityScore: number;
  moderationStatus: string;
  user: { email: string; displayName: string };
}

export function AdminModeration() {
  const faces = useApiResource<FaceRecord[]>("/admin/faces/moderation");
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, status: string) {
    await apiFetch(`/admin/faces/${id}/decision`, {
      method: "POST",
      ...jsonBody({
        status,
        reasonCodes:
          status === "APPROVED"
            ? ["CONSENT_AND_QUALITY_OK"]
            : ["POLICY_REVIEW"],
      }),
    });
    setMessage(`Profile ${status.toLowerCase()} and audit log created.`);
    await faces.refresh();
  }

  async function remove(id: string) {
    await apiFetch(`/admin/faces/${id}/delete`, {
      method: "POST",
      ...jsonBody({ reason: "Administrative moderation deletion" }),
    });
    setMessage("Face media deleted, consent revoked, and audit log created.");
    await faces.refresh();
  }

  return (
    <>
      <PageHeader
        title="Face moderation"
        description="Review consent-backed profiles before they can be activated."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      {faces.loading ? <LoadingState /> : null}
      {faces.error ? <ErrorState message={faces.error} /> : null}
      <div className="admin-card-list">
        {faces.data?.map((face) => (
          <article className="admin-record admin-record-tall" key={face.id}>
            <div className="admin-record-icon">
              <ShieldCheck size={19} />
            </div>
            <div className="admin-record-main">
              <strong>{face.name}</strong>
              <span>
                {face.user.displayName} · {face.user.email}
              </span>
            </div>
            <span>Quality {face.qualityScore}/100</span>
            <StatusBadge tone="warning">
              {face.moderationStatus.toLowerCase()}
            </StatusBadge>
            <div className="admin-actions">
              <button
                className="button button-primary button-sm"
                onClick={() => void decide(face.id, "APPROVED")}
              >
                Approve
              </button>
              <button
                className="button button-ghost button-sm"
                onClick={() => void decide(face.id, "QUARANTINED")}
              >
                Quarantine
              </button>
              <button
                className="button button-danger button-sm"
                onClick={() => void decide(face.id, "REJECTED")}
              >
                Reject
              </button>
              <button
                className="button button-danger button-sm"
                onClick={() => void remove(face.id)}
              >
                Delete media
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
