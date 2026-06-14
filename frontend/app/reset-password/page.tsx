"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthFrame } from "../../components/auth-form";
import { apiFetch, jsonBody } from "../../lib/api";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthFrame
          title="Choose a new password"
          description="Loading secure reset form..."
        >
          <div className="state-message">Loading…</div>
        </AuthFrame>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const search = useSearchParams();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(
      search.get("token") ??
        sessionStorage.getItem("trueface-development-reset-token") ??
        "",
    );
  }, [search]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        ...jsonBody({ token, password: form.get("password") }),
      });
      setMessage("Password reset. Existing sessions have been revoked.");
    } catch (value) {
      setMessage(value instanceof Error ? value.message : "Reset failed");
    }
  }

  return (
    <AuthFrame
      title="Choose a new password"
      description="Resetting your password signs out all existing devices."
    >
      <form className="form-grid" onSubmit={submit}>
        {message ? <div className="notice notice-info">{message}</div> : null}
        <div className="field">
          <label htmlFor="token">Reset token</label>
          <input
            id="token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={12}
            required
          />
        </div>
        <button className="button button-primary">Reset password</button>
      </form>
    </AuthFrame>
  );
}
