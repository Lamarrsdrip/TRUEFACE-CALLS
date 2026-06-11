"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";

export function ReportAbuseForm() {
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/abuse-reports", {
        method: "POST",
        ...jsonBody({
          category: form.get("category"),
          description: form.get("description"),
          reportedUserId: form.get("reportedUserId") || undefined,
          roomId: form.get("roomId") || undefined,
          faceProfileId: form.get("faceProfileId") || undefined,
        }),
      });
      setMessage("Report submitted for moderation review.");
      event.currentTarget.reset();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Report failed");
    }
  }

  return (
    <form className="form-card form-grid" onSubmit={submit}>
      {message ? <div className="notice notice-info">{message}</div> : null}
      <div className="field">
        <label htmlFor="category">Category</label>
        <select id="category" name="category" required>
          <option value="non-consensual-face-use">
            Non-consensual face use
          </option>
          <option value="impersonation-or-fraud">Impersonation or fraud</option>
          <option value="harassment">Harassment</option>
          <option value="sexual-content">Sexual content</option>
          <option value="other">Other safety concern</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="description">What happened?</label>
        <textarea
          id="description"
          name="description"
          minLength={20}
          maxLength={5000}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="roomId">Room ID</label>
        <input
          id="roomId"
          name="roomId"
          placeholder="Required if reporting a call"
        />
      </div>
      <div className="field">
        <label htmlFor="reportedUserId">Reported user ID</label>
        <input id="reportedUserId" name="reportedUserId" />
      </div>
      <div className="field">
        <label htmlFor="faceProfileId">Face profile ID</label>
        <input id="faceProfileId" name="faceProfileId" />
      </div>
      <div className="notice notice-warning">
        Include at least one target ID. Do not upload unrelated private data.
      </div>
      <button className="button button-danger">
        <ShieldAlert size={17} /> Submit safety report
      </button>
    </form>
  );
}
