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
  roomCreationDisabled: boolean;
  creditWallet: { availableMilliCredits: number } | null;
}

export function AdminUsers() {
  const [search, setSearch] = useState("");
  const users = useApiResource<UserRecord[]>(
    `/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`,
  );
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

  async function toggleRoomAccess(user: UserRecord) {
    await apiFetch(`/admin/users/${user.id}/room-access`, {
      method: "PATCH",
      ...jsonBody({ disabled: !user.roomCreationDisabled }),
    });
    setMessage("Room creation access updated and audited.");
    await users.refresh();
  }

  return (
    <>
      <PageHeader
        title="Users and credits"
        description="Manage account access and apply audited manual credit adjustments."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      <div className="panel admin-search">
        <input
          type="search"
          placeholder="Search by name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
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
            <button
              className="button button-ghost button-sm"
              onClick={() => void toggleRoomAccess(user)}
            >
              {user.roomCreationDisabled ? "Enable rooms" : "Disable rooms"}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
