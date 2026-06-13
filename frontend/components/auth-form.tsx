"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { apiFetch, jsonBody } from "../lib/api";
import { Brand } from "./brand";

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <section className="auth-side">
        <Brand />
        <div className="auth-form-wrap">
          <h1>{title}</h1>
          <p>{description}</p>
          {children}
        </div>
      </section>
      <aside className="auth-visual">
        <h2>Secure calls with accountable AI controls.</h2>
        <p>
          Every face profile starts with permission. Every AI call carries a
          visible disclosure. Every credit charge is recorded.
        </p>
      </aside>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        ...jsonBody({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {error ? (
        <div className="notice notice-danger">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="field">
        <div className="flex justify-between">
          <label htmlFor="password">Password</label>
          <Link href="/forgot-password" className="text-xs text-indigo-600">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <button className="button button-primary" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={17} /> : null}
        Sign in
      </button>
      <p className="text-center text-sm text-slate-500">
        New to TrueFace?{" "}
        <Link href="/signup" className="font-semibold text-indigo-600">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function AdminLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/admin-login", {
        method: "POST",
        ...jsonBody({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      router.replace("/admin/dashboard");
      router.refresh();
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Administrator sign in failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login-page">
      <section className="admin-login-card">
        <Brand />
        <div>
          <span className="admin-console-label">Restricted operations</span>
          <h1>TrueFace Admin Console</h1>
          <p>
            Secure access for platform operations, finance, support, and
            trust-and-safety teams.
          </p>
        </div>
        <form className="form-grid" onSubmit={submit}>
          {error ? (
            <div className="notice notice-danger">
              <AlertCircle size={18} />
              {error}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="admin-email">Admin email</label>
            <input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="button button-primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            Enter admin console
          </button>
        </form>
        <div className="admin-login-security">
          Login attempts are rate-limited and audited. The account model is
          ready for enforced TOTP authentication.
        </div>
      </section>
    </div>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{
        verification?: { developmentToken?: string };
      }>("/auth/signup", {
        method: "POST",
        ...jsonBody({
          displayName: form.get("displayName"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (result.verification?.developmentToken) {
        sessionStorage.setItem(
          "trueface-development-verification-token",
          result.verification.developmentToken,
        );
      }
      router.push("/verify-email");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {error ? <div className="notice notice-danger">{error}</div> : null}
      <div className="field">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          name="displayName"
          autoComplete="name"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={12}
          autoComplete="new-password"
          required
        />
        <span className="field-hint">
          At least 12 characters with upper, lower, and numeric characters.
        </span>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" required />
        <span>
          I agree to the <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </span>
      </label>
      <button className="button button-primary" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={17} /> : null}
        Create account
      </button>
      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-indigo-600">
          Sign in
        </Link>
      </p>
    </form>
  );
}
