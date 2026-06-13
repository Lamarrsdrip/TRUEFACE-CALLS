"use client";

import { useEffect, useState } from "react";
import { AuthFrame } from "../../components/auth-form";
import { apiFetch, jsonBody } from "../../lib/api";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(sessionStorage.getItem("trueface-development-reset-token") ?? "");
  }, []);

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
