import { AdminDeployment } from "../../../components/admin-deployment";
import { SystemReadiness } from "../../../components/system-readiness";

export default function AdminSystemHealthPage() {
  return (
    <>
      <AdminDeployment />
      <div className="mt-6">
        <SystemReadiness compact />
      </div>
    </>
  );
}
