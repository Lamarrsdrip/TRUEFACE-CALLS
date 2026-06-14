"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  Clock3,
  Copy,
  LoaderCircle,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";
import { formatDate, moneyFromMinor } from "../lib/format";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface ManualPayment {
  id: string;
  type: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  amountMinor: number;
  currency: "NGN";
  paymentReference: string;
  expiresAt: string;
  submittedAt: string | null;
  bank: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    instructions: string;
    expiryMinutes: number;
    proofRequired: boolean;
  };
}

export function BankTransferCheckout() {
  const search = useSearchParams();
  const type = search.get("type") === "credits" ? "credits" : "subscription";
  const planId = search.get("planId") ?? undefined;
  const creditPackKey = search.get("creditPackKey") ?? undefined;
  const created = useRef(false);
  const [payment, setPayment] = useState<ManualPayment | null>(null);
  const [transferReference, setTransferReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (created.current) return;
    created.current = true;
    const storageKey = `trueface-bank-${type}-${planId ?? creditPackKey ?? "unknown"}`;
    let checkoutKey = window.sessionStorage.getItem(storageKey);
    if (!checkoutKey) {
      checkoutKey = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, checkoutKey);
    }
    apiFetch<ManualPayment>("/billing/checkout/manual-session", {
      method: "POST",
      ...jsonBody({ type, planId, creditPackKey, checkoutKey }),
    })
      .then(setPayment)
      .catch((value) =>
        setError(value instanceof Error ? value.message : "Checkout could not be opened."),
      );
  }, [creditPackKey, planId, type]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!payment || !["PENDING", "EXPIRED"].includes(payment.status)) return;
    const timer = window.setInterval(() => {
      apiFetch<ManualPayment>(`/billing/payments/${payment.id}`)
        .then((record) =>
          setPayment((current) =>
            current ? { ...current, ...record, bank: current.bank } : current,
          ),
        )
        .catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [payment?.id, payment?.status]);

  const secondsLeft = useMemo(
    () =>
      payment
        ? Math.max(0, Math.floor((new Date(payment.expiresAt).getTime() - now) / 1000))
        : 0,
    [now, payment],
  );

  async function submit() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      let proofObjectKey: string | undefined;
      if (proof) {
        const upload = await apiFetch<{
          objectKey: string;
          url: string;
          headers: Record<string, string>;
        }>("/billing/manual-proof-upload", {
          method: "POST",
          ...jsonBody({ contentType: proof.type, sizeBytes: proof.size }),
        });
        const response = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: proof,
        });
        if (!response.ok) throw new Error("Receipt upload failed.");
        proofObjectKey = upload.objectKey;
      }
      await apiFetch(`/billing/checkout/manual-session/${payment.id}/submit`, {
        method: "POST",
        ...jsonBody({ transferReference, proofObjectKey }),
      });
      setPayment({ ...payment, submittedAt: new Date().toISOString() });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Payment could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !payment) return <ErrorState message={error} />;
  if (!payment) return <LoadingState label="Creating secure Naira checkout" />;
  if (payment.status !== "PENDING") return <PaymentResult payment={payment} />;

  return (
    <>
      <PageHeader
        title="Bank transfer checkout"
        description="Pay the exact Naira amount below. Your plan or credits activate only after administrator confirmation."
      />
      {error ? <ErrorState message={error} /> : null}
      <div className="checkout-summary panel">
        <div>
          <span>Exact amount</span>
          <strong>{moneyFromMinor(payment.amountMinor)}</strong>
        </div>
        <div>
          <span>Payment code</span>
          <strong>{payment.paymentReference}</strong>
        </div>
        <div>
          <span>Time remaining</span>
          <strong className={secondsLeft < 300 ? "text-red-600" : ""}>
            <Clock3 size={17} /> {countdown(secondsLeft)}
          </strong>
        </div>
      </div>
      <div className="notice notice-warning checkout-narration">
        Put <strong>{payment.paymentReference}</strong> in your transfer narration if your bank allows it. It is helpful but not compulsory.
      </div>
      <div className="bank-checkout-layout">
        <section className="panel bank-details">
          <Banknote size={28} />
          <div><span>Bank</span><strong>{payment.bank.bankName}</strong></div>
          <div><span>Account name</span><strong>{payment.bank.accountName}</strong></div>
          <div>
            <span>Account number</span>
            <strong>{payment.bank.accountNumber}</strong>
            <CopyButton value={payment.bank.accountNumber} label="Copy account number" />
          </div>
          <div>
            <span>Amount</span>
            <strong>{moneyFromMinor(payment.amountMinor)}</strong>
            <CopyButton value={String(payment.amountMinor / 100)} label="Copy amount" />
          </div>
          {payment.bank.instructions ? <p>{payment.bank.instructions}</p> : null}
        </section>
        <section className="panel form-grid">
          <div className="checkout-secure"><ShieldCheck size={18} /> Pending manual verification</div>
          <div className="field">
            <label htmlFor="reference">Bank transfer reference (optional)</label>
            <input
              id="reference"
              value={transferReference}
              onChange={(event) => setTransferReference(event.target.value)}
              placeholder="Transaction ID or narration from your bank"
            />
          </div>
          <div className="field">
            <label htmlFor="proof">
              Payment receipt{payment.bank.proofRequired ? "" : " (optional)"}
            </label>
            <label className="file-drop">
              <Upload size={20} />
              <span>{proof?.name ?? "Choose receipt image or PDF"}</span>
              <input
                id="proof"
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => setProof(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="notice notice-info">
            Clicking below never credits your account by itself. A finance administrator must match and approve the transfer.
          </div>
          <button
            className="button button-primary"
            disabled={busy || secondsLeft === 0 || (payment.bank.proofRequired && !proof)}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            {payment.submittedAt ? "Update payment evidence" : "I have completed the transfer"}
          </button>
          {payment.submittedAt ? (
            <p className="text-sm text-slate-500">
              Submitted {formatDate(payment.submittedAt)}. This page checks for approval automatically.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
    </button>
  );
}

function PaymentResult({ payment }: { payment: ManualPayment }) {
  const approved = payment.status === "APPROVED";
  return (
    <div className="bank-checkout-success panel">
      {approved ? <CheckCircle2 size={40} /> : <XCircle size={40} />}
      <StatusBadge tone={approved ? "success" : "danger"}>{payment.status.toLowerCase()}</StatusBadge>
      <h1>{approved ? "Payment approved" : payment.status === "EXPIRED" ? "Payment session expired" : "Payment rejected"}</h1>
      <p>
        {approved
          ? "Your subscription or purchased credits have been activated."
          : payment.status === "EXPIRED"
            ? "The checkout timer ended. An administrator can still approve a transfer already received."
            : "This transfer was not approved. Check billing history or contact support."}
      </p>
      <a href="/billing" className="button button-primary">View billing</a>
    </div>
  );
}

function countdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
