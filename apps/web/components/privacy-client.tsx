"use client";

import Link from "next/link";
import { Ban, Download, ImageOff, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader } from "./ui";

interface Block {
  id: string;
  blocked: { id: string; displayName: string };
  createdAt: string;
}

export function PrivacyClient() {
  const router = useRouter();
  const blocked = useApiResource<Block[]>("/me/blocked-users");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function exportData() {
    const payload = await apiFetch<Record<string, unknown>>(
      "/auth/account/export",
    );
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trueface-account-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Your account export was downloaded.");
  }

  async function requestDeletion() {
    const result = await apiFetch<{ deletionScheduledAt: string }>(
      "/auth/account",
      {
        method: "DELETE",
        ...jsonBody({ confirmation }),
      },
    );
    setMessage(
      `Deletion scheduled for ${new Date(result.deletionScheduledAt).toLocaleDateString()}.`,
    );
    router.push("/login");
    router.refresh();
  }
  return (
    <>
      <PageHeader
        title="Privacy controls"
        description="Manage face data, blocked users, and your account privacy lifecycle."
      />
      {blocked.loading ? <LoadingState /> : null}
      {blocked.error ? <ErrorState message={blocked.error} /> : null}
      {message ? <div className="notice notice-info">{message}</div> : null}
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-title">Face data</div>
          <p className="text-sm leading-6 text-slate-500">
            Face profiles are private objects with signed access. Deleting a
            profile revokes consent and removes the object from configured
            storage.
          </p>
          <Link href="/faces" className="button button-secondary mt-5">
            <ImageOff size={17} /> Manage face profiles
          </Link>
        </section>
        <section className="panel">
          <div className="panel-title">Blocked users</div>
          {blocked.data?.length ? (
            <div className="list">
              {blocked.data.map((item) => (
                <div className="list-row" key={item.id}>
                  <Ban size={17} />
                  <div className="list-row-main">
                    <strong>{item.blocked.displayName}</strong>
                    <span>{item.blocked.id}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No blocked users.</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-title">Data portability</div>
          <p className="text-sm leading-6 text-slate-500">
            Account export is prepared from your profile, consent, call,
            billing, and moderation records.
          </p>
          <button
            className="button button-secondary mt-5"
            onClick={() => void exportData()}
          >
            <Download size={17} /> Download account export
          </button>
        </section>
        <section className="panel">
          <div className="panel-title">Responsible AI</div>
          <div className="notice notice-info">
            <ShieldCheck size={18} />
            AI mode is disclosed to participants and pauses when tracking fails.
          </div>
        </section>
        <section className="panel danger-panel">
          <div className="panel-title">Delete account</div>
          <p className="text-sm leading-6 text-slate-500">
            Schedules account deletion in 30 days and immediately signs out all
            sessions. Delete face profiles now from the face library.
          </p>
          <div className="field mt-5">
            <label htmlFor="delete-confirmation">Type DELETE to confirm</label>
            <input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <button
            className="button button-danger mt-3"
            disabled={confirmation !== "DELETE"}
            onClick={() => void requestDeletion()}
          >
            <Trash2 size={17} /> Schedule account deletion
          </button>
        </section>
      </div>
    </>
  );
}
