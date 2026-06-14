"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Clock3,
  CreditCard,
  History,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Settings,
  Stethoscope,
  Shield,
  Sparkles,
  Users,
  Video,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch } from "../lib/api";
import { Brand } from "./brand";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/create-call", label: "Create call", icon: Video },
  { href: "/faces", label: "Face profiles", icon: Sparkles },
  { href: "/calls", label: "Call history", icon: History },
  { href: "/credits", label: "Credits", icon: WalletCards },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/system-check", label: "System check", icon: Stethoscope },
  { href: "/privacy-settings", label: "Privacy", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
];

const mobileNav: Array<{
  href: string;
  icon: LucideIcon;
  label: string;
}> = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { href: "/calls", icon: Video, label: "Calls" },
  { href: "/faces", icon: Users, label: "Faces" },
  { href: "/credits", icon: WalletCards, label: "Credits" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sessionAuthorized, setSessionAuthorized] = useState<boolean | null>(
    null,
  );
  const notifications = useApiResource<
    Array<{
      id: string;
      title: string;
      body: string;
      readAt: string | null;
      createdAt: string;
    }>
  >("/notifications");
  const unread = notifications.data?.filter((item) => !item.readAt).length ?? 0;

  useEffect(() => {
    let active = true;
    void apiFetch("/auth/session")
      .then(() => {
        if (active) setSessionAuthorized(true);
      })
      .catch(() => {
        if (active) setSessionAuthorized(false);
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (sessionAuthorized !== true) {
    return <div className="admin-access-check">Verifying secure session…</div>;
  }

  async function readNotification(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
    await notifications.refresh();
  }

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-brand">
          <Brand />
        </div>
        <nav className="sidebar-nav" aria-label="Account navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "sidebar-link active" : "sidebar-link"}
                onClick={() => setMenuOpen(false)}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/help" className="sidebar-link">
            <LifeBuoy size={18} />
            Help center
          </Link>
          <Link href="/report-abuse" className="sidebar-link">
            <Shield size={18} />
            Report abuse
          </Link>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-context">
            <Clock3 size={15} />
            Secure, consent-first calling
          </div>
          <div className="topbar-actions">
            <Link href="/create-call" className="button button-primary">
              <Video size={17} />
              Create call
            </Link>
            <button
              className="icon-button notification-button"
              aria-label={`${unread} unread notifications`}
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={19} />
              {unread ? (
                <span className="notification-count">{unread}</span>
              ) : null}
            </button>
            <div className="avatar avatar-sm" aria-hidden="true">
              TF
            </div>
          </div>
        </header>
        {notificationsOpen ? (
          <aside className="notification-panel">
            <div className="notification-panel-head">
              <strong>Notifications</strong>
              <button onClick={() => setNotificationsOpen(false)}>Close</button>
            </div>
            {notifications.data?.length ? (
              notifications.data.map((item) => (
                <button
                  className={
                    item.readAt
                      ? "notification-item"
                      : "notification-item unread"
                  }
                  key={item.id}
                  onClick={() => void readNotification(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </button>
              ))
            ) : (
              <p className="notification-empty">No notifications yet.</p>
            )}
          </aside>
        ) : null}
        <main className="page-container">{children}</main>
      </div>
      {menuOpen ? (
        <button
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobileNav.map(({ href, icon: Icon, label }) => (
          <Link
            href={href as string}
            key={href as string}
            className={pathname.startsWith(href as string) ? "active" : ""}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
