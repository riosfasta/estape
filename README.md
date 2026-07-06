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

For Docker on Windows/Mac, remember that `localhost` inside the container is the app container, not the host. If MongoDB stays on the host, use `MONGO_URI=mongodb://host.docker.internal:27017/`. Alternatively, add a MongoDB service later when you decide to containerize the database too.
