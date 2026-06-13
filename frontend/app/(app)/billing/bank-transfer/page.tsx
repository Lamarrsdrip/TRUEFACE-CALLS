import { Suspense } from "react";
import { BankTransferCheckout } from "../../../../components/bank-transfer-checkout";
import { LoadingState } from "../../../../components/ui";

export default function BankTransferPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening bank checkout" />}>
      <BankTransferCheckout />
    </Suspense>
  );
}
