"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useApiResource } from "../hooks/use-api-resource";
import { apiFetch, jsonBody } from "../lib/api";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "./ui";

interface ReportRecord {
  id: string;
  category: string;
  description: string;
  status: string;
  reporter: { email: string };
}

export function AdminReports() {
  const reports = useApiResource<ReportRecord[]>("/admin/abuse-reports");
  const [message, setMessage] = useState<string | null>(null);

  async function resolve(event: React.FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiFetch(`/admin/abuse-reports/${id}`, {
      method: "PATCH",
      ...jsonBody({
        status: String(form.get("status")),
        resolution: String(form.get("resolution")),
      }),
    });
    setMessage("Safety case updated and assigned to you.");
    await reports.refresh();
  }

  return (
    <>
      <PageHeader
        title="Abuse reports"
        description="Investigate, action, or dismiss submitted safety cases."
      />
      {message ? <div className="notice notice-info">{message}</div> : null}
      {reports.loading ? <LoadingState /> : null}
      {reports.error ? <ErrorState message={reports.error} /> : null}
      <div className="admin-card-list">
        {reports.data?.map((report) => (
          <form
            className="admin-record admin-report"
            key={report.id}
            onSubmit={(event) => void resolve(event, report.id)}
          >
            <div className="admin-record-icon danger">
              <ShieldAlert size={19} />
            </div>
            <div className="admin-record-main">
              <strong>{report.category}</strong>
              <span>{report.description}</span>
              <small>Reported by {report.reporter.email}</small>
            </div>
            <StatusBadge
              tone={report.status === "OPEN" ? "warning" : "neutral"}
            >
              {report.status.toLowerCase()}
            </StatusBadge>
            <select name="status" defaultValue={report.status}>
              <option>OPEN</option>
              <option>INVESTIGATING</option>
              <option>ACTIONED</option>
              <option>DISMISSED</option>
            </select>
            <input name="resolution" placeholder="Resolution note" />
            <button className="button button-primary button-sm">
              Save case
            </button>
          </form>
        ))}
      </div>
    </>
  );
}
