"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, PlugZap } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface Provider {
  provider: string;
  values: Record<string, unknown>;
  secrets: Record<string, string>;
  status: string;
  checkedAt: string | null;
  error: string | null;
}

const definitions: Record<
  string,
  Array<{ key: string; label: string; secret?: boolean; placeholder?: string }>
> = {
  livekit: [
    { key: "url", label: "LiveKit URL", placeholder: "wss://…" },
    { key: "apiKey", label: "API key", secret: true },
    { key: "apiSecret", label: "API secret", secret: true },
  ],
  storage: [
    { key: "endpoint", label: "S3 endpoint" },
    { key: "region", label: "Region" },
    { key: "bucket", label: "Bucket" },
    { key: "accessKey", label: "Access key", secret: true },
    { key: "secretAccessKey", label: "Secret key", secret: true },
    { key: "forcePathStyle", label: "Force path style" },
  ],
  stripe: [
    { key: "secretKey", label: "Secret key", secret: true },
    { key: "webhookSecret", label: "Webhook secret", secret: true },
  ],
  paystack: [
    { key: "secretKey", label: "Secret key", secret: true },
    { key: "webhookSecret", label: "Webhook secret", secret: true },
  ],
  flutterwave: [
    { key: "secretKey", label: "Secret key", secret: true },
    { key: "encryptionKey", label: "Encryption key", secret: true },
    { key: "webhookHash", label: "Webhook hash", secret: true },
  ],
  email: [
    { key: "provider", label: "Provider", placeholder: "resend" },
    { key: "apiKey", label: "API key", secret: true },
    { key: "from", label: "Sender identity" },
  ],
  gpu: [
    { key: "provider", label: "GPU provider" },
    { key: "endpoint", label: "Worker endpoint" },
    { key: "apiKey", label: "API key", secret: true },
  ],
};

export function AdminProviders() {
  const resource = useApiResource<Provider[]>("/admin/providers");
  const [selected, setSelected] = useState("livekit");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = resource.data?.find((item) => item.provider === selected);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    for (const field of definitions[selected] ?? []) {
      const value = String(form.get(field.key) ?? "").trim();
      if (value) values[field.key] = value;
    }
    setBusy(true);
    try {
      await apiFetch(`/admin/providers/${selected}`, {
        method: "PUT",
        ...jsonBody({ values }),
      });
      setMessage("Provider settings saved securely.");
      await resource.refresh();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const result = await apiFetch<{ message: string }>(
        `/admin/providers/${selected}/test`,
        { method: "POST", ...jsonBody({}) },
      );
      setMessage(result.message);
      await resource.refresh();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Provider configuration"
        description="Secrets are encrypted in the backend and return only a fingerprint after save."
      />
      {resource.loading ? <LoadingState /> : null}
      {resource.error ? <ErrorState message={resource.error} /> : null}
      <div className="provider-layout">
        <nav className="provider-list">
          {Object.keys(definitions).map((provider) => {
            const item = resource.data?.find(
              (candidate) => candidate.provider === provider,
            );
            return (
              <button
                key={provider}
                className={selected === provider ? "selected" : ""}
                onClick={() => {
                  setSelected(provider);
                  setMessage(null);
                }}
              >
                <span>{provider}</span>
                <StatusBadge
                  tone={item?.status === "OPERATIONAL" ? "success" : "neutral"}
                >
                  {(item?.status ?? "UNCONFIGURED").toLowerCase()}
                </StatusBadge>
              </button>
            );
          })}
        </nav>
        <form className="panel form-grid" onSubmit={save}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold capitalize">{selected}</h2>
              <p className="text-sm text-slate-500">
                Environment variables remain a fallback until an admin value is
                saved.
              </p>
            </div>
            {current?.status === "OPERATIONAL" ? (
              <CheckCircle2 className="text-emerald-500" />
            ) : (
              <PlugZap className="text-slate-400" />
            )}
          </div>
          {message ? <div className="notice notice-info">{message}</div> : null}
          {(definitions[selected] ?? []).map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={field.key}>{field.label}</label>
              <input
                id={field.key}
                name={field.key}
                type={field.secret ? "password" : "text"}
                placeholder={
                  field.secret
                    ? (current?.secrets[field.key] ?? "Enter new secret")
                    : String(
                        current?.values[field.key] ?? field.placeholder ?? "",
                      )
                }
                autoComplete="off"
              />
            </div>
          ))}
          <div className="flex gap-3">
            <button className="button button-primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              Save settings
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void test()}
              disabled={busy}
            >
              Test connection
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
