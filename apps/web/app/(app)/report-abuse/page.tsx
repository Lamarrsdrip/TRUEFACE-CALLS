import { ReportAbuseForm } from "../../../components/report-abuse-form";
import { PageHeader } from "../../../components/ui";

export default function ReportAbusePage() {
  return (
    <>
      <PageHeader
        title="Report abuse"
        description="Reports go directly to the moderation queue with a permanent case record."
      />
      <ReportAbuseForm />
    </>
  );
}
