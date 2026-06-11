"use client";

import {
  BadgeDollarSign,
  Clock3,
  ShieldAlert,
  Sparkles,
  Users,
  Video,
  ServerCog,
  TriangleAlert,
} from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { creditsFromMilli, moneyFromMinor } from "../lib/format";
import { ErrorState, LoadingState, PageHeader, StatCard } from "./ui";

interface Overview {
  users: number;
  activeSubscriptions: number;
  trialUsers: number;
  activeRooms: number;
  pendingFaces: number;
  faceProfiles: number;
  openReports: number;
  pendingManualPayments: number;
  revenueMinor: number;
  creditsSoldMilli: number;
  aiMinutes: number;
  creditsConsumedMilli: number;
  failedWebhooks: number;
  systemAlerts: number;
  providerHealth: Array<{
    provider: string;
    status: string;
    latencyMs: number | null;
  }>;
}

export function AdminOverview() {
  const { data, loading, error } = useApiResource<Overview>("/admin/overview");
  return (
    <>
      <PageHeader
        title="Operations overview"
        description="Live product, safety, billing, and usage signals from the production database."
      />
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {data ? (
        <>
          <section className="stats-grid">
            <StatCard
              label="Users"
              value={data.users}
              icon={<Users size={17} />}
            />
            <StatCard
              label="Active subscriptions"
              value={data.activeSubscriptions}
              icon={<BadgeDollarSign size={17} />}
            />
            <StatCard
              label="Active rooms"
              value={data.activeRooms}
              icon={<Video size={17} />}
            />
            <StatCard
              label="Revenue"
              value={moneyFromMinor(data.revenueMinor)}
              icon={<BadgeDollarSign size={17} />}
            />
          </section>
          <section className="stats-grid mt-4">
            <StatCard
              label="Trial users"
              value={data.trialUsers}
              icon={<Users size={17} />}
            />
            <StatCard
              label="AI minutes"
              value={data.aiMinutes}
              icon={<Clock3 size={17} />}
            />
            <StatCard
              label="Credits consumed"
              value={creditsFromMilli(data.creditsConsumedMilli)}
              icon={<Sparkles size={17} />}
            />
            <StatCard
              label="Credits sold"
              value={creditsFromMilli(data.creditsSoldMilli)}
              icon={<Sparkles size={17} />}
            />
          </section>
          <section className="stats-grid mt-4">
            <StatCard
              label="Face profiles"
              value={data.faceProfiles}
              icon={<Sparkles size={17} />}
            />
            <StatCard
              label="Open abuse reports"
              value={data.openReports}
              icon={<ShieldAlert size={17} />}
            />
            <StatCard
              label="Manual payments"
              value={data.pendingManualPayments}
              icon={<BadgeDollarSign size={17} />}
            />
            <StatCard
              label="System alerts"
              value={data.systemAlerts}
              icon={<TriangleAlert size={17} />}
            />
          </section>
          <section className="admin-health-panel">
            <div>
              <h2>Provider health</h2>
              <p>
                Last recorded connection state for infrastructure and payment
                services.
              </p>
            </div>
            <div className="admin-health-list">
              {data.providerHealth.length ? (
                data.providerHealth.map((provider) => (
                  <div key={provider.provider}>
                    <ServerCog size={16} />
                    <strong>{provider.provider}</strong>
                    <span>{provider.status.toLowerCase()}</span>
                    <small>
                      {provider.latencyMs === null
                        ? "not tested"
                        : `${provider.latencyMs} ms`}
                    </small>
                  </div>
                ))
              ) : (
                <p>No provider tests recorded yet.</p>
              )}
            </div>
            <div className="admin-health-footer">
              <span>{data.pendingFaces} faces awaiting review</span>
              <span>{data.failedWebhooks} failed webhooks</span>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
