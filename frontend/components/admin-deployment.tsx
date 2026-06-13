"use client";

import { CheckCircle2, CircleAlert, ServerCog } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface DeploymentStatus {
  target: string;
  nodeEnvironment: string;
  buildCommand: string;
  startCommand: string;
  environment: Array<{ key: string; configured: boolean }>;
  providers: Array<{
    provider: string;
    status: string;
    checkedAt: string | null;
    configuredKeys: string[];
  }>;
}

export function AdminDeployment() {
  const status = useApiResource<DeploymentStatus>("/admin/deployment");

  return (
    <>
      <PageHeader
        title="System health and deployment readiness"
        description="Secret-safe runtime status for Emergent imports, database bootstrapping, LiveKit, storage, payments, email, and provider activation."
      />
      {status.loading ? <LoadingState /> : null}
      {status.error ? <ErrorState message={status.error} /> : null}
      {status.data ? (
        <div className="deployment-grid">
          <section className="panel deployment-commands">
            <ServerCog size={22} />
            <div>
              <span>Target</span>
              <strong>{status.data.target}</strong>
            </div>
            <div>
              <span>Build</span>
              <code>{status.data.buildCommand}</code>
            </div>
            <div>
              <span>Start</span>
              <code>{status.data.startCommand}</code>
            </div>
          </section>
          <section className="panel">
            <h2>Required environment</h2>
            <div className="readiness-list">
              {status.data.environment.map((variable) => (
                <div key={variable.key}>
                  {variable.configured ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <CircleAlert size={16} />
                  )}
                  <code>{variable.key}</code>
                  <StatusBadge
                    tone={variable.configured ? "success" : "warning"}
                  >
                    {variable.configured ? "configured" : "required"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Provider activation</h2>
            <div className="readiness-list">
              {status.data.providers.map((provider) => (
                <div key={provider.provider}>
                  <ServerCog size={16} />
                  <strong>{provider.provider}</strong>
                  <StatusBadge
                    tone={
                      provider.status === "OPERATIONAL" ? "success" : "neutral"
                    }
                  >
                    {provider.status.toLowerCase()}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
