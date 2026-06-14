# Billing And Credits

All prices and payment records use NGN minor units and display as Naira.

An active trial or paid subscription is required for metered AI features.
Only an active paid plan with top-ups enabled can purchase credit packs.
Expired paid users cannot continue AI usage from an old purchased balance.

Wallets separate:

- included plan credits
- purchased credits
- included/purchased reservations
- available and reserved totals
- lifetime purchased and consumed totals
- next included-credit reset date

The server calculates rates from mode, quality, participant count and admin
settings. Clients cannot submit their own trusted price or charge amount.
Trial reservations default to 30 seconds; paid reservations default to five
minutes. Usage settles in bounded, idempotent windows and unused reservations
are released or expire automatically.

Payment fulfillment uses a per-payment atomic wallet marker plus unique ledger
keys, preventing duplicate grants during webhook or administrator retries.

Residual limitation: browser AI can be modified to skip metering calls. Before
financially material scale, enforce usage from trusted LiveKit telemetry or a
cloud processing lease.
