# Billing and Credits

An active subscription is the entitlement root. Trial users receive a small
included balance but cannot buy top-ups. Credit-pack endpoints require an
active paid plan whose `creditTopupsAllowed` flag is enabled.

Wallets track:

- expiring `includedMilliCredits`
- durable `purchasedMilliCredits`
- included and purchased reservations
- total available and reserved balance
- lifetime purchased and consumed totals
- next included-credit reset time

Metering is authoritative in the API. The browser requests a quote but cannot
choose its own rate. The API reads admin-configured base rates, quality
multipliers, participant count, and optional voice/GPU multipliers. Each
15-second usage window has a unique key, preventing duplicate charges.

Subscription activation resets included credits to the selected plan grant.
Purchased credits remain. Usage consumes reserved included credits first,
then reserved purchased credits, then remaining included and purchased
balances.

Credit packs and cost assumptions are versioned settings editable in
`/admin/billing`.
