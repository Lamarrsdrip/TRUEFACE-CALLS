"use client";

import { useState } from "react";
import { AuthFrame } from "../../components/auth-form";
import { apiFetch, jsonBody } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      const result = await apiFetch<{ developmentToken?: string }>(
        "/auth/forgot-password",
        {
          method: "POST",
          ...jsonBody({ email: form.get("email") }),
        },
      );
      if (result.developmentToken) {
        sessionStorage.setItem(
          "trueface-development-reset-token",
          result.developmentToken,
        );
      }
      setMessage(
        "If the account exists, a reset link is being prepared by the configured email provider.",
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : "Request failed");
    }
  }

  return (
    <AuthFrame
      title="Reset your password"
      description="Enter your account email. The response never reveals whether an account exists."
    >
      <form className="form-grid" onSubmit={submit}>
        {message ? (
          <div className="notice notice-success">{message}</div>
        ) : null}
        {error ? <div className="notice notice-danger">{error}</div> : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <button className="button button-primary">Request reset</button>
      </form>
    </AuthFrame>
  );
}
