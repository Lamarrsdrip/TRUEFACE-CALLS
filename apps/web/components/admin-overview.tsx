"use client";

import {
  BadgeDollarSign,
  Clock3,
  ShieldAlert,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { creditsFromMilli, moneyFromMinor } from "../lib/format";
import { ErrorState, LoadingState, PageHeader, StatCard } from "./ui";

interface Overview {
  users: number;
  activeSubscriptions: number;
  calls: number;
  pendingFaces: number;
  openReports: number;
  revenueMinor: number;
  aiMinutes: number;
  creditsConsumedMilli: number;
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
              label="Total rooms"
              value={data.calls}
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
              label="Faces awaiting review"
              value={data.pendingFaces}
              icon={<Sparkles size={17} />}
            />
            <StatCard
              label="Open abuse reports"
              value={data.openReports}
              icon={<ShieldAlert size={17} />}
            />
          </section>
        </>
      ) : null}
    </>
  );
}
