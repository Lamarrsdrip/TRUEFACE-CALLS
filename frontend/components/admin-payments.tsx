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
  expiresAt?: string;
  paymentReference?: string;
  transferReference?: string;
  proofObjectKey?: string;
  adminNotes?: string;
  user: { email: string; displayName: string };
  metadata: { proofObjectKey?: string; transferReference?: string } | null;
}

export function AdminPayments() {
  const payments = useApiResource<PaymentRecord[]>("/admin/payments");
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    setBusyId(id);
    try {
      await apiFetch(`/admin/payments/${id}/decision`, {
        method: "POST",
        ...jsonBody({
          decision,
          reason:
            notes[id]?.trim() || `Manual transfer ${decision.toLowerCase()}`,
        }),
      });
      setMessage(`Manual payment ${decision.toLowerCase()}d and audited.`);
      await payments.refresh();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Review failed.");
    } finally {
      setBusyId(null);
    }
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
                {payment.paymentReference
                  ? ` · code ${payment.paymentReference}`
                  : ""}
              </span>
            </div>
            <strong>
              {moneyFromMinor(payment.amountMinor, payment.currency)}
            </strong>
            <StatusBadge
              tone={
                ["SUCCEEDED", "APPROVED"].includes(payment.status)
                  ? "success"
                  : ["FAILED", "REJECTED", "EXPIRED"].includes(payment.status)
                    ? "danger"
                    : "warning"
              }
            >
              {payment.status.toLowerCase()}
            </StatusBadge>
            {payment.provider === "MANUAL" &&
            ["PENDING", "EXPIRED"].includes(payment.status) ? (
              <div className="admin-actions">
                <input
                  value={notes[payment.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [payment.id]: event.target.value,
                    }))
                  }
                  placeholder="Review notes (optional)"
                />
                {(payment.proofObjectKey ||
                  payment.metadata?.proofObjectKey) ? (
                  <button
                    className="button button-secondary button-sm"
                    onClick={() => void viewProof(payment.id)}
                  >
                    View proof
                  </button>
                ) : null}
                <button
                  className="button button-primary button-sm"
                  disabled={busyId === payment.id}
                  onClick={() => void decide(payment.id, "APPROVE")}
                >
                  Approve
                </button>
                <button
                  className="button button-danger button-sm"
                  disabled={busyId === payment.id}
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
