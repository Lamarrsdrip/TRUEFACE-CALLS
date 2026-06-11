"use client";

import { AdminTable } from "../../../components/admin-table";
import { formatDate } from "../../../lib/format";

export default function AdminAuditPage() {
  return (
    <AdminTable
      title="Audit logs"
      description="Security-sensitive actions and redacted before/after records."
      endpoint="/admin/audit-logs"
      columns={[
        { label: "Action", value: (row) => String(row.action ?? "") },
        {
          label: "Target",
          value: (row) => `${row.targetType}:${row.targetId ?? ""}`,
        },
        { label: "Request", value: (row) => String(row.requestId ?? "") },
        {
          label: "Created",
          value: (row) => formatDate(String(row.createdAt)),
        },
      ]}
    />
  );
}
