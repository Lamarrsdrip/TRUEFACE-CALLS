"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Coins,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
} from "./ui";
import { apiFetch } from "../lib/api";
import { creditsFromMilli, estimatedMinutes, formatDate } from "../lib/format";

interface Wallet {
  availableMilliCredits: number;
  reservedMilliCredits: number;
}

interface Subscription {
  status: string;
  currentPeriodEnd: string | null;
  plan: { name: string; maxFaceProfiles: number };
}

interface Call {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  history: { endedAt: string } | null;
  _count: { participants: number };
}

interface Face {
  id: string;
  name: string;
  moderationStatus: string;
}

export function DashboardClient() {
  const [state, setState] = useState<{
    wallet: Wallet;
    subscription: Subscription | null;
    calls: Call[];
    faces: Face[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Wallet>("/credits/wallet"),
      apiFetch<Subscription | null>("/billing/subscription"),
      apiFetch<Call[]>("/calls/history"),
      apiFetch<Face[]>("/faces"),
    ])
      .then(([wallet, subscription, calls, faces]) =>
        setState({ wallet, subscription, calls, faces }),
      )
      .catch((value) =>
        setError(value instanceof Error ? value.message : "Dashboard failed"),
      );
  }, []);

  return (
    <>
      <PageHeader
        title="Your call workspace"
        description="Create secure calls, manage face consent, and keep usage visible."
        actions={
          <Link href="/create-call" className="button button-primary">
            <Video size={17} />
            Create a call
          </Link>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      {!state && !error ? (
        <LoadingState label="Loading your workspace" />
      ) : null}
      {state ? (
        <>
          <section className="stats-grid">
            <StatCard
              label="Credit balance"
              value={`${creditsFromMilli(state.wallet.availableMilliCredits)} credits`}
              detail={
                state.wallet.reservedMilliCredits > 0
                  ? `${creditsFromMilli(state.wallet.reservedMilliCredits)} reserved for active calls`
                  : "Available for metered features"
              }
              icon={<Coins size={17} />}
            />
            <StatCard
              label="Estimated AI minutes"
              value={estimatedMinutes(
                state.wallet.availableMilliCredits,
                2_500,
              )}
              detail="Standard quality estimate"
              icon={<Sparkles size={17} />}
            />
            <StatCard
              label="Current plan"
              value={state.subscription?.plan.name ?? "No active plan"}
              detail={
                state.subscription?.currentPeriodEnd
                  ? `Renews ${formatDate(state.subscription.currentPeriodEnd)}`
                  : "Choose a plan to create calls"
              }
              icon={<ShieldCheck size={17} />}
            />
            <StatCard
              label="Face profiles"
              value={`${state.faces.length}/${state.subscription?.plan.maxFaceProfiles ?? 1}`}
              detail={
                state.faces.some((face) => face.moderationStatus === "APPROVED")
                  ? "At least one profile is call-ready"
                  : "Approval required before AI use"
              }
              icon={<Sparkles size={17} />}
            />
          </section>
          <section className="content-grid">
            <div className="panel">
              <div className="panel-title">
                <span>Recent calls</span>
                <Link href="/calls" className="text-xs text-indigo-600">
                  View all
                </Link>
              </div>
              {state.calls.length === 0 ? (
                <EmptyState
                  title="No calls yet"
                  description="Create a secure room and share its expiring invite link."
                  action={
                    <Link
                      href="/create-call"
                      className="button button-secondary"
                    >
                      Create call
                    </Link>
                  }
                />
              ) : (
                <div className="list">
                  {state.calls.slice(0, 5).map((call) => (
                    <div className="list-row" key={call.id}>
                      <div className="feature-icon !h-10 !w-10">
                        <CalendarDays size={17} />
                      </div>
                      <div className="list-row-main">
                        <strong>{call.title}</strong>
                        <span>
                          {formatDate(call.createdAt)} ·{" "}
                          {call._count.participants} participants
                        </span>
                      </div>
                      <StatusBadge
                        tone={call.status === "ENDED" ? "neutral" : "success"}
                      >
                        {call.status.toLowerCase()}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-title">
                <span>Face profile status</span>
                <Link href="/faces" className="text-xs text-indigo-600">
                  Manage
                </Link>
              </div>
              {state.faces.length === 0 ? (
                <EmptyState
                  title="Add your first face"
                  description="A quality check and all three consent attestations are required."
                  action={
                    <Link
                      href="/faces/upload"
                      className="button button-secondary"
                    >
                      Add profile
                    </Link>
                  }
                />
              ) : (
                <div className="list">
                  {state.faces.slice(0, 5).map((face) => (
                    <div className="list-row" key={face.id}>
                      <div className="avatar avatar-sm">
                        {face.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="list-row-main">
                        <strong>{face.name}</strong>
                        <span>Consent-controlled profile</span>
                      </div>
                      <StatusBadge
                        tone={
                          face.moderationStatus === "APPROVED"
                            ? "success"
                            : face.moderationStatus === "REJECTED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {face.moderationStatus.toLowerCase()}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          <div className="notice notice-info mt-4">
            <ShieldCheck size={18} />
            Local face processing always requires an approved profile and shows a
            participant-visible disclosure throughout the call.
          </div>
        </>
      ) : null}
    </>
  );
}
