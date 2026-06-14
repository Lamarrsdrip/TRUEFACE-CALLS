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
  gender: "MALE" | "FEMALE" | "UNSET";
  voicePreference: "MALE_TONE" | "FEMALE_TONE" | "ORIGINAL";
  faceProfileStatus: "NONE" | "PENDING" | "READY" | "ACTION_REQUIRED";
  admin: {
    role: string;
    active: boolean;
  } | null;
}

export function SettingsClient() {
  const router = useRouter();
  const session = useApiResource<Session>("/auth/session");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: String(form.get("displayName")),
          gender: String(form.get("gender")),
          voicePreference: String(form.get("voicePreference")),
        }),
      });
      setMessage("Profile and call preferences saved.");
      await session.refresh();
    } finally {
      setSaving(false);
    }
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
          <form className="panel" onSubmit={saveProfile}>
            <div className="panel-title">Profile</div>
            <div className="field">
              <label htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                name="displayName"
                defaultValue={session.data.displayName}
                minLength={2}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="gender">Gender</label>
              <select id="gender" name="gender" defaultValue={session.data.gender}>
                <option value="UNSET">Prefer not to say / unset</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="voicePreference">Default voice</label>
              <select
                id="voicePreference"
                name="voicePreference"
                defaultValue={session.data.voicePreference}
              >
                <option value="ORIGINAL">Original voice</option>
                <option value="MALE_TONE">Default male tone</option>
                <option value="FEMALE_TONE">Default female tone</option>
              </select>
              <small>
                Browser tone shifting is a modest audio effect, not voice
                cloning or impersonation.
              </small>
            </div>
            <div className="notice notice-info">
              Face profile status: {session.data.faceProfileStatus.toLowerCase()}
            </div>
            {message ? <div className="notice notice-success">{message}</div> : null}
            <button className="button button-primary" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </button>
          </form>
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
