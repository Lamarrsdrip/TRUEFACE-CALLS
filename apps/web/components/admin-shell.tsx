"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BadgeDollarSign,
  Blocks,
  FileClock,
  Gauge,
  LogOut,
  Megaphone,
  ServerCog,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Brand } from "./brand";
import { apiFetch } from "../lib/api";

const adminNav = [
  ["/admin/dashboard", Gauge, "Overview"],
  ["/admin/users", Users, "Users"],
  ["/admin/billing", BadgeDollarSign, "Billing"],
  ["/admin/calls", Video, "Calls & usage"],
  ["/admin/moderation", Sparkles, "Face moderation"],
  ["/admin/reports", ShieldAlert, "Abuse reports"],
  ["/admin/providers", Activity, "Providers"],
  ["/admin/plans", Blocks, "Plans & limits"],
  ["/admin/settings", Settings, "App settings"],
  ["/admin/deployment", ServerCog, "Deployment"],
  ["/admin/broadcasts", Megaphone, "Broadcasts"],
  ["/admin/audit-logs", FileClock, "Audit logs"],
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<{ role: string } | null>(null);
  const [checking, setChecking] = useState(pathname !== "/admin/login");

  useEffect(() => {
    if (pathname === "/admin/login") {
      setChecking(false);
      return;
    }
    let active = true;
    void apiFetch<{
      adminProfile?: { role: string; active: boolean } | null;
    }>("/auth/session")
      .then((session) => {
        if (!session.adminProfile?.active) {
          router.replace("/admin/login");
          return;
        }
        if (active) setAdmin({ role: session.adminProfile.role });
      })
      .catch(() => router.replace("/admin/login"))
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (pathname === "/admin/login") return children;
  if (checking || !admin) {
    return <div className="admin-access-check">Verifying admin session…</div>;
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Brand />
          <span>{admin.role.replaceAll("_", " ")}</span>
        </div>
        <nav>
          {adminNav.map(([href, Icon, label]) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={active ? "admin-link active" : "admin-link"}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="admin-system-state">
          <span className="status-dot" />
          Console protected
        </div>
        <button
          className="admin-logout"
          type="button"
          onClick={() => void logout()}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
