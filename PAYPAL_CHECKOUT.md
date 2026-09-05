# Embedded PayPal checkout

## Payment references

New payments use `BM-TYPE-ACCOUNT_ID-RECORD_ID` (full Bugmega IDs). `PLAN`
identifies a subscription purchase; its paid invoice carries the same reference.
`TOPUP` identifies a wallet transfer. The code is saved locally and sent to PayPal
as `invoice_id`, `custom_id`, and at the beginning of the purchase description.
It appears in Bugmega invoices, the owner's invoice details, and wallet payment
history. Match the complete code to trace the payment, or use ACCOUNT_ID to locate
the user. No email address, name or identity document is included in the code.

`REFUND` and `WITHDRAWAL` codes appear in the owner settlement queue. These payments
remain manual: copy the displayed code into PayPal's note/reference when sending
the payment, then record PayPal's resulting transaction ID separately in Bugmega.
Existing PayPal payments and historical records are not rewritten.

## Checkout setup

Plan purchases and hiring top-ups share an on-site checkout with an order summary,
PayPal wallet buttons and PayPal-hosted card fields. The existing platform PayPal
client ID, secret and sandbox/live setting are reused. No additional package or
credentials are needed in the frontend. The ZIP sample is reference material only.

Direct card entry requires Advanced Credit and Debit Card Payments eligibility
and enablement for the merchant's PayPal app/account. The SDK checks eligibility;
otherwise buyers use the PayPal button. PayPal wallet approval and bank/3DS
authentication may open a separate window. This does not eliminate those steps.
See https://developer.paypal.com/docs/checkout/advanced/integrate .

Card details go directly to PayPal's hosted fields. Bugmega exposes only the public
client ID to authenticated buyers. Order amounts and captures are server-side.
Subscription checkout records snapshot the quoted amount; older records continue
using their existing price calculation. Subscription activation, team access and
the paid invoice now commit together in a MongoDB transaction, requiring a replica
set or Atlas (the same requirement as marketplace wallet transactions). Concurrent
confirmation retries recheck the paid invoice inside the transaction.

If capture confirmation fails, the checkout offers a retry for the same stored
order. It never creates another charge during that retry. The wallet also retains
its existing pending-payment verification controls. If SDK loading fails, an
explicit link can continue the same order on PayPal.

Before live use, validate with an eligible **sandbox** account: plan activation,
wallet credit, card decline, bank authentication, cancellation, duplicate approval,
and a lost capture response followed by retry. Also check mobile layout and the
ineligible-card PayPal fallback. Automated tests use mocks and do not charge cards.
