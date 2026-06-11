"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { AdminTable } from "../../../components/admin-table";
import { apiFetch } from "../../../lib/api";
import { formatDate } from "../../../lib/format";

export default function AdminAuditPage() {
  const [exporting, setExporting] = useState(false);

  async function exportAudit() {
    setExporting(true);
    try {
      const payload = await apiFetch<unknown>("/admin/audit-logs/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `trueface-admin-audit-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="admin-export-row">
        <button
          className="button button-secondary"
          disabled={exporting}
          onClick={() => void exportAudit()}
        >
          <Download size={16} />
          {exporting ? "Preparing..." : "Export for review"}
        </button>
      </div>
      <AdminTable
        title="Audit logs"
        description="Security-sensitive actions, login events, network hashes, and redacted before/after records."
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
    </>
  );
}
