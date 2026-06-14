"use client";

import Link from "next/link";
import { Coins, Plus, ReceiptText, Timer } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { creditsFromMilli, formatDate } from "../lib/format";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
} from "./ui";

interface Wallet {
  availableMilliCredits: number;
  reservedMilliCredits: number;
  includedMilliCredits: number;
  purchasedMilliCredits: number;
  lifetimePurchasedMilli: number;
  lifetimeConsumedMilli: number;
  topUpAllowed: boolean;
  activePaidSubscription: boolean;
  nextResetAt: string | null;
  exhausted: boolean;
  plan: { name: string; monthlyCredits: number } | null;
}

interface Transaction {
  id: string;
  type: string;
  amountMilli: number;
  balanceAfterMilli: number;
  source: string;
  reason: string | null;
  createdAt: string;
}

export function CreditsClient() {
  const wallet = useApiResource<Wallet>("/credits/wallet");
  const transactions = useApiResource<Transaction[]>("/credits/transactions");

  return (
    <>
      <PageHeader
        title="Call credits"
        description="Credits are charged from immutable usage records, not browser timers."
        actions={
          wallet.data?.topUpAllowed ? (
            <Link href="/credits/buy" className="button button-primary">
              <Plus size={17} /> Buy credits
            </Link>
          ) : (
            <Link href="/billing" className="button button-primary">
              Upgrade to buy credits
            </Link>
          )
        }
      />
      {wallet.loading ? <LoadingState label="Loading balance" /> : null}
      {wallet.error ? <ErrorState message={wallet.error} /> : null}
      {wallet.data ? (
        <section className="stats-grid">
          <StatCard
            label="Available"
            value={creditsFromMilli(wallet.data.availableMilliCredits)}
            detail="credits"
            icon={<Coins size={17} />}
          />
          <StatCard
            label="Included balance"
            value={creditsFromMilli(wallet.data.includedMilliCredits)}
            detail={
              wallet.data.nextResetAt
                ? `resets ${formatDate(wallet.data.nextResetAt)}`
                : "no reset scheduled"
            }
            icon={<Timer size={17} />}
          />
          <StatCard
            label="Purchased balance"
            value={creditsFromMilli(wallet.data.purchasedMilliCredits)}
            detail="does not reset with monthly credits"
            icon={<ReceiptText size={17} />}
          />
          <StatCard
            label="Lifetime consumed"
            value={creditsFromMilli(wallet.data.lifetimeConsumedMilli)}
            detail="credits"
            icon={<Timer size={17} />}
          />
        </section>
      ) : null}
      {wallet.data?.exhausted ? (
        <div className="notice notice-danger mt-4">
          Your AI credits are exhausted. Upgrade or buy an admin-configured
          credit pack to resume AI face processing.
        </div>
      ) : null}
      <section className="panel mt-4">
        <div className="panel-title">Credit history</div>
        {transactions.loading ? <LoadingState /> : null}
        {transactions.error ? (
          <ErrorState message={transactions.error} />
        ) : null}
        <div className="list">
          {transactions.data?.map((transaction) => (
            <div className="list-row" key={transaction.id}>
              <div className="feature-icon !h-10 !w-10">
                <ReceiptText size={17} />
              </div>
              <div className="list-row-main">
                <strong>{transaction.type.replaceAll("_", " ")}</strong>
                <span>
                  {formatDate(transaction.createdAt)} · {transaction.source}
                  {transaction.reason ? ` · ${transaction.reason}` : ""}
                </span>
              </div>
              <StatusBadge
                tone={transaction.amountMilli >= 0 ? "success" : "neutral"}
              >
                {transaction.amountMilli >= 0 ? "+" : ""}
                {creditsFromMilli(transaction.amountMilli)}
              </StatusBadge>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
