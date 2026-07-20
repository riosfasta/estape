# PinFlow

Self-hosted team and task management with visual website feedback, built with Go, MongoDB, HTML/CSS, and vanilla JavaScript.

## Local Run

1. Make sure MongoDB Community Edition is running locally.
2. Copy `.env.example` to `.env` and adjust secrets if needed.
3. Run:

```powershell
go mod tidy
go run ./cmd/server
```

Open `http://localhost:8080`.

Default owner account:

```text
owner@pinflow.local
ChangeMe123!
```

New team-admin workspaces can also be created at `/register`.

## Implemented Modules

- JWT auth with refresh tokens and bcrypt password hashing
- Role middleware for `owner_adm`, `users_admin`, and `users_member`
- Teams, members, spaces, projects, lists, tasks, task board/list/calendar views
- Website feedback with iframe/screenshot modes, percentage-coordinate pins, and pin-to-task conversion
- Subscription plans, checkout abstraction for Stripe/PayPal, pending approval, invoices
- Email queue with SMTP support and local logging fallback
- WebSocket chat with MongoDB-persisted messages
- Site settings and block-based legal page builder with sanitized rendering and versions
- One-time import/export provider interfaces for BugHerd, Asana, ClickUp, and Monday.com
- Time tracking with single running timer enforcement, manual entries, reports, and CSV export
- Workspace light/dark/system theme persistence

## Production Notes

The local development default is:

```text
MONGO_URI=mongodb://localhost:27017/
MONGO_DB_NAME=bugmarking
```

Do not use the default `JWT_SECRET` or owner password in production.

Platform owner settings can be managed at `/admin/settings`. The same values can also be provided as environment fallbacks for local setup.

Google social login needs OAuth credentials from Google Cloud:

```text
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URL=http://localhost:8080/api/auth/google/callback
```

If `GOOGLE_REDIRECT_URL` is omitted, the app uses `APP_URL + /api/auth/google/callback`.

Stripe and PayPal checkout keys can be entered in the Payments tab or through:

```text
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_MODE=sandbox
```

For Docker on Windows/Mac, remember that `localhost` inside the container is the app container, not the host. If MongoDB stays on the host, use `MONGO_URI=mongodb://host.docker.internal:27017/`. Alternatively, add a MongoDB service later when you decide to containerize the database too.

## Debian VPS Deployment

Deployment scripts live in [`deploy/vps`](deploy/vps/README.md). They cover first-time Debian setup, Go, MongoDB, nginx, systemd, GitHub pull-based updates, and MongoDB/upload backups.

After the repo is cloned on the VPS, normal updates are:

```bash
sudo bash /opt/pinflow/app/deploy/vps/deploy.sh
```

## Mobile App API Setup

The Flutter app in `mobile/pinflow_mobile` connects to this Go backend through `PINFLOW_API_URL`.

For `citywebdev.com`, the mobile environment file is:

```text
mobile/pinflow_mobile/.env
PINFLOW_API_URL=https://citywebdev.com
```

Run or build the mobile app with:

```powershell
cd mobile\pinflow_mobile
flutter run --dart-define-from-file=.env
flutter build apk --release --dart-define-from-file=.env
```

For production, make sure the Go backend `.env` also uses:

```env
APP_URL=https://citywebdev.com
```

Your nginx config must proxy websocket upgrades for `/ws/live`, because the mobile app uses:

```text
wss://citywebdev.com/ws/live
```

## shortcode list
[[site_name]]
[[platform_name]]
[[company_name]]
[[company_slogan]]
[[slogan]]
[[company_email]]
[[company_contact]]
[[support_phone]]
[[company_address]]
[[owner_name]]
[[current_date]]
[[pricing]]
[[pricing_list]]
[[all_pricing]]
[[pricing:plan-name]]
[[pricing_plan:plan-name]]
[[price_list:plan-name]]
[[social_links]]
[[company_socials]]
[[socialmedia_list]]
[[company_contact_card]]
[[contact_card]]
