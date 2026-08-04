# bugmega

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
owner@bugmega.local
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

Firebase Cloud Messaging sends native Android/iOS push notifications. iOS delivery uses APNs through Firebase, so upload your APNs key in Firebase Console first.

```text
FCM_PROJECT_ID=your-firebase-project-id
FCM_SERVICE_ACCOUNT_FILE=/opt/bugmega/firebase-service-account.json
```

Keep the service-account JSON outside git. The mobile app also needs Firebase app IDs in `mobile/bugmega_mobile/.env` or native Firebase config files.

For Docker on Windows/Mac, remember that `localhost` inside the container is the app container, not the host. If MongoDB stays on the host, use `MONGO_URI=mongodb://host.docker.internal:27017/`. Alternatively, add a MongoDB service later when you decide to containerize the database too.

## Debian VPS Deployment

Deployment scripts live in [`deploy/vps`](deploy/vps/README.md). They cover first-time Debian setup, Go, MongoDB, nginx, systemd, GitHub pull-based updates, TLS, and MongoDB/upload backups.

The examples below use `citywebdev.com`. Replace the domain and GitHub URL with your real values.

### 1. Connect the domain to the VPS

In your domain DNS panel, point the domain to your VPS public IP address:

```text
Type: A
Name: @
Value: YOUR_VPS_IPV4
TTL: Auto / 300
```

Optional `www` record:

```text
Type: CNAME
Name: www
Value: citywebdev.com
```

If your VPS provider gives IPv6, you can also add:

```text
Type: AAAA
Name: @
Value: YOUR_VPS_IPV6
```

Wait for DNS to update, then check from your computer:

```powershell
nslookup citywebdev.com
```

The returned IP should be your VPS IP.

In your VPS provider firewall/security group, allow:

```text
22/tcp   SSH
80/tcp   HTTP for nginx and Certbot
443/tcp  HTTPS
```

Do not expose MongoDB to the public internet. The setup script keeps MongoDB on `127.0.0.1`.

### 2. Push this project to GitHub

The VPS deployment is pull-based. The server clones/pulls your repository from GitHub, builds the Go binary, and restarts the service.

Example repository URL:

```text
https://github.com/YOUR_USER/YOUR_REPO.git
```

For a private repo, create a GitHub deploy key or use an SSH key on the VPS, then use:

```text
git@github.com:YOUR_USER/YOUR_REPO.git
```

### 3. Prepare the Debian VPS

SSH into the VPS as a sudo user:

```bash
ssh root@YOUR_VPS_IP
```

Install the minimum tools needed to pull the deployment scripts from GitHub:

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl
```

Clone your GitHub repo into the live app path:

```bash
sudo mkdir -p /opt/bugmega
sudo git clone https://github.com/YOUR_USER/YOUR_REPO.git /opt/bugmega/app
```

For a private repo:

```bash
sudo git clone git@github.com:YOUR_USER/YOUR_REPO.git /opt/bugmega/app
```

### 4. Create the VPS deploy config

Copy the example config:

```bash
sudo mkdir -p /etc/bugmega
sudo cp /opt/bugmega/app/deploy/vps/env.example /etc/bugmega/deploy.env
sudo nano /etc/bugmega/deploy.env
```

Set at least these values:

```env
APP_DOMAIN='citywebdev.com'
APP_URL='https://citywebdev.com'
REPO_URL='https://github.com/YOUR_USER/YOUR_REPO.git'
REPO_BRANCH='main'

OWNER_NAME='Platform Owner'
OWNER_EMAIL='you@citywebdev.com'
OWNER_PASSWORD='use-a-long-safe-password'
JWT_SECRET=''

ENABLE_NGINX='true'
ENABLE_CERTBOT='true'
CERTBOT_EMAIL='you@citywebdev.com'
```

Leave `JWT_SECRET=''` blank if you want the script to generate a secure secret.

The default database config is local MongoDB:

```env
INSTALL_MONGODB='true'
MONGO_URI='mongodb://127.0.0.1:27017/'
MONGO_DB_NAME='bugmarking'
```

### 5. Run the first-time setup script

This script installs base packages, Go, MongoDB, nginx, optional Certbot TLS, creates the system user, builds the Go app, writes the systemd service, and starts the website.

```bash
sudo bash /opt/bugmega/app/deploy/vps/setup-debian.sh
```

The setup script currently targets Debian 12 Bookworm and MongoDB 8.0.

### 6. Verify the live website

Check the Go service:

```bash
sudo systemctl status bugmega
sudo journalctl -u bugmega -n 100 --no-pager
```

Check local HTTP from the VPS:

```bash
curl -I http://127.0.0.1:8080
```

Check nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
```

Open the live site:

```text
https://citywebdev.com
```

### 7. Update the live site from GitHub

After you push changes to GitHub, SSH into the VPS and run:

```bash
sudo bash /opt/bugmega/app/deploy/vps/deploy.sh
```

That script runs `git fetch`, `git pull --ff-only`, `go mod download`, builds `./cmd/server`, writes the environment file, reloads nginx config, and restarts the `bugmega` systemd service.

### 8. Important live paths

```text
/opt/bugmega/app                  GitHub checkout
/opt/bugmega/bin/bugmega          Built Go binary
/etc/bugmega/deploy.env           VPS deployment config and secrets
/etc/bugmega/bugmega.env          Runtime environment used by systemd
/var/lib/bugmega/uploads          Uploaded files
/etc/systemd/system/bugmega.service
/etc/nginx/sites-available/bugmega.conf
```

### 9. Backups

Create a MongoDB and uploads backup:

```bash
sudo bash /opt/bugmega/app/deploy/vps/backup-mongodb.sh
```

Restore:

```bash
sudo bash /opt/bugmega/app/deploy/vps/restore-mongodb.sh \
  /var/backups/bugmega/bugmarking-YYYYMMDD-HHMMSS.archive.gz \
  /var/backups/bugmega/uploads-YYYYMMDD-HHMMSS.tar.gz
```

### 10. Mobile app production URL

When the Go backend is live at `https://citywebdev.com`, build the Flutter app with:

```powershell
cd mobile\bugmega_mobile
flutter build apk --release --dart-define=bugmega_API_URL=https://citywebdev.com
```

## Mobile App API Setup

The Flutter app in `mobile/bugmega_mobile` connects to this Go backend through `bugmega_API_URL`.

For `citywebdev.com`, the mobile environment file is:

```text
mobile/bugmega_mobile/.env
bugmega_API_URL=https://citywebdev.com
```

Run or build the mobile app with:

```powershell
cd mobile\bugmega_mobile
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
