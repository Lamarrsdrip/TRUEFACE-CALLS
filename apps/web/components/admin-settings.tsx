"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader } from "./ui";

interface SettingRecord {
  id: string;
  namespace: string;
  key: string;
  publicValue: unknown;
  version: number;
}

export function AdminSettings() {
  const settings = useApiResource<SettingRecord[]>("/admin/settings");
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const namespace = String(form.get("namespace")).trim();
    const key = String(form.get("key")).trim();
    let value: unknown;
    try {
      value = JSON.parse(String(form.get("value")));
    } catch {
      setMessage("Setting value must be valid JSON.");
      return;
    }
    await apiFetch(
      `/admin/settings/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        ...jsonBody({ value }),
      },
    );
    setMessage("Application setting saved and versioned.");
    await settings.refresh();
  }

  return (
    <>
      <PageHeader
        title="Application settings"
        description="Manage branding, trial policy, call limits, moderation, and abuse configuration as versioned JSON."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      <form className="panel admin-setting-form" onSubmit={save}>
        <div className="field">
          <label>Namespace</label>
          <input name="namespace" placeholder="branding" required />
        </div>
        <div className="field">
          <label>Key</label>
          <input name="key" placeholder="public" required />
        </div>
        <div className="field admin-json">
          <label>JSON value</label>
          <textarea
            name="value"
            defaultValue={'{"productName":"TrueFace Calls"}'}
            required
          />
        </div>
        <button className="button button-primary">
          <Save size={16} /> Save setting
        </button>
      </form>
      {settings.loading ? <LoadingState /> : null}
      {settings.error ? <ErrorState message={settings.error} /> : null}
      <div className="admin-card-list">
        {settings.data?.map((setting) => (
          <button
            className="admin-record setting-record"
            key={setting.id}
            onClick={() => {
              const form = document.querySelector<HTMLFormElement>(
                ".admin-setting-form",
              );
              if (!form) return;
              (form.elements.namedItem("namespace") as HTMLInputElement).value =
                setting.namespace;
              (form.elements.namedItem("key") as HTMLInputElement).value =
                setting.key;
              (form.elements.namedItem("value") as HTMLTextAreaElement).value =
                JSON.stringify(setting.publicValue, null, 2);
              form.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <div className="admin-record-main">
              <strong>
                {setting.namespace}.{setting.key}
              </strong>
              <span>Version {setting.version}</span>
            </div>
            <code>{JSON.stringify(setting.publicValue)}</code>
          </button>
        ))}
      </div>
    </>
  );
}
