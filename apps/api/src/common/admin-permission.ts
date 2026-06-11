import { SetMetadata } from "@nestjs/common";

export const ADMIN_PERMISSION_KEY = "trueface:admin-permission";

export type AdminPermissionName =
  | "users:read"
  | "users:write"
  | "billing:read"
  | "billing:write"
  | "credits:write"
  | "plans:write"
  | "calls:read"
  | "calls:write"
  | "faces:read"
  | "faces:write"
  | "reports:read"
  | "reports:write"
  | "providers:read"
  | "providers:write"
  | "settings:read"
  | "settings:write"
  | "audit:read";

const ROLE_PERMISSIONS: Record<string, ReadonlySet<AdminPermissionName>> = {
  SUPER_ADMIN: new Set([
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
  ]),
  ADMIN: new Set([
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
  ]),
  OPERATIONS: new Set([
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
  ]),
  SUPPORT: new Set([
    "users:read",
    "users:write",
    "billing:read",
    "calls:read",
    "reports:read",
  ]),
  FINANCE: new Set([
    "users:read",
    "billing:read",
    "billing:write",
    "credits:write",
    "plans:write",
    "audit:read",
  ]),
  BILLING: new Set([
    "users:read",
    "billing:read",
    "billing:write",
    "credits:write",
    "plans:write",
    "audit:read",
  ]),
  MODERATOR: new Set([
    "users:read",
    "users:write",
    "calls:read",
    "calls:write",
    "faces:read",
    "faces:write",
    "reports:read",
    "reports:write",
    "audit:read",
  ]),
  VIEWER: new Set([
    "users:read",
    "billing:read",
    "calls:read",
    "faces:read",
    "reports:read",
    "providers:read",
    "settings:read",
    "audit:read",
  ]),
  ANALYST: new Set([
    "users:read",
    "billing:read",
    "calls:read",
    "faces:read",
    "reports:read",
    "providers:read",
    "settings:read",
    "audit:read",
  ]),
};

export function hasAdminPermission(
  role: string,
  explicitPermissions: string[],
  required: AdminPermissionName,
) {
  return (
    explicitPermissions.includes("*") ||
    explicitPermissions.includes(required) ||
    Boolean(ROLE_PERMISSIONS[role]?.has(required))
  );
}

export const AdminPermission = (permission: AdminPermissionName) =>
  SetMetadata(ADMIN_PERMISSION_KEY, permission);
