"use client";

import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { formatDate, moneyFromMinor } from "../lib/format";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  monthlyCredits: number;
  maxFaceProfiles: number;
  maxParticipants: number;
  priceMonthlyMinor: number;
  currency: string;
}

interface Subscription {
  status: string;
  currentPeriodEnd: string | null;
  plan: Plan;
}

interface Payment {
  id: string;
  provider: string;
  type: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
}

export function BillingClient() {
  const plans = useApiResource<Plan[]>("/plans");
  const subscription = useApiResource<Subscription | null>(
    "/billing/subscription",
  );
  const payments = useApiResource<Payment[]>("/billing/payments");
  const [provider, setProvider] = useState<
    "stripe" | "paystack" | "flutterwave" | "bank"
  >("stripe");
  const [error, setError] = useState<string | null>(null);

  async function choose(planId: string) {
    setError(null);
    if (provider === "bank") {
      window.location.assign(
        `/billing/bank-transfer?type=subscription&planId=${encodeURIComponent(planId)}`,
      );
      return;
    }
    try {
      const result = await apiFetch<{ checkoutUrl: string }>(
        "/billing/checkout/subscription",
        { method: "POST", ...jsonBody({ provider, planId }) },
      );
      window.location.assign(result.checkoutUrl);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Checkout failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Subscription and billing"
        description="Provider-confirmed webhooks keep your plan and payment records synchronized."
        actions={
          <select
            aria-label="Payment provider"
            className="provider-select"
            value={provider}
            onChange={(event) =>
              setProvider(
                event.target.value as "stripe" | "paystack" | "flutterwave",
              )
            }
          >
            <option value="stripe">Stripe</option>
            <option value="paystack">Paystack</option>
            <option value="flutterwave">Flutterwave</option>
            <option value="bank">Bank transfer</option>
          </select>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      {plans.loading || subscription.loading ? (
        <LoadingState label="Loading billing" />
      ) : null}
      <section className="billing-plan-grid">
        {plans.data?.map((plan) => {
          const current = subscription.data?.plan.id === plan.id;
          return (
            <article
              className={current ? "plan-row current" : "plan-row"}
              key={plan.id}
            >
              <div>
                <h2>{plan.name}</h2>
                <p>{plan.description}</p>
              </div>
              <div className="plan-details">
                <span>{plan.monthlyCredits / 1000} credits</span>
                <span>{plan.maxFaceProfiles} faces</span>
                <span>{plan.maxParticipants} participants</span>
              </div>
              <div className="plan-price">
                {moneyFromMinor(plan.priceMonthlyMinor, plan.currency)}
                <span>/month</span>
              </div>
              {current ? (
                <StatusBadge tone="success">
                  <Check size={13} /> Current
                </StatusBadge>
              ) : plan.priceMonthlyMinor > 0 ? (
                <button
                  className="button button-secondary"
                  onClick={() => void choose(plan.id)}
                >
                  <ExternalLink size={16} /> Choose
                </button>
              ) : null}
            </article>
          );
        })}
      </section>
      <section className="panel mt-4">
        <div className="panel-title">Payment history</div>
        {payments.error ? <ErrorState message={payments.error} /> : null}
        <div className="list">
          {payments.data?.map((payment) => (
            <div className="list-row" key={payment.id}>
              <div className="list-row-main">
                <strong>{payment.type.replaceAll("_", " ")}</strong>
                <span>
                  {payment.provider} · {formatDate(payment.createdAt)}
                </span>
              </div>
              <strong>
                {moneyFromMinor(payment.amountMinor, payment.currency)}
              </strong>
              <StatusBadge
                tone={
                  payment.status === "SUCCEEDED"
                    ? "success"
                    : payment.status === "FAILED"
                      ? "danger"
                      : "warning"
                }
              >
                {payment.status.toLowerCase()}
              </StatusBadge>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
