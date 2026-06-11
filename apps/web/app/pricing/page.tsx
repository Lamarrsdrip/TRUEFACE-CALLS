"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { MarketingNav } from "../../components/marketing-nav";
import { ErrorState, LoadingState } from "../../components/ui";
import { useApiResource } from "../../hooks/use-api-resource";
import { moneyFromMinor } from "../../lib/format";

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  monthlyCredits: number;
  maxFaceProfiles: number;
  maxParticipants: number;
  allowedQualities: string[];
  groupCalls: boolean;
  voiceEffects: boolean;
  cloudGpu: boolean;
  priceMonthlyMinor: number;
  currency: string;
}

export default function PricingPage() {
  const { data, loading, error } = useApiResource<Plan[]>("/plans");
  return (
    <div className="marketing-page">
      <MarketingNav />
      <section className="pricing-hero">
        <h1>Clear plans. Metered AI usage.</h1>
        <p>
          Subscription access and call credits stay separate, so you can see
          exactly what your quality and processing choices cost.
        </p>
      </section>
      <section className="pricing-grid">
        {loading ? <LoadingState label="Loading current plans" /> : null}
        {error ? <ErrorState message={error} /> : null}
        {data?.map((plan) => (
          <article
            key={plan.id}
            className={`pricing-card ${plan.key === "pro" ? "featured" : ""}`}
          >
            <h2>{plan.name}</h2>
            <p>{plan.description}</p>
            <div className="price">
              {plan.priceMonthlyMinor === 0
                ? "Free"
                : moneyFromMinor(plan.priceMonthlyMinor, plan.currency)}
              {plan.priceMonthlyMinor > 0 ? <span>/month</span> : null}
            </div>
            <ul>
              <li>
                <Check /> {plan.monthlyCredits / 1000} included credits
              </li>
              <li>
                <Check /> {plan.maxFaceProfiles} face profile
                {plan.maxFaceProfiles === 1 ? "" : "s"}
              </li>
              <li>
                <Check /> Up to {plan.maxParticipants} participants
              </li>
              <li>
                <Check /> {plan.allowedQualities.join(", ")} quality
              </li>
              <li className={!plan.groupCalls ? "muted" : ""}>
                {plan.groupCalls ? <Check /> : <Minus />} Group calls
              </li>
              <li className={!plan.cloudGpu ? "muted" : ""}>
                {plan.cloudGpu ? <Check /> : <Minus />} Cloud GPU ready
              </li>
            </ul>
            <Link href="/signup" className="button button-primary">
              Choose {plan.name}
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
