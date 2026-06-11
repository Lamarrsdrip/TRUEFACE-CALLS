"use client";

import { useState } from "react";
import { Check, Copy, Link2, LoaderCircle, Video } from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";

export function CreateCallForm() {
  const [result, setResult] = useState<{
    inviteUrl: string;
    room: { id: string; title: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      setResult(
        await apiFetch("/rooms", {
          method: "POST",
          ...jsonBody({
            title: form.get("title"),
            waitingRoom: form.get("waitingRoom") === "on",
            allowGuests: form.get("allowGuests") === "on",
            maxParticipants: Number(form.get("maxParticipants")),
            expiresInMinutes: Number(form.get("expiresInMinutes")),
            password: form.get("password") || undefined,
          }),
        }),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : "Call creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (result) {
    return (
      <div className="panel max-w-2xl">
        <div className="success-mark">
          <Check size={26} />
        </div>
        <h2 className="mt-4 text-2xl font-semibold">Call link ready</h2>
        <p className="mt-2 text-sm text-slate-500">
          This invite expires automatically and follows your waiting-room rules.
        </p>
        <div className="invite-box">
          <Link2 size={18} />
          <span>{result.inviteUrl}</span>
          <button
            className="icon-button"
            onClick={copy}
            aria-label="Copy invite"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <div className="mt-5 flex gap-3">
          <a href={result.inviteUrl} className="button button-primary">
            <Video size={17} /> Open call room
          </a>
          <button
            className="button button-ghost"
            onClick={() => setResult(null)}
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="form-card form-grid" onSubmit={submit}>
      {error ? <div className="notice notice-danger">{error}</div> : null}
      <div className="field">
        <label htmlFor="title">Call title</label>
        <input
          id="title"
          name="title"
          placeholder="Client check-in"
          maxLength={120}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="maxParticipants">Participants</label>
          <select id="maxParticipants" name="maxParticipants" defaultValue="2">
            <option value="2">2 people</option>
            <option value="4">Up to 4</option>
            <option value="8">Up to 8</option>
            <option value="12">Up to 12</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="expiresInMinutes">Link expires</label>
          <select
            id="expiresInMinutes"
            name="expiresInMinutes"
            defaultValue="1440"
          >
            <option value="60">1 hour</option>
            <option value="1440">24 hours</option>
            <option value="10080">7 days</option>
            <option value="43200">30 days</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="password">Room password (optional)</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          placeholder="At least 8 characters"
        />
      </div>
      <label className="checkbox-row">
        <input name="waitingRoom" type="checkbox" defaultChecked />
        <span>
          <strong>Use a waiting room</strong>
          <br />
          Approve each participant before they enter.
        </span>
      </label>
      <label className="checkbox-row">
        <input name="allowGuests" type="checkbox" defaultChecked />
        <span>
          <strong>Allow browser guests</strong>
          <br />
          People can join without creating an account.
        </span>
      </label>
      <button className="button button-primary" disabled={busy}>
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <Video size={17} />
        )}
        Create secure call
      </button>
    </form>
  );
}
