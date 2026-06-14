"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  LoaderCircle,
  MailCheck,
  PlugZap,
} from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface Provider {
  provider: string;
  values: Record<string, unknown>;
  secrets: Record<string, string>;
  configurationStatus: "CONFIGURED" | "PARTIALLY_CONFIGURED" | "UNCONFIGURED";
  status: string;
  checkedAt: string | null;
  error: string | null;
}

interface Field {
  key: string;
  label: string;
  helper: string;
  secret?: boolean;
  type?: "text" | "number" | "select" | "textarea";
  options?: Array<{ value: string; label: string }>;
  show?: (values: Record<string, unknown>) => boolean;
}

interface Definition {
  label: string;
  description: string;
  required: boolean;
  fields: Field[];
}

const yesNo = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
];

const definitions: Record<string, Definition> = {
  livekit: {
    label: "LiveKit",
    required: true,
    description:
      "Runs the secure WebRTC rooms and creates participant tokens. Calls cannot start without it.",
    fields: [
      { key: "enabled", label: "Status", helper: "Enable after adding valid LiveKit Cloud credentials.", type: "select", options: yesNo },
      { key: "url", label: "LiveKit WebSocket URL", helper: "Example: wss://your-project.livekit.cloud" },
      { key: "apiKey", label: "API key", helper: "Stored encrypted and never returned to the browser.", secret: true },
      { key: "apiSecret", label: "API secret", helper: "Stored encrypted and used only for server-side token signing.", secret: true },
    ],
  },
  storage: {
    label: "Storage",
    required: true,
    description:
      "Private file/object storage for face images, payment receipts, and generated assets. This is separate from database records.",
    fields: [
      {
        key: "provider",
        label: "Active storage provider",
        helper: "Emergent MongoDB GridFS is the active private-file adapter in this deployment.",
        type: "select",
        options: [
          { value: "gridfs", label: "Emergent MongoDB GridFS (default)" },
        ],
      },
      {
        key: "futureProvider",
        label: "Future external storage",
        helper: "Optional migration settings only. Cloudflare R2 is recommended; GridFS remains active until the external adapter is implemented.",
        type: "select",
        options: [
          { value: "r2", label: "Cloudflare R2 (recommended later)" },
          { value: "s3", label: "Amazon S3-compatible (later)" },
        ],
      },
      { key: "endpoint", label: "Object storage endpoint", helper: "Future R2 or S3 API endpoint.", show: externalStorage },
      { key: "region", label: "Region", helper: "Use auto for R2 or the S3 bucket region.", show: externalStorage },
      { key: "bucket", label: "Private bucket name", helper: "The bucket must not allow public listing or public reads.", show: externalStorage },
      { key: "accessKey", label: "Access key", helper: "Encrypted server-side credential.", secret: true, show: externalStorage },
      { key: "secretAccessKey", label: "Secret access key", helper: "Encrypted server-side credential.", secret: true, show: externalStorage },
    ],
  },
  paystack: {
    label: "Paystack",
    required: false,
    description: "Optional automated Naira card and bank checkout with webhook settlement.",
    fields: gatewayFields("Paystack"),
  },
  flutterwave: {
    label: "Flutterwave",
    required: false,
    description: "Optional automated Naira checkout. Manual bank transfer remains available independently.",
    fields: gatewayFields("Flutterwave"),
  },
  email: {
    label: "Email",
    required: false,
    description: "Sends verification, password reset, billing, and call notifications.",
    fields: [
      {
        key: "provider",
        label: "Email provider",
        helper: "Gmail SMTP is simplest for initial launch; Resend is better for higher volume.",
        type: "select",
        options: [
          { value: "gmail", label: "Gmail SMTP" },
          { value: "smtp", label: "Custom SMTP" },
          { value: "resend", label: "Resend" },
        ],
      },
      { key: "senderEmail", label: "Sender email", helper: "The address recipients will see in the From field." },
      { key: "senderName", label: "Sender name", helper: "Example: TrueFace Calls" },
      {
        key: "appPassword",
        label: "Gmail App Password",
        helper: "Use a Google App Password, never your normal Gmail password. Host smtp.gmail.com and port 465 are filled automatically.",
        secret: true,
        show: (values) => values.provider === "gmail",
      },
      { key: "host", label: "SMTP host", helper: "Mail server hostname.", show: customSmtp },
      { key: "port", label: "SMTP port", helper: "Usually 465 for SSL or 587 for STARTTLS.", type: "number", show: customSmtp },
      { key: "username", label: "SMTP username", helper: "Account username used by your mail server.", show: customSmtp },
      { key: "password", label: "SMTP password", helper: "Stored encrypted.", secret: true, show: customSmtp },
      {
        key: "secure",
        label: "Connection security",
        helper: "Choose the mode required by your SMTP provider.",
        type: "select",
        options: [
          { value: "ssl", label: "SSL/TLS (usually port 465)" },
          { value: "starttls", label: "STARTTLS (usually port 587)" },
        ],
        show: customSmtp,
      },
      { key: "apiKey", label: "Resend API key", helper: "Create this in your Resend account.", secret: true, show: (values) => values.provider === "resend" },
    ],
  },
  ai: {
    label: "AI",
    required: false,
    description: "Emergent LLM handles provider reasoning, quality guidance, fallback explanations, and diagnostics. It does not transform video frames.",
    fields: [
      {
        key: "enabled",
        label: "AI processing",
        helper: "Disable this only when all AI face features should be unavailable.",
        type: "select",
        options: yesNo,
      },
      {
        key: "provider",
        label: "Reasoning provider",
        helper: "Emergent LLM is used for orchestration and diagnostics. Browser processing does not consume LLM credits.",
        type: "select",
        options: [
          { value: "emergent", label: "Emergent LLM" },
        ],
      },
      { key: "mode", label: "Face processing policy", helper: "Local uses the device. Cloud requires the separate GPU provider. Hybrid stays local-first and exposes cloud only when its worker is healthy.", type: "select", options: [
        { value: "browser", label: "Local browser/device (recommended)" },
        { value: "cloud", label: "Cloud GPU with local fallback" },
        { value: "hybrid", label: "Hybrid, local-first" },
      ] },
      { key: "gatewayUrl", label: "Emergent LLM base URL", helper: "Optional. The base URL supplied by Emergent for the universal LLM/credits API." },
      { key: "universalKey", label: "Emergent LLM API key", helper: "Optional and stored encrypted. This key is never sent to the browser or GPU worker.", secret: true },
      { key: "model", label: "LLM model", helper: "Default: emergent-universal. Change only when Emergent supplies a different model name." },
      { key: "chatPath", label: "Chat completion path", helper: "OpenAI-compatible JSON chat path. Default: /chat/completions." },
      { key: "healthPath", label: "Access and credits health path", helper: "Endpoint used by Test connection. Default: /health." },
      { key: "creditsPath", label: "Credits path", helper: "Optional separate Emergent credit-balance endpoint. Default: /credits." },
      { key: "estimatedNairaPerMinute", label: "Estimated LLM cost per AI minute (₦)", helper: "Internal pricing estimate only. Actual video inference cost belongs under GPU.", type: "number" },
    ],
  },
  gpu: {
    label: "GPU",
    required: false,
    description: "Actual cloud image/video inference. Configure a worker that implements the normalized TrueFace frame contract.",
    fields: [
      { key: "enabled", label: "Cloud face processing", helper: "Enable only after the worker endpoint is deployed and tested.", type: "select", options: yesNo },
      { key: "provider", label: "GPU provider", helper: "Choose the service hosting your worker.", type: "select", options: [
        { value: "runpod", label: "RunPod" },
        { value: "modal", label: "Modal" },
        { value: "replicate", label: "Replicate" },
        { value: "custom", label: "Custom worker" },
      ] },
      { key: "endpoint", label: "GPU inference URL", helper: "HTTPS POST endpoint implementing the TrueFace process-frame request and response contract." },
      { key: "healthEndpoint", label: "Worker health URL", helper: "Optional GET endpoint. When blank, the inference URL is used for the connection test." },
      { key: "apiKey", label: "GPU inference API key", helper: "Encrypted and sent only from the backend as a Bearer token.", secret: true },
      { key: "region", label: "Region", helper: "Optional provider region." },
      { key: "model", label: "Worker/model name", helper: "Optional deployment identifier." },
      { key: "timeoutSeconds", label: "Frame timeout (seconds)", helper: "Between 2 and 30 seconds. Realtime calls need a much lower actual latency.", type: "number" },
      { key: "maxFramesPerSecond", label: "Maximum inference FPS", helper: "Advisory worker limit. The browser HTTPS gateway currently sends 2 frames per second.", type: "number" },
      { key: "fallbackMode", label: "Failure fallback", helper: "Local processing is the safe supported fallback.", type: "select", options: [
        { value: "local", label: "Local enhanced face mask" },
      ] },
      { key: "photorealistic", label: "Verified worker capability", helper: "Mark photorealistic only after your deployed model has been tested. This changes disclosure copy, not model behavior.", type: "select", options: [
        { value: "false", label: "Not verified photorealistic" },
        { value: "true", label: "Verified photorealistic" },
      ] },
    ],
  },
  "manual-bank": {
    label: "Manual Bank",
    required: false,
    description: "Primary Naira checkout. Payments stay pending until an administrator approves them.",
    fields: [
      { key: "enabled", label: "Manual bank payment", helper: "Disable to remove this checkout method.", type: "select", options: yesNo },
      { key: "bankName", label: "Bank name", helper: "Name shown to the customer at checkout." },
      { key: "accountName", label: "Account name", helper: "Must exactly match the receiving bank account." },
      { key: "accountNumber", label: "Account number", helper: "Receiving Naira account number." },
      { key: "instructions", label: "Extra instructions", helper: "Optional transfer guidance.", type: "textarea" },
      { key: "expiryMinutes", label: "Payment expiry (minutes)", helper: "Pending sessions expire automatically. Admin can still review an expired transfer.", type: "number" },
      { key: "minimumAmount", label: "Minimum amount (₦)", helper: "Leave blank or zero for no minimum.", type: "number" },
      { key: "maximumAmount", label: "Maximum amount (₦)", helper: "Leave blank or zero for no maximum.", type: "number" },
      { key: "proofRequired", label: "Receipt proof", helper: "Require an image or PDF before submission.", type: "select", options: [
        { value: "false", label: "Optional" },
        { value: "true", label: "Required" },
      ] },
    ],
  },
  monitoring: {
    label: "Monitoring",
    required: false,
    description: "Optional production error reporting. Server logs still include request IDs without it.",
    fields: [
      { key: "enabled", label: "Status", helper: "Enable after adding a monitoring DSN.", type: "select", options: yesNo },
      { key: "dsn", label: "Sentry DSN", helper: "Encrypted error-reporting endpoint.", secret: true },
      { key: "logLevel", label: "Log level", helper: "Use info for production.", type: "select", options: [
        { value: "info", label: "Info" },
        { value: "warning", label: "Warning" },
        { value: "error", label: "Error" },
      ] },
    ],
  },
  whatsapp: {
    label: "WhatsApp",
    required: false,
    description: "Optional Meta WhatsApp notifications for call and billing events.",
    fields: [
      { key: "enabled", label: "Status", helper: "Enable only after Meta credentials are available.", type: "select", options: yesNo },
      { key: "phoneNumberId", label: "Phone number ID", helper: "From Meta WhatsApp Manager." },
      { key: "businessAccountId", label: "Business account ID", helper: "From Meta Business Manager." },
      { key: "token", label: "Access token", helper: "Encrypted server-side.", secret: true },
      { key: "verifyToken", label: "Webhook verify token", helper: "Encrypted webhook verification value.", secret: true },
    ],
  },
};

export function AdminProviders() {
  const resource = useApiResource<Provider[]>("/admin/providers");
  const [selected, setSelected] = useState("livekit");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [testRecipient, setTestRecipient] = useState("");
  const current = resource.data?.find((item) => item.provider === selected);
  const definition = definitions[selected];
  const effectiveValues = useMemo(
    () => ({ ...(current?.values ?? {}), ...draft }),
    [current?.values, draft],
  );

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    for (const field of definition.fields) {
      const value = String(form.get(field.key) ?? "").trim();
      if (value) values[field.key] = value;
    }
    setBusy(true);
    try {
      await apiFetch(`/admin/providers/${selected}`, {
        method: "PUT",
        ...jsonBody({ values }),
      });
      setMessage("Settings saved securely. Secret values remain encrypted.");
      setDraft({});
      await resource.refresh();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const path =
        selected === "email"
          ? "/admin/providers/email/test-email"
          : `/admin/providers/${selected}/test`;
      const result = await apiFetch<{ message: string }>(path, {
        method: "POST",
        ...jsonBody(selected === "email" ? { recipient: testRecipient } : {}),
      });
      setMessage(result.message);
      await resource.refresh();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Connection test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function diagnoseAi() {
    setBusy(true);
    try {
      const result = await apiFetch<{
        recommendedMode?: string;
        summary?: string;
        actions?: string[];
      }>("/admin/providers/ai/diagnostics", {
        method: "POST",
        ...jsonBody({}),
      });
      const actions = Array.isArray(result.actions)
        ? ` Next: ${result.actions.join(" ")}`
        : "";
      setMessage(
        `${result.summary ?? "AI diagnostics completed."}${
          result.recommendedMode
            ? ` Recommended mode: ${result.recommendedMode}.`
            : ""
        }${actions}`,
      );
    } catch (value) {
      setMessage(
        value instanceof Error ? value.message : "AI diagnostics failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Provider configuration"
        description="Configure production services without placing credentials in source code. Admin values override environment fallbacks."
      />
      {resource.loading ? <LoadingState /> : null}
      {resource.error ? <ErrorState message={resource.error} /> : null}
      <div className="provider-layout">
        <nav className="provider-list" aria-label="Provider settings">
          {Object.entries(definitions).map(([key, item]) => {
            const provider = resource.data?.find((candidate) => candidate.provider === key);
            return (
              <button
                key={key}
                className={selected === key ? "selected" : ""}
                title={item.description}
                onClick={() => {
                  setSelected(key);
                  setDraft({});
                  setMessage(null);
                }}
              >
                <span>{item.label}</span>
                <StatusBadge tone={statusTone(provider?.configurationStatus)}>
                  {statusLabel(provider?.configurationStatus)}
                </StatusBadge>
              </button>
            );
          })}
        </nav>
        <form className="panel form-grid provider-form" onSubmit={save} key={selected}>
          <div className="provider-heading">
            <div>
              <h2>{definition.label}</h2>
              <p>{definition.description}</p>
            </div>
            {current?.configurationStatus === "CONFIGURED" ? (
              <CheckCircle2 className="text-emerald-500" />
            ) : (
              <PlugZap className="text-slate-400" />
            )}
          </div>
          <div className={definition.required ? "notice notice-warning" : "notice notice-info"}>
            <CircleHelp size={17} />
            {definition.required
              ? "Required for production calls."
              : "Optional. The core app can run without this provider."}
          </div>
          {selected === "storage" ? (
            <div className="notice notice-info">
              Emergent supplies MongoDB for database records. This app also uses its GridFS capability for private files at launch. External R2/S3 is optional until scale, retention, or cost requirements justify it.
            </div>
          ) : null}
          {selected === "ai" ? (
            <div className="notice notice-info">
              Local mode performs MediaPipe tracking and the enhanced face mask on the device with no cloud key. Emergent LLM helps explain quality and provider status, but only the separately configured GPU worker transforms cloud video frames.
            </div>
          ) : null}
          {selected === "gpu" ? (
            <div className="notice notice-warning">
              A RunPod, Modal, Replicate, or custom account is not enough by itself. Deploy a compatible inference worker at the URL above. Until its health check passes, calls use the local enhanced face mask.
            </div>
          ) : null}
          {message ? <div className="notice notice-info">{message}</div> : null}
          {definition.fields
            .filter((field) => !field.show || field.show(effectiveValues))
            .map((field) => (
              <ProviderField
                key={field.key}
                field={field}
                value={effectiveValues[field.key]}
                fingerprint={current?.secrets[field.key]}
                onChange={(value) =>
                  setDraft((existing) => ({ ...existing, [field.key]: value }))
                }
              />
            ))}
          {selected === "email" ? (
            <div className="field">
              <label htmlFor="testRecipient">Send test email to</label>
              <input
                id="testRecipient"
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                placeholder="you@example.com"
              />
              <small>Save the email configuration before sending a test.</small>
            </div>
          ) : null}
          <div className="provider-actions">
            <button className="button button-primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              Save settings
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void test()}
              disabled={busy || (selected === "email" && !testRecipient)}
            >
              {selected === "email" ? <MailCheck size={17} /> : null}
              {selected === "email" ? "Send test email" : "Test connection"}
            </button>
            {selected === "ai" ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void diagnoseAi()}
                disabled={busy}
              >
                Run AI diagnostics
              </button>
            ) : null}
          </div>
          <p className="provider-fallback-note">
            “Environment variables remain a fallback” means the backend may use deployment secrets until you save an encrypted admin value. Once saved, the admin value takes priority.
          </p>
        </form>
      </div>
    </>
  );
}

function ProviderField({
  field,
  value,
  fingerprint,
  onChange,
}: {
  field: Field;
  value: unknown;
  fingerprint?: string;
  onChange: (value: string) => void;
}) {
  const common = {
    id: field.key,
    name: field.key,
    defaultValue: field.secret ? "" : String(value ?? ""),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };
  return (
    <div className="field">
      <label htmlFor={field.key}>{field.label}</label>
      {field.type === "select" ? (
        <select {...common}>
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea {...common} />
      ) : (
        <input
          {...common}
          type={field.secret ? "password" : field.type ?? "text"}
          placeholder={field.secret ? fingerprint ?? "Enter secret" : undefined}
          autoComplete="off"
        />
      )}
      <small>{field.helper}</small>
    </div>
  );
}

function gatewayFields(name: string): Field[] {
  return [
    { key: "enabled", label: "Status", helper: `Enable ${name} checkout after adding a live or test key.`, type: "select", options: yesNo },
    { key: "mode", label: "Mode", helper: "Use test while validating checkout and webhooks.", type: "select", options: [
      { value: "test", label: "Test" },
      { value: "live", label: "Live" },
    ] },
    { key: "secretKey", label: "Secret key", helper: "Encrypted server-side credential.", secret: true },
    { key: "webhookSecret", label: "Webhook secret/hash", helper: "Used to verify payment events.", secret: true },
  ];
}

function externalStorage(values: Record<string, unknown>) {
  return ["r2", "s3"].includes(String(values.futureProvider ?? ""));
}

function customSmtp(values: Record<string, unknown>) {
  return values.provider === "smtp";
}

function statusLabel(status?: Provider["configurationStatus"]) {
  if (status === "CONFIGURED") return "Configured";
  if (status === "PARTIALLY_CONFIGURED") return "Partially configured";
  return "Unconfigured";
}

function statusTone(status?: Provider["configurationStatus"]) {
  if (status === "CONFIGURED") return "success" as const;
  if (status === "PARTIALLY_CONFIGURED") return "warning" as const;
  return "neutral" as const;
}
