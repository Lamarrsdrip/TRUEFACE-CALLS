import { BuyCreditsForm } from "../../../../components/buy-credits-form";
import { PageHeader } from "../../../../components/ui";

export default function BuyCreditsPage() {
  return (
    <>
      <PageHeader
        title="Buy call credits"
        description="Choose a pack and a configured payment provider."
      />
      <BuyCreditsForm />
    </>
  );
}
