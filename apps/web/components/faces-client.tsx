"use client";

import Link from "next/link";
import { ImagePlus, ShieldCheck, Trash2 } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "./ui";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";

interface FaceProfile {
  id: string;
  name: string;
  previewUrl: string | null;
  qualityScore: number;
  moderationStatus: string;
  active: boolean;
  readinessScore: number;
  readinessLabel: string;
  images: Array<{ id: string; role: string; qualityScore: number }>;
  createdAt: string;
}

export function FacesClient() {
  const { data, loading, error, refresh } =
    useApiResource<FaceProfile[]>("/faces");

  async function remove(id: string) {
    if (!window.confirm("Delete this face profile and revoke its consent?")) {
      return;
    }
    await apiFetch(`/faces/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function toggle(face: FaceProfile) {
    await apiFetch(`/faces/${face.id}/status`, {
      method: "POST",
      ...jsonBody({ active: !face.active }),
    });
    await refresh();
  }

  return (
    <>
      <PageHeader
        title="Face profiles"
        description="Only approved, actively consented profiles can be selected in a call."
        actions={
          <Link href="/faces/upload" className="button button-primary">
            <ImagePlus size={17} /> Add face
          </Link>
        }
      />
      {loading ? <LoadingState label="Loading face profiles" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {data?.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No face profiles"
            description="Upload a clear image, pass the quality check, and confirm all required permissions."
            action={
              <Link href="/faces/upload" className="button button-secondary">
                Add your first face
              </Link>
            }
          />
        </div>
      ) : null}
      {data && data.length > 0 ? (
        <div className="face-grid">
          {data.map((face) => (
            <article className="face-card" key={face.id}>
              <div className="face-card-image">
                {face.previewUrl ? (
                  // Signed private object URL.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={face.previewUrl} alt={face.name} />
                ) : (
                  <span>{face.name.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="face-card-body">
                <div className="flex items-center justify-between gap-3">
                  <h2>{face.name}</h2>
                  <StatusBadge
                    tone={
                      face.moderationStatus === "APPROVED"
                        ? "success"
                        : face.moderationStatus === "REJECTED"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {face.moderationStatus.toLowerCase()}
                  </StatusBadge>
                </div>
                <p>
                  {face.readinessLabel.toLowerCase()} readiness ·{" "}
                  {face.readinessScore}/100 · {face.images.length} image
                  {face.images.length === 1 ? "" : "s"}
                </p>
                <div className="face-readiness-track">
                  <span style={{ width: `${face.readinessScore}%` }} />
                </div>
                <div className="face-card-actions">
                  <span>
                    <ShieldCheck size={15} /> Consent recorded
                  </span>
                  <button
                    className="button button-ghost button-sm"
                    onClick={() => void toggle(face)}
                  >
                    {face.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${face.name}`}
                    onClick={() => void remove(face.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}
