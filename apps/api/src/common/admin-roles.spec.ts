import { describe, expect, it } from "vitest";
import {
  hasAdminPermission,
  type AdminPermissionName,
} from "./admin-permission";

describe("admin role policy", () => {
  const allCapabilities: AdminPermissionName[] = [
    "users:read",
    "users:write",
    "billing:read",
    "billing:write",
    "credits:write",
    "plans:write",
    "calls:read",
    "calls:write",
    "faces:read",
    "faces:write",
    "reports:read",
    "reports:write",
    "providers:read",
    "providers:write",
    "settings:read",
    "settings:write",
    "audit:read",
  ];

  it("allows a super admin to perform every admin capability", () => {
    for (const capability of allCapabilities) {
      expect(hasAdminPermission("SUPER_ADMIN", [], capability)).toBe(true);
    }
  });

  it("keeps viewer access read-only", () => {
    expect(hasAdminPermission("VIEWER", [], "users:read")).toBe(true);
    expect(hasAdminPermission("VIEWER", [], "billing:read")).toBe(true);
    expect(hasAdminPermission("VIEWER", [], "users:write")).toBe(false);
    expect(hasAdminPermission("VIEWER", [], "providers:write")).toBe(false);
  });

  it("limits finance and moderator roles to their operational areas", () => {
    expect(hasAdminPermission("FINANCE", [], "billing:write")).toBe(true);
    expect(hasAdminPermission("FINANCE", [], "faces:write")).toBe(false);
    expect(hasAdminPermission("MODERATOR", [], "faces:write")).toBe(true);
    expect(hasAdminPermission("MODERATOR", [], "billing:write")).toBe(false);
  });

  it("honors explicit permission grants without broadening the role", () => {
    expect(
      hasAdminPermission("SUPPORT", ["credits:write"], "billing:write"),
    ).toBe(false);
    expect(
      hasAdminPermission("SUPPORT", ["billing:write"], "billing:write"),
    ).toBe(true);
  });
});
