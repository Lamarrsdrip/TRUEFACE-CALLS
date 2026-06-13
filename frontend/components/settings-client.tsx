"use client";

import { useRouter } from "next/navigation";
import { LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface Session {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  status: string;
  adminProfile: {
    role: string;
    active: boolean;
  } | null;
}

export function SettingsClient() {
  const router = useRouter();
  const session = useApiResource<Session>("/auth/session");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("tf-theme");
    const next =
      stored === "dark" ||
      (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("tf-theme", next);
    document.documentElement.dataset.theme = next;
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Account settings"
        description="Review your identity, verification, and access level."
      />
      {session.loading ? <LoadingState /> : null}
      {session.error ? <ErrorState message={session.error} /> : null}
      {session.data ? (
        <div className="settings-grid">
          <section className="panel">
            <div className="panel-title">Profile</div>
            <dl className="details-list">
              <div>
                <dt>Name</dt>
                <dd>{session.data.displayName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.data.email}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge tone="success">
                    {session.data.status.toLowerCase()}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <div className="panel-title">Security</div>
            <div className="notice notice-info">
              <ShieldCheck size={18} />
              Email is{" "}
              {session.data.emailVerifiedAt ? "verified" : "not yet verified"}.
              Sessions use rotating refresh tokens and secure cookies.
            </div>
            <button className="button button-danger mt-5" onClick={logout}>
              <LogOut size={17} /> Sign out this session
            </button>
          </section>
          <section className="panel">
            <div className="panel-title">Appearance</div>
            <p className="text-sm leading-6 text-slate-500">
              Use a light or dark workspace. The preference is stored only in
              this browser.
            </p>
            <button
              className="button button-secondary mt-5"
              onClick={toggleTheme}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
              Switch to {theme === "light" ? "dark" : "light"} mode
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
