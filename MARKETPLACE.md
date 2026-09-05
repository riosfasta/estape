# Freelancer marketplace

The marketplace uses individual user accounts, independently of team subscriptions. Employers can keep their profile private; freelancers must publish a complete profile and consent to public display. Both need profile details, a photo and a submitted identity image to start hiring or applying. Pending identity submissions allow participation; approved verification is required to withdraw earnings.

## Pages

| Page | Purpose |
| --- | --- |
| `/dashboard` | Profile editor, reputation, job counts, Connects and private ID submission |
| `/inbox` | Existing inbox, including marketplace notifications |
| `/freelancers` | Public directory; skill, country, minimum rating and availability filters |
| `/freelancers/:id` | Public profile, completed job reviews and invitation form |
| `/find-jobs` | Public search for open jobs |
| `/marketplace/jobs` | Published/assigned jobs, bids, invitations and job creation |
| `/marketplace/jobs/:id` | Proposals, hiring, delivery, approval and reviews |
| `/wallet` | PayPal top-ups, available/reserved funds, earnings and settlement requests |
| `/admin/marketplace` | Private ID review, commission totals and payment settlement queue |
| `/marketplace/privacy` | Public-display consent, identity handling and payment terms |

Old dashboard links containing task/inbox filters redirect to `/inbox`. Notification and search links now target the inbox directly.

## Rules and accounting

- Users receive a balance of 100 Connects at the start of each UTC week (Monday 00:00), refreshed lazily on profile access or proposal submission. No rollover. Each bid costs 10. Invitations cost none. One bid/invitation per freelancer per job prevents duplicates.
- Employers need available deposits covering the budget to publish. Publication does not reserve money; hiring atomically rechecks and reserves the accepted proposal price. An accepted invitation still requires the employer's final hire action.
- One active marketplace job per freelancer. Concurrent hires serialize on the job, profile and employer wallet. Availability returns after approval.
- Approval requires submitted work and a 1–5 employer rating. It releases reserved funds, records a 5% commission rounded to the nearest cent, and creates net earnings held for exactly 168 hours. Employer ratings come only from approved jobs.
- Earnings release on wallet access/withdrawal once due. Refunds use only unused deposits; withdrawals use only matured earnings. Queued requests are deducted immediately so overlapping requests cannot overspend. Rejection restores funds exactly once.
- Amounts are integer USD cents; per-operation limits are $1–$100,000. The 5% commission is recorded separately from actual outbound transaction fees.
- Premium subscriptions/trials gate bug reporting/annotations only. Marketplace, regular tasks, projects, team and reporting access do not require a paid subscription. Existing team authorization still applies.

## Deployment and operation

Use a MongoDB replica set or Atlas. All multi-document hiring, consent and financial updates use MongoDB transactions and deliberately fail if transactions are unsupported. Normal application startup creates the required unique/query indexes; no destructive migration or account reset is needed.

Configure PayPal in the existing platform settings. Use separate databases for sandbox and live environments; never carry sandbox wallet balances into production. Top-ups use server-created orders and verified captures, checking the order, capture ID, completed status, USD currency and amount. Capture retries look up an already-completed PayPal order after a failed capture response; wallet credit is idempotent. The payment tests use a fake provider and do not charge anyone.

**Outbound settlement is manual.** The existing provider has no payout API. The owner checks the recipient and original payment, sends the actual refund/payout through the provider, then records a unique transaction reference and actual fee in `/admin/marketplace`. Send the requested amount minus that fee. A queued request is never presented as paid. Refunds must go back to the original payment method. Automatic refunds explicitly return an unsupported error rather than a false success.

Automatic chargeback handling, dispute arbitration, cancellation after hiring, split milestones, multiple concurrent contracts and automatic outbound payouts are not implemented. Active-work disputes require operator handling; do not treat the seven-day hold as a substitute for dispute operations. Resolve pending checkouts, contracts and balances before deleting accounts. Financial and consent records are retained for reconciliation; profile and identity records are deleted with account cleanup.

Identity images are limited to valid JPEG/PNG files under 5 MB and 16 megapixels. They are stored in a separate MongoDB collection, never in `/uploads`. Retrieval requires the account owner or a current platform owner administrator, uses `no-store`, and is audited. Reviews match the exact submission revision to avoid approving a replaced ID. Apply normal database encryption, backup access controls and retention operations to this collection. Public APIs use an explicit profile field allowlist and exclude deleted/suspended accounts.

The marketplace notice supplements the site's existing legal pages. Before publishing it, the operator should fill in its accurate legal identity, privacy contact, provider/international-transfer disclosures and applicable retention periods in the main policies. The notice includes public-display permission and a working withdrawal control, following the transparency topics described in the [ICO privacy-notice guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/). It is not a jurisdiction-specific legal assessment.

## Verification

```powershell
go test ./...
node --test tests/marketplace-ui.test.mjs
node --check web/static/js/app.js
node --check web/static/js/marketplace.js

# Optional integration suite: fresh database, fake PayPal, no emails.
# Uses MARKETPLACE_TEST_URI, or MONGO_URI from the repository .env.
$env:MARKETPLACE_INTEGRATION='1'
go test ./internal/handlers -run TestMarketplace -count=1 -v
```

The integration suite creates a uniquely named `bugmark_mkt_*` database and drops that exact test database on completion. It never seeds or changes the application database. It covers top-up replay, proposal privacy and duplicate Connect charging, concurrent hiring, reserved funds, completion/review authorization, the seven-day hold, net earnings, settlement replay, public filters and consent withdrawal. Rendering tests cover each marketplace screen, anonymous access, unchecked consent and private delivery visibility; visual browser QA requires an available browser connection.
