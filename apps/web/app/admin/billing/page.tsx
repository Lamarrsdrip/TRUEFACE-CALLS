"use client";

import { AdminTable } from "../../../components/admin-table";
import { formatDate, moneyFromMinor } from "../../../lib/format";

export default function AdminBillingPage() {
  return (
    <AdminTable
      title="Payments"
      description="Provider-confirmed subscriptions, credit purchases, failures, and refunds."
      endpoint="/admin/payments"
      columns={[
        { label: "Provider", value: (row) => String(row.provider ?? "") },
        { label: "Type", value: (row) => String(row.type ?? "") },
        { label: "Status", value: (row) => String(row.status ?? "") },
        {
          label: "Amount",
          value: (row) =>
            moneyFromMinor(
              Number(row.amountMinor ?? 0),
              String(row.currency ?? "USD"),
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
