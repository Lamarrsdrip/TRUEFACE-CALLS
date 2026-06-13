import { CreateCallForm } from "../../../components/create-call-form";
import { PageHeader } from "../../../components/ui";

export default function CreateCallPage() {
  return (
    <>
      <PageHeader
        title="Create a secure call"
        description="Set the room policy first. AI face mode remains optional for each participant."
      />
      <CreateCallForm />
    </>
  );
}
