"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthFrame } from "../../components/auth-form";
import { apiFetch, jsonBody } from "../../lib/api";

export default function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setToken(
      sessionStorage.getItem("trueface-development-verification-token") ?? "",
    );
  }, []);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/auth/verify-email", {
        method: "POST",
        ...jsonBody({ token }),
      });
      setStatus("Your email is verified. You can continue to the dashboard.");
    } catch (value) {
      setStatus(value instanceof Error ? value.message : "Verification failed");
    }
  }

  return (
    <AuthFrame
      title="Verify your email"
      description="Use the secure token delivered by the configured email provider."
    >
      <form className="form-grid" onSubmit={verify}>
        {status ? <div className="notice notice-info">{status}</div> : null}
        <div className="field">
          <label htmlFor="token">Verification token</label>
          <input
            id="token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
          <span className="field-hint">
            Development deployments prefill this when email is not configured.
          </span>
        </div>
        <button className="button button-primary">Verify email</button>
        <Link href="/dashboard" className="button button-ghost">
          Continue to dashboard
        </Link>
      </form>
    </AuthFrame>
  );
}
