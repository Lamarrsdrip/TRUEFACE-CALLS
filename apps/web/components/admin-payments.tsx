"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { formatDate, moneyFromMinor } from "../lib/format";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface PaymentRecord {
  id: string;
  provider: string;
  type: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  user: { email: string; displayName: string };
  metadata: { proofObjectKey?: string; transferReference?: string } | null;
}

export function AdminPayments() {
  const payments = useApiResource<PaymentRecord[]>("/admin/payments");
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    await apiFetch(`/admin/payments/${id}/decision`, {
      method: "POST",
      ...jsonBody({
        decision,
        reason: `Manual transfer ${decision.toLowerCase()}`,
      }),
    });
    setMessage(`Manual payment ${decision.toLowerCase()}d and audited.`);
    await payments.refresh();
  }

  async function viewProof(id: string) {
    const proof = await apiFetch<{ url: string }>(
      `/admin/payments/${id}/proof`,
    );
    window.open(proof.url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <PageHeader
        title="Payments and manual review"
        description="Provider payments, refunds, failures, and proof-backed bank transfer approvals."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      {payments.loading ? <LoadingState /> : null}
      {payments.error ? <ErrorState message={payments.error} /> : null}
      <div className="admin-card-list">
        {payments.data?.map((payment) => (
          <article
            className="admin-record admin-payment-record"
            key={payment.id}
          >
            <div className="admin-record-icon">
              <Banknote size={18} />
            </div>
            <div className="admin-record-main">
              <strong>{payment.user.email}</strong>
              <span>
                {payment.provider} · {payment.type} ·{" "}
                {formatDate(payment.createdAt)}
                {payment.metadata?.transferReference
                  ? ` · ref ${payment.metadata.transferReference}`
                  : ""}
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
            {payment.provider === "MANUAL" && payment.status === "PENDING" ? (
              <div className="admin-actions">
                {payment.metadata?.proofObjectKey ? (
                  <button
                    className="button button-secondary button-sm"
                    onClick={() => void viewProof(payment.id)}
                  >
                    View proof
                  </button>
                ) : null}
                <button
                  className="button button-primary button-sm"
                  onClick={() => void decide(payment.id, "APPROVE")}
                >
                  Approve
                </button>
                <button
                  className="button button-danger button-sm"
                  onClick={() => void decide(payment.id, "REJECT")}
                >
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
