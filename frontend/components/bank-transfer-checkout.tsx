"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Banknote,
  CheckCircle2,
  Copy,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader } from "./ui";

interface BankConfig {
  bankName: string;
  accountName: string;
  accountNumber: string;
  currency: string;
  instructions: string;
  proofRequired: boolean;
}

export function BankTransferCheckout() {
  const search = useSearchParams();
  const type = search.get("type") === "credits" ? "credits" : "subscription";
  const planId = search.get("planId") ?? undefined;
  const creditPackKey = search.get("creditPackKey") ?? undefined;
  const bank = useApiResource<BankConfig>("/billing/manual-bank");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
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
          ...jsonBody({
            contentType: proof.type,
            sizeBytes: proof.size,
          }),
        });
        const response = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: proof,
        });
        if (!response.ok) throw new Error("Receipt upload failed");
        proofObjectKey = upload.objectKey;
      }
      await apiFetch("/billing/checkout/manual", {
        method: "POST",
        ...jsonBody({
          type,
          planId,
          creditPackKey,
          transferReference: reference,
          proofObjectKey,
        }),
      });
      setSubmitted(true);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="bank-checkout-success panel">
        <CheckCircle2 size={38} />
        <h1>Payment submitted for review</h1>
        <p>
          Your subscription or credits remain pending until a finance admin
          verifies the transfer. Clicking paid never credits the account.
        </p>
        <a href="/billing" className="button button-primary">
          View payment status
        </a>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Bank transfer checkout"
        description="Transfer to the configured account, then submit a reference and private proof for review."
      />
      {bank.loading ? <LoadingState /> : null}
      {bank.error ? <ErrorState message={bank.error} /> : null}
      {error ? <ErrorState message={error} /> : null}
      {bank.data ? (
        <div className="bank-checkout-layout">
          <section className="panel bank-details">
            <Banknote size={26} />
            <div>
              <span>Bank</span>
              <strong>{bank.data.bankName}</strong>
            </div>
            <div>
              <span>Account name</span>
              <strong>{bank.data.accountName}</strong>
            </div>
            <div>
              <span>Account number</span>
              <strong>{bank.data.accountNumber}</strong>
              <button
                className="icon-button"
                onClick={() =>
                  void navigator.clipboard.writeText(bank.data!.accountNumber)
                }
              >
                <Copy size={15} />
              </button>
            </div>
            <p>{bank.data.instructions}</p>
          </section>
          <section className="panel form-grid">
            <div className="field">
              <label htmlFor="reference">Transfer reference</label>
              <input
                id="reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Bank narration or transaction reference"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="proof">
                Payment proof{bank.data.proofRequired ? "" : " (optional)"}
              </label>
              <label className="file-drop">
                <Upload size={20} />
                <span>{proof?.name ?? "Choose receipt image or PDF"}</span>
                <input
                  id="proof"
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) =>
                    setProof(event.target.files?.[0] ?? null)
                  }
                />
              </label>
            </div>
            <div className="notice notice-info">
              Every approval or rejection is recorded in the admin audit log.
              Funds are never credited from this screen alone.
            </div>
            <button
              className="button button-primary"
              disabled={
                busy ||
                reference.trim().length < 4 ||
                (bank.data.proofRequired && !proof)
              }
              onClick={() => void submit()}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              Submit payment for review
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
