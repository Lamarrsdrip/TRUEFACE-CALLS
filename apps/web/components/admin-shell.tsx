"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BadgeDollarSign,
  Blocks,
  FileClock,
  Gauge,
  Megaphone,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "./brand";

const adminNav = [
  ["/admin", Gauge, "Overview"],
  ["/admin/users", Users, "Users"],
  ["/admin/billing", BadgeDollarSign, "Billing"],
  ["/admin/calls", Video, "Calls & usage"],
  ["/admin/moderation", Sparkles, "Face moderation"],
  ["/admin/reports", ShieldAlert, "Abuse reports"],
  ["/admin/providers", Activity, "Providers"],
  ["/admin/plans", Blocks, "Plans & limits"],
  ["/admin/settings", Settings, "App settings"],
  ["/admin/broadcasts", Megaphone, "Broadcasts"],
  ["/admin/audit", FileClock, "Audit logs"],
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Brand />
          <span>Admin</span>
        </div>
        <nav>
          {adminNav.map(([href, Icon, label]) => {
            const active =
              pathname === href ||
              (href !== "/admin" && pathname.startsWith(href));
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
        <Link href="/dashboard" className="admin-back">
          Back to user app
        </Link>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
