"use client";

import { useState } from "react";
import { CircleDollarSign, UserRoundCog } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface UserRecord {
  id: string;
  displayName: string;
  email: string;
  status: string;
  createdAt: string;
  creditWallet: { availableMilliCredits: number } | null;
}

export function AdminUsers() {
  const users = useApiResource<UserRecord[]>("/admin/users");
  const [message, setMessage] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    await apiFetch(`/admin/users/${id}/status`, {
      method: "PATCH",
      ...jsonBody({ status }),
    });
    setMessage("User status updated and audited.");
    await users.refresh();
  }

  async function adjust(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiFetch("/admin/credits/adjust", {
      method: "POST",
      ...jsonBody({
        userId: String(form.get("userId")),
        amountMilli: Math.round(Number(form.get("credits")) * 1000),
        reason: String(form.get("reason")),
      }),
    });
    event.currentTarget.reset();
    setMessage("Credit adjustment applied to the immutable ledger.");
    await users.refresh();
  }

  return (
    <>
      <PageHeader
        title="Users and credits"
        description="Manage account access and apply audited manual credit adjustments."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      <form className="panel admin-inline-form" onSubmit={adjust}>
        <CircleDollarSign size={20} />
        <select name="userId" required defaultValue="">
          <option value="" disabled>
            Select user
          </option>
          {users.data?.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email}
            </option>
          ))}
        </select>
        <input
          name="credits"
          type="number"
          step="0.001"
          placeholder="Credits, e.g. 25"
          required
        />
        <input
          name="reason"
          minLength={5}
          placeholder="Adjustment reason"
          required
        />
        <button className="button button-primary">Adjust credits</button>
      </form>
      {users.loading ? <LoadingState /> : null}
      {users.error ? <ErrorState message={users.error} /> : null}
      <div className="admin-card-list">
        {users.data?.map((user) => (
          <article className="admin-record" key={user.id}>
            <div className="admin-record-icon">
              <UserRoundCog size={19} />
            </div>
            <div className="admin-record-main">
              <strong>{user.displayName}</strong>
              <span>{user.email}</span>
            </div>
            <span>
              {(user.creditWallet?.availableMilliCredits ?? 0) / 1000} credits
            </span>
            <StatusBadge tone={user.status === "ACTIVE" ? "success" : "danger"}>
              {user.status.toLowerCase()}
            </StatusBadge>
            <button
              className="button button-ghost button-sm"
              onClick={() =>
                void setStatus(
                  user.id,
                  user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                )
              }
            >
              {user.status === "ACTIVE" ? "Suspend" : "Activate"}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
