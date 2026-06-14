"use client";

import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useApiResource } from "../hooks/use-api-resource";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

export interface ReadinessPayload {
  callCreationReady: boolean;
  blockingReasons: string[];
  checks: Record<string, {
    status: "READY" | "MISSING";
    message: string;
    requiredForCalls: boolean;
    remainingCredits?: number | null;
  }>;
}

export function SystemReadiness({ compact = false }: { compact?: boolean }) {
  const resource = useApiResource<ReadinessPayload>("/system/readiness");
  const [browserCheck, setBrowserCheck] = useState<{
    ready: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const webgl = Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl"),
    );
    const media = Boolean(navigator.mediaDevices?.getUserMedia);
    const wasm = typeof WebAssembly !== "undefined";
    const ready = webgl && media && wasm;
    setBrowserCheck({
      ready,
      message: ready
        ? "This device supports camera access, WebAssembly, and WebGL browser processing."
        : "This browser is missing camera, WebAssembly, or WebGL support; use a newer browser or stronger device.",
    });
  }, []);
  if (resource.loading) return <LoadingState label="Checking call services" />;
  if (resource.error) return <ErrorState message={resource.error} />;
  if (!resource.data) return null;

  const content = (
    <section className={compact ? "readiness-card panel" : "panel"}>
      <div className="readiness-head">
        <div>
          <h2>{resource.data.callCreationReady ? "Calls are ready" : "Call setup required"}</h2>
          <p>
            {resource.data.callCreationReady
              ? "Every required call service is available."
              : "Resolve the required items before creating a room."}
          </p>
        </div>
        <button className="icon-button" onClick={() => void resource.refresh()} aria-label="Refresh readiness">
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="readiness-list">
        {Object.entries(resource.data.checks).map(([key, serverCheck]) => {
          const check =
            key === "browserAi" && browserCheck
              ? {
                  ...serverCheck,
                  status: browserCheck.ready ? ("READY" as const) : ("MISSING" as const),
                  message: browserCheck.message,
                }
              : serverCheck;
          return (
          <div key={key}>
            {check.status === "READY" ? (
              <CheckCircle2 className="text-emerald-500" size={20} />
            ) : (
              <CircleAlert className="text-amber-500" size={20} />
            )}
            <span>
              <strong>{label(key)}</strong>
              <small>{check.message}</small>
              {key === "emergentAi" && check.remainingCredits != null ? (
                <small>{check.remainingCredits} AI credits remaining</small>
              ) : null}
            </span>
            <StatusBadge tone={check.status === "READY" ? "success" : "warning"}>
              {check.status === "READY" ? "Ready" : check.requiredForCalls ? "Required" : "Optional"}
            </StatusBadge>
          </div>
          );
        })}
      </div>
      {!resource.data.callCreationReady ? (
        <a href="/admin/providers" className="button button-secondary">Open provider settings</a>
      ) : null}
    </section>
  );
  if (compact) return content;
  return (
    <>
      <PageHeader
        title="System readiness"
        description="A live check of the services used by call creation and production notifications."
      />
      {content}
    </>
  );
}

function label(value: string) {
  if (value === "livekit") return "LiveKit";
  if (value === "ai") return "AI";
  if (value === "browserAi") return "Browser AI";
  if (value === "emergentAi") return "Emergent AI";
  if (value === "cloudAi") return "Cloud face processing";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
