import Link from "next/link";
import { LifeBuoy, ShieldAlert } from "lucide-react";
import { PageHeader } from "../../../components/ui";

export default function SupportPage() {
  return (
    <>
      <PageHeader
        title="Support"
        description="Resolve common device, billing, and safety issues."
      />
      <div className="settings-grid">
        <section className="panel">
          <LifeBuoy size={24} className="text-indigo-600" />
          <h2 className="mt-4 text-lg font-semibold">Product help</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Review camera permissions, face approval, credits, and waiting-room
            behavior in the help center.
          </p>
          <Link href="/help" className="button button-secondary mt-5">
            Open help center
          </Link>
        </section>
        <section className="panel">
          <ShieldAlert size={24} className="text-red-500" />
          <h2 className="mt-4 text-lg font-semibold">Safety issue</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Submit a structured abuse report with the relevant call, user, or
            face profile identifier.
          </p>
          <Link href="/report-abuse" className="button button-danger mt-5">
            Report abuse
          </Link>
        </section>
      </div>
    </>
  );
}
