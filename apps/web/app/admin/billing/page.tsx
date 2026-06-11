import { AdminPayments } from "../../../components/admin-payments";
import { AdminCostCalculator } from "../../../components/admin-cost-calculator";

export default function AdminBillingPage() {
  return (
    <>
      <AdminPayments />
      <AdminCostCalculator />
    </>
  );
}
