# Payment Flow

Stripe, Paystack, and Flutterwave create pending payment records before
checkout. Only verified provider webhooks settle payments. Redirects do not
credit wallets or activate subscriptions.

Internal bank transfer:

1. Admin enables and configures bank details in `/admin/providers`.
2. User chooses Bank Transfer for a plan or configured credit pack.
3. The checkout shows bank details and requires a transfer reference and,
   when configured, a private proof image/PDF.
4. Payment remains `PENDING`.
5. Finance opens the proof through a five-minute signed URL.
6. Approval activates the subscription or adds purchased credits in one
   database transaction.
7. Rejection records a reason and does not grant value.
8. Every decision is written to the audit log.

Manual clicks never simulate success. Automated bank reconciliation can later
be added as another signed webhook provider.
