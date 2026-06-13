"use client";

import { useApiResource } from "../hooks/use-api-resource";
import { ErrorState, LoadingState, PageHeader } from "./ui";

export function AdminTable({
  title,
  description,
  endpoint,
  columns,
}: {
  title: string;
  description: string;
  endpoint: string;
  columns: Array<{
    label: string;
    value: (row: Record<string, unknown>) => React.ReactNode;
  }>;
}) {
  const { data, loading, error } =
    useApiResource<Array<Record<string, unknown>>>(endpoint);
  return (
    <>
      <PageHeader title={title} description={description} />
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {data ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.label}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {columns.map((column) => (
                    <td key={column.label}>{column.value(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
