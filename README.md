# Game Backlog

A personal game library and taste profile manager with Claude AI integration. Curate your backlog across five priority categories, maintain a gaming taste profile, and connect Claude via MCP to get recommendations and suggestions — all requiring your approval before anything changes.

## Features

- **Game library** — Organize games into five categories: Play Queue, With Caveats, Decompression, Your Call, and Played
  * Note: Internally, the system also uses an `inbox` bucket for games that have been added but not yet triaged, and a `skip` value used internally for bulk re‑ordering.
- **Filtering** — Search by title, filter by mode (9 types) and risk level
- **Taste profile** — Editable profile text Claude uses as context when evaluating your library
- **Claude integration** — Connect Claude.ai via MCP; Claude can read your library and suggest moves, new games, or profile updates
- **Pending approval queue** — All Claude suggestions queue up for your review; nothing changes until you approve
- **MFA auth** — Username + password + TOTP (Google Authenticator, Authy, FreeOTP)

## Tech Stack

- **Backend**: Node.js 18+ / Express.js
- **Frontend**: Vanilla HTML/CSS/JS — no build step
- **Auth**: JWT access tokens + httpOnly refresh cookies + TOTP (RFC 6238)
- **Storage**: SQLite via `better-sqlite3`
- **AI**: Claude.ai connected via MCP (Model Context Protocol)

---

## Quick Start (local)

### Prerequisites

- Node.js 18+

### Installation

```bash
git clone <repo-url>
cd gamebacklog
npm install
```

### Configuration

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Random secret for signing login tokens — generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `MCP_TOKEN` | Secret embedded in the MCP URL — generate with: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `PORT` | Port to listen on (default: `3000`) |
| `NODE_ENV` | `development` locally, `production` on a server |

### Run it

```bash
npm run dev    # auto-restarts on file changes
# or
npm start      # plain start
```

Open `http://localhost:3000`. On first load you'll be walked through a one-time setup to create your account and pair an authenticator app.

---

## Deployment with Tailscale

Tailscale is the easiest way to:
- Access this app securely from any of your devices (phone, laptop, etc.)
- Get a stable HTTPS domain name for free
- Optionally expose it to the public internet via Funnel

### Step 1 — Install Tailscale on your server

On the machine you're hosting the app (Linux VPS, Raspberry Pi, home server, etc.):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Follow the link it prints to authenticate the machine to your Tailscale account.

### Step 2 — Enable MagicDNS and HTTPS

1. Go to [tailscale.com/admin](https://tailscale.com/admin) → **DNS**
2. Enable **MagicDNS** — this gives every device a stable hostname
3. Enable **HTTPS** — this lets Tailscale issue real TLS certificates for those hostnames

### Step 3 — Find your server's hostname

```bash
tailscale status
```

Look for your machine in the output. The hostname will look like:

```
myserver.tail1234.ts.net
```

This is your permanent domain — it doesn't change even if your IP does.

### Step 4 — Get a TLS certificate

Tailscale can issue a real HTTPS certificate for your hostname (backed by Let's Encrypt):

```bash
sudo mkdir -p /etc/nginx/ssl

sudo tailscale cert \
  --cert-file /etc/nginx/ssl/tailscale.crt \
  --key-file  /etc/nginx/ssl/tailscale.key \
  myserver.tail1234.ts.net
```

Replace `myserver.tail1234.ts.net` with your actual hostname.

### Step 5 — Install and configure Nginx

Nginx sits in front of the Node.js app and handles HTTPS termination.

```bash
sudo apt install nginx
```

Create a config file:

```bash
sudo nano /etc/nginx/sites-available/gamebacklog
```

Paste this — replace `myserver.tail1234.ts.net` with your hostname:

```nginx
server {
    listen 443 ssl;
    server_name myserver.tail1234.ts.net;

    ssl_certificate     /etc/nginx/ssl/tailscale.crt;
    ssl_certificate_key /etc/nginx/ssl/tailscale.key;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Required for MCP server-sent events — disables response buffering
    proxy_buffering    off;
    proxy_read_timeout 300s;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}

# Redirect plain HTTP to HTTPS
server {
    listen 80;
    server_name myserver.tail1234.ts.net;
    return 301 https://$host$request_uri;
}
```

Enable it and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/gamebacklog /etc/nginx/sites-enabled/
sudo nginx -t          # check for config errors
sudo systemctl restart nginx
```

You can now access the app at `https://myserver.tail1234.ts.net` from any device on your Tailscale network.

### Step 6 — Run the app as a background service

Create a systemd service so the app starts automatically on boot:

```bash
sudo nano /etc/systemd/system/gamebacklog.service
```

```ini
[Unit]
Description=Game Backlog
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/gamebacklog
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/path/to/gamebacklog/.env

[Install]
WantedBy=multi-user.target
```

Replace `/path/to/gamebacklog` with your actual path, then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable gamebacklog
sudo systemctl start gamebacklog
sudo systemctl status gamebacklog   # should show "active (running)"
```

### Step 7 — Auto-renew the TLS certificate

Tailscale certificates expire every 90 days. Add a monthly cron job to renew automatically:

```bash
sudo crontab -e
```

Add this line (replacing the hostname with yours):

```
0 3 1 * * tailscale cert --cert-file /etc/nginx/ssl/tailscale.crt --key-file /etc/nginx/ssl/tailscale.key myserver.tail1234.ts.net && nginx -s reload
```

This runs at 3am on the 1st of every month, renews the cert, and reloads Nginx to pick it up.

---

## Making it public with Tailscale Funnel

By default, your app is only accessible to devices on your Tailscale network. **Tailscale Funnel** exposes it to the public internet — including for Claude.ai, which connects from outside your network.

```bash
sudo tailscale funnel 443
```

That's it. Your app is now publicly accessible at:

```
https://myserver.tail1234.ts.net
```

To check the current Funnel status:

```bash
tailscale funnel status
```

To turn it off:

```bash
tailscale funnel off
```

> **Note:** Funnel uses your Tailscale hostname as the public domain. Traffic goes through Tailscale's infrastructure, Nginx decrypts it with the Tailscale cert, and forwards to your Node.js app.

---

## Connecting Claude

Once the server is running publicly, connect Claude.ai to your game library:

1. Go to **Claude.ai → Settings → Integrations → Add custom connector**
2. Set the **Server URL** to:
   ```
   https://myserver.tail1234.ts.net/mcp/YOUR_MCP_TOKEN
   ```
   (The `MCP_TOKEN` from your `.env` is embedded in the URL — it's the credential. It's encrypted in transit over HTTPS so it can't be sniffed.)
3. Leave the OAuth fields blank
4. Click Connect

Once connected, Claude can read your library and taste profile and suggest changes. All suggestions appear in the **Pending** tab for your approval — Claude cannot modify your data directly.

---

## Data Storage

All data lives in `data/gamebacklog.db` — a single SQLite file. The schema is created automatically on first run.

| Table | Contents |
|-------|----------|
| `credentials` | Username, hashed password, TOTP secret |
| `games` | Full game library |
| `profile` | Taste profile text |
| `pending` | Claude's pending suggestions |
| `refresh_tokens` | Active login sessions |

`data/archive/` contains the original JSON files from before the SQLite migration — kept for reference, not used by the app.

### Migrating existing JSON data

If you have existing JSON files in `data/`, import them into the database:

```bash
node scripts/migrate-json-to-sqlite.js
```

### Resetting data

To wipe everything and start fresh (re-runs the setup screen):

```bash
rm -f data/gamebacklog.db
npm start
```

To reset only your game library and profile while keeping your login, use a SQLite client or delete and re-import selectively.

---

## Project Structure

```
gamebacklog/
├── server.js          # Express server — auth, data API, MCP mount
├── mcp-server.js      # MCP tool definitions (read library, suggest changes)
├── pendingTypes.js    # Shared schema + apply logic for pending suggestions
├── db.js              # SQLite init, schema, readJSON/writeJSON wrappers
├── package.json
├── .env.example       # Environment variable template
├── DEPLOY.md          # Deployment reference
├── scripts/
│   ├── backup.sh               # Backs up data/ to a timestamped archive
│   ├── setup-cron.sh           # Installs nightly backup cron job
│   ├── rsync-to-mac.sh         # Pulls backup from Pi to Mac
│   └── migrate-json-to-sqlite.js  # One-time JSON → SQLite import
├── public/
│   └── index.html     # Full SPA (HTML + CSS + JS, no build step)
└── data/              # Created at runtime, gitignored
    ├── gamebacklog.db  # SQLite database (all app data)
    └── archive/        # Original JSON files (reference only)
```

---

## Testing

```bash
npm test          # Jest unit + integration tests (83 tests)
npm run test:e2e  # Playwright end-to-end tests (30 tests)
```

---

## Security Notes

- Passwords are hashed with PBKDF2-SHA512 (310,000 iterations, random salt)
- Refresh tokens are stored in httpOnly cookies (inaccessible to JavaScript)
- Auth endpoints are rate-limited to 20 requests per 15 minutes
- The MCP endpoint is public but gated by a secret token in the URL path, encrypted over HTTPS
- Claude can only suggest changes — all writes require your explicit approval in the Pending tab

## License

Personal use.
