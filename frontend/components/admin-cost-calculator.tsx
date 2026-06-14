"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Save } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { moneyFromMinor } from "../lib/format";

interface Setting {
  namespace: string;
  key: string;
  publicValue: unknown;
}

interface Plan {
  id: string;
  name: string;
  monthlyCredits: number;
  priceMonthlyMinor: number;
  currency: string;
}

interface CreditPack {
  key: string;
  name: string;
  creditsMilli: number;
  amountMinor: number;
  currency: string;
}

const defaults = {
  livekitPerParticipantMinute: 7,
  bandwidthPerGb: 150,
  gbPerHdMinute: 0.018,
  browserAiPerMinute: 1,
  gpuAiPerMinute: 60,
  hostingMonthly: 250000,
  databaseStorageMonthly: 100000,
  expectedSubscribers: 500,
  paymentPercent: 1.5,
  paymentFixed: 100,
  targetMarginPercent: 70,
};

const usageDefaults = {
  baseCallMilliPerMinute: 500,
  aiFaceMilliPerMinute: 2000,
  voiceEffectMilliPerMinute: 2500,
  cloudGpuMilliPerMinute: 5000,
  lowMultiplier: 1,
  standardMultiplier: 1.25,
  hdMultiplier: 2,
  participantMultiplierStep: 0.15,
  paidReservationSeconds: 300,
  trialReservationSeconds: 30,
};

export function AdminCostCalculator() {
  const settings = useApiResource<Setting[]>(
    "/admin/settings?namespace=billing",
  );
  const plans = useApiResource<Plan[]>("/admin/plans");
  const [model, setModel] = useState(defaults);
  const [usageRates, setUsageRates] = useState(usageDefaults);
  const [packs, setPacks] = useState(
    JSON.stringify(
      {
        packs: [
          {
            key: "starter",
            name: "Starter credits",
            creditsMilli: 25_000,
            amountMinor: 250000,
            currency: "NGN",
          },
        ],
      },
      null,
      2,
    ),
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const cost = settings.data?.find((item) => item.key === "cost-model");
    const creditPacks = settings.data?.find(
      (item) => item.key === "credit-packs",
    );
    const configuredUsage = settings.data?.find(
      (item) => item.key === "usage-rates",
    );
    if (cost?.publicValue && typeof cost.publicValue === "object") {
      setModel((current) => ({
        ...current,
        ...(cost.publicValue as Partial<typeof defaults>),
      }));
    }
    if (creditPacks?.publicValue) {
      setPacks(JSON.stringify(creditPacks.publicValue, null, 2));
    }
    if (
      configuredUsage?.publicValue &&
      typeof configuredUsage.publicValue === "object"
    ) {
      setUsageRates((current) => ({
        ...current,
        ...(configuredUsage.publicValue as Partial<typeof usageDefaults>),
      }));
    }
  }, [settings.data]);

  const economics = useMemo(() => {
    const allocatedFixed =
      (model.hostingMonthly + model.databaseStorageMonthly) /
      Math.max(1, model.expectedSubscribers);
    const standardMinute =
      model.livekitPerParticipantMinute +
      model.browserAiPerMinute +
      model.bandwidthPerGb * model.gbPerHdMinute * 0.67;
    const hdMinute =
      model.livekitPerParticipantMinute +
      model.browserAiPerMinute +
      model.bandwidthPerGb * model.gbPerHdMinute;
    const gpuMinute = hdMinute + model.gpuAiPerMinute;
    return { allocatedFixed, standardMinute, hdMinute, gpuMinute };
  }, [model]);

  const packEconomics = useMemo(() => {
    try {
      const parsed = JSON.parse(packs) as { packs?: CreditPack[] };
      if (!Array.isArray(parsed.packs)) {
        return [];
      }

      const paymentRate = model.paymentPercent / 100;
      const targetMargin = model.targetMarginPercent / 100;
      const sellableShare = 1 - paymentRate - targetMargin;

      return parsed.packs.map((pack) => {
        const estimatedMinutes = Math.max(0, pack.creditsMilli) / 1000;
        const estimatedCost = estimatedMinutes * economics.standardMinute;
        const suggestedMinimum =
          sellableShare > 0
            ? (estimatedCost + model.paymentFixed) / sellableShare
            : Number.POSITIVE_INFINITY;
        const currentPrice = pack.amountMinor / 100;
        const paymentFee = currentPrice * paymentRate + model.paymentFixed;
        const margin =
          currentPrice > 0
            ? ((currentPrice - estimatedCost - paymentFee) / currentPrice) * 100
            : 0;

        return { ...pack, estimatedCost, suggestedMinimum, margin };
      });
    } catch {
      return [];
    }
  }, [economics.standardMinute, model, packs]);

  async function save() {
    let parsedPacks: object;
    try {
      parsedPacks = JSON.parse(packs) as object;
    } catch {
      setMessage("Credit packs must be valid JSON.");
      return;
    }
    await Promise.all([
      apiFetch("/admin/settings/billing/cost-model", {
        method: "PUT",
        ...jsonBody({ value: model }),
      }),
      apiFetch("/admin/settings/billing/credit-packs", {
        method: "PUT",
        ...jsonBody({ value: parsedPacks }),
      }),
      apiFetch("/admin/settings/billing/usage-rates", {
        method: "PUT",
        ...jsonBody({ value: usageRates }),
      }),
    ]);
    setMessage("Cost assumptions and credit packs saved with an audit record.");
    await settings.refresh();
  }

  return (
    <section className="panel admin-economics">
      <div className="admin-economics-head">
        <div>
          <h2>
            <Calculator size={18} /> Cost and margin calculator
          </h2>
          <p>
            Planning estimates only. Replace assumptions with actual provider
            invoices before changing production pricing.
          </p>
        </div>
        <button className="button button-primary" onClick={() => void save()}>
          <Save size={15} /> Save model
        </button>
      </div>
      {message ? <div className="notice notice-info">{message}</div> : null}
      <div className="cost-input-grid">
        {Object.entries(model).map(([key, value]) => (
          <label className="field" key={key}>
            <span>{humanize(key)}</span>
            <input
              type="number"
              step="0.001"
              value={value}
              onChange={(event) =>
                setModel((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>
      <div className="admin-economics-head usage-rate-heading">
        <div>
          <h2>Credit usage engine</h2>
          <p>
            Server-enforced milli-credit rates. One credit equals 1,000
            milli-credits; clients cannot override these values.
          </p>
        </div>
      </div>
      <div className="cost-input-grid">
        {Object.entries(usageRates).map(([key, value]) => (
          <label className="field" key={key}>
            <span>{humanize(key)}</span>
            <input
              type="number"
              min="0"
              step={key.includes("Multiplier") ? "0.01" : "1"}
              value={value}
              onChange={(event) =>
                setUsageRates((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>
      <div className="cost-output-grid">
        <div>
          <span>Standard AI cost/min</span>
          <strong>{nairaMajor(economics.standardMinute)}</strong>
        </div>
        <div>
          <span>HD AI cost/min</span>
          <strong>{nairaMajor(economics.hdMinute)}</strong>
        </div>
        <div>
          <span>Cloud GPU cost/min</span>
          <strong>{nairaMajor(economics.gpuMinute)}</strong>
        </div>
        <div>
          <span>Fixed cost/subscriber</span>
          <strong>{nairaMajor(economics.allocatedFixed)}</strong>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Price</th>
              <th>Included AI cost</th>
              <th>Estimated margin</th>
            </tr>
          </thead>
          <tbody>
            {plans.data?.map((plan) => {
              const estimatedMinutes = plan.monthlyCredits / 1000;
              const variableCost =
                estimatedMinutes * economics.standardMinute +
                economics.allocatedFixed;
              const paymentFee =
                (plan.priceMonthlyMinor / 100) * (model.paymentPercent / 100) +
                model.paymentFixed;
              const margin =
                plan.priceMonthlyMinor > 0
                  ? ((plan.priceMonthlyMinor / 100 -
                      variableCost -
                      paymentFee) /
                      (plan.priceMonthlyMinor / 100)) *
                    100
                  : 0;
              return (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>
                    {moneyFromMinor(plan.priceMonthlyMinor, plan.currency)}
                  </td>
                  <td>{nairaMajor(variableCost)}</td>
                  <td>{margin.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Credit pack</th>
              <th>Current price</th>
              <th>Estimated usage cost</th>
              <th>Minimum at target margin</th>
              <th>Current margin</th>
            </tr>
          </thead>
          <tbody>
            {packEconomics.map((pack) => (
              <tr key={pack.key}>
                <td>{pack.name}</td>
                <td>{moneyFromMinor(pack.amountMinor, pack.currency)}</td>
                <td>{nairaMajor(pack.estimatedCost)}</td>
                <td>
                  {Number.isFinite(pack.suggestedMinimum)
                    ? moneyFromMinor(
                        Math.ceil(pack.suggestedMinimum * 100),
                        pack.currency,
                      )
                    : "Lower target margin"}
                </td>
                <td>{pack.margin.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="field">
        <span>Admin-configured credit packs</span>
        <textarea
          className="cost-pack-json"
          value={packs}
          onChange={(event) => setPacks(event.target.value)}
        />
      </label>
    </section>
  );
}

function humanize(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function nairaMajor(value: number) {
  return moneyFromMinor(Math.round(value * 100));
}
