"use client";

import { useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";

const packs = [
  { creditsMilli: 25_000, amountMinor: 1_000, label: "25 credits" },
  { creditsMilli: 75_000, amountMinor: 2_500, label: "75 credits" },
  { creditsMilli: 200_000, amountMinor: 5_500, label: "200 credits" },
];

export function BuyCreditsForm() {
  const [pack, setPack] = useState(packs[1]!);
  const [provider, setProvider] = useState<
    "stripe" | "paystack" | "flutterwave"
  >("stripe");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ checkoutUrl: string }>(
        "/billing/checkout/credits",
        {
          method: "POST",
          ...jsonBody({
            provider,
            creditsMilli: pack.creditsMilli,
            amountMinor: pack.amountMinor,
            currency: "USD",
          }),
        },
      );
      window.location.assign(result.checkoutUrl);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card form-grid">
      {error ? <div className="notice notice-danger">{error}</div> : null}
      <div className="credit-pack-grid">
        {packs.map((item) => (
          <button
            key={item.creditsMilli}
            type="button"
            className={
              pack.creditsMilli === item.creditsMilli
                ? "credit-pack selected"
                : "credit-pack"
            }
            onClick={() => setPack(item)}
          >
            <strong>{item.label}</strong>
            <span>${(item.amountMinor / 100).toFixed(2)}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="provider">Payment provider</label>
        <select
          id="provider"
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
        </select>
      </div>
      <div className="notice notice-info">
        Checkout opens only when this provider is configured by an admin.
        Provider webhooks, not redirects, settle your credit balance.
      </div>
      <button
        className="button button-primary"
        onClick={checkout}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <ExternalLink size={17} />
        )}
        Continue to checkout
      </button>
    </div>
  );
}
