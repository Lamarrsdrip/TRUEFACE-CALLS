"use client";

import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";
import { PageHeader } from "./ui";

export function AdminBroadcasts() {
  const [message, setMessage] = useState<string | null>(null);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiFetch("/admin/notifications/broadcast", {
      method: "POST",
      ...jsonBody({
        title: String(form.get("title")),
        body: String(form.get("body")),
        audience: String(form.get("audience")),
      }),
    });
    event.currentTarget.reset();
    setMessage("Broadcast published to in-app notifications.");
  }

  return (
    <>
      <PageHeader
        title="Notification broadcast"
        description="Publish an audited in-app message to customers or a configured audience."
      />
      <form className="panel broadcast-card" onSubmit={send}>
        <div className="broadcast-icon">
          <Megaphone size={24} />
        </div>
        {message ? <div className="notice notice-info">{message}</div> : null}
        <div className="field">
          <label>Audience</label>
          <select name="audience">
            <option value="ALL">All users</option>
            <option value="ACTIVE_SUBSCRIBERS">Active subscribers</option>
          </select>
        </div>
        <div className="field">
          <label>Title</label>
          <input name="title" minLength={3} maxLength={120} required />
        </div>
        <div className="field">
          <label>Message</label>
          <textarea name="body" minLength={5} maxLength={2000} required />
        </div>
        <button className="button button-primary">
          <Send size={16} /> Publish broadcast
        </button>
      </form>
    </>
  );
}
