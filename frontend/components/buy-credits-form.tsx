"use client";

import { useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";

interface CreditPack {
  key: string;
  name: string;
  creditsMilli: number;
  amountMinor: number;
  currency: string;
}

export function BuyCreditsForm() {
  const packs = useApiResource<{ packs: CreditPack[] }>(
    "/billing/credit-packs",
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [provider, setProvider] = useState<
    "stripe" | "paystack" | "flutterwave" | "bank"
  >("stripe");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const pack = packs.data?.packs.find(
        (candidate) =>
          candidate.key === (selectedKey || packs.data?.packs[0]?.key),
      );
      if (!pack) throw new Error("Choose a configured credit pack");
      if (provider === "bank") {
        window.location.assign(
          `/billing/bank-transfer?type=credits&creditPackKey=${encodeURIComponent(pack.key)}`,
        );
        return;
      }
      const result = await apiFetch<{ checkoutUrl: string }>(
        "/billing/checkout/credits",
        {
          method: "POST",
          ...jsonBody({
            provider,
            packKey: pack.key,
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
        {packs.data?.packs.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={
              (selectedKey || packs.data?.packs[0]?.key) === item.key
                ? "credit-pack selected"
                : "credit-pack"
            }
            onClick={() => setSelectedKey(item.key)}
          >
            <strong>
              {item.name || `${item.creditsMilli / 1000} credits`}
            </strong>
            <span>
              {item.currency} {(item.amountMinor / 100).toFixed(2)}
              {index === 0 ? " · starter" : ""}
            </span>
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
          <option value="bank">Bank transfer</option>
        </select>
      </div>
      <div className="notice notice-info">
        Checkout opens only when this provider is configured by an admin.
        Provider webhooks, not redirects, settle your credit balance.
      </div>
      <button
        className="button button-primary"
        onClick={checkout}
        disabled={busy || packs.loading}
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
