# Payment Flow

## Manual Bank

1. User chooses a plan or eligible credit pack.
2. The API creates a pending session with exact Naira amount, unique `TFC-*`
   reference and configured expiry.
3. Checkout shows bank details, narration guidance and countdown.
4. Receipt upload is private and can be required by admin policy.
5. Expired sessions remain reviewable but never auto-credit.
6. An authorized admin approves or rejects.
7. Approval activates the subscription or grants purchased credits once.
8. Amount, plan/pack, reference, reviewer and decision are audited.

## Paystack And Flutterwave

Checkout creates a pending payment before redirecting. Only a valid signed
terminal webhook with exact NGN currency and amount can fulfill it. Nonterminal
events are ignored, mismatches require review, and repeated events are
idempotent.

These adapters create one paid entitlement period. Automatic recurring
provider subscription mandates and renewal webhooks are not yet implemented.
