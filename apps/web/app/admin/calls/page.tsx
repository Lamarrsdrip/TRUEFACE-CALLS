"use client";

import { AdminTable } from "../../../components/admin-table";
import { formatDate } from "../../../lib/format";

export default function AdminCallsPage() {
  return (
    <AdminTable
      title="Calls and usage"
      description="Room lifecycle, host ownership, participant counts, and metering records."
      endpoint="/admin/calls"
      columns={[
        { label: "Title", value: (row) => String(row.title ?? "") },
        { label: "Status", value: (row) => String(row.status ?? "") },
        {
          label: "Host",
          value: (row) =>
            String(
              (row.host as Record<string, unknown> | undefined)?.email ?? "",
            ),
        },
        {
          label: "Created",
          value: (row) => formatDate(String(row.createdAt)),
        },
      ]}
    />
  );
}
