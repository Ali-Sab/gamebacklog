# Game Backlog — Deployment Guide

## Overview

The app is a Node.js Express server that serves the frontend HTML and handles:
- Auth (username + password + TOTP MFA, refresh token via httpOnly cookie)
- Data storage (JSON files on disk in `/data`)
- MCP server at `/mcp` — Claude.ai connects here to read your library and suggest changes

No Anthropic API key is required. You connect Claude.ai to the app via its MCP connector feature (Claude Pro subscription).

---

## Option A: Raspberry Pi / Debian Server (recommended)

This is the primary deployment target: Raspberry Pi 4, Raspberry Pi OS Lite 64-bit, Node.js 20.x, systemd service, Nginx + Certbot for HTTPS.

### 1. Install Node.js 20.x

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # should be 20.x
```

### 2. Upload the project

```bash
# From your local machine:
scp -r ./gamebacklog <user>@gamebacklog.local:/home/<user>/gamebacklog

# Or clone from a private git repo:
git clone https://github.com/yourname/gamebacklog /home/alison/gamebacklog
```

### 3. Install dependencies

```bash
cd /home/<user>/gamebacklog
npm install
```

### 4. Create your .env file

```bash
cp .env.example .env
nano .env
```

Fill in:
```
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
PORT=3000
NODE_ENV=production
```

### 5. Test it works

```bash
node server.js
# Visit http://your-pi-ip:3000
```

### 6. Run as a systemd service

```bash
sudo nano /etc/systemd/system/gamebacklog.service
```

Paste:
```ini
[Unit]
Description=Game Backlog
After=network.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/gamebacklog
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=gamebacklog
EnvironmentFile=/home/<user>/gamebacklog/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gamebacklog
sudo systemctl start gamebacklog
sudo systemctl status gamebacklog
```

### 7. Nginx + Let's Encrypt (required for Claude.ai MCP connector)

Claude.ai requires HTTPS to connect to remote MCP servers. Nginx handles SSL termination.

Install Nginx and Certbot:
```bash
sudo apt install nginx certbot python3-certbot-nginx
```

Create an Nginx site config:
```bash
sudo nano /etc/nginx/sites-available/gamebacklog
```

Paste (replace `yourdomain.com` with your actual domain):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Required for MCP SSE streaming
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
```

Enable it and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/gamebacklog /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d yourdomain.com
```

Your app is now at `https://yourdomain.com`.

> **Trust proxy**: `server.js` already calls `app.set('trust proxy', 1)`. This tells Express to trust the `X-Forwarded-*` headers set by Nginx so that rate limiting and `secure` cookie flags work correctly behind the reverse proxy. No additional configuration needed.

**Domain options:**
- TP-Link DDNS + port forwarding gives you a free subdomain pointing to your home IP
- Tailscale: access via `https://gamebacklog.your-tailnet.ts.net` (Tailscale handles certs with HTTPS enabled)

---

## Option B: Railway (PaaS)

```bash
npm install -g @railway/cli
railway login
cd gamebacklog
railway init
railway up
```

In Railway dashboard → Variables:
```
JWT_SECRET=<generate with node -e above>
NODE_ENV=production
```

**Important:** Add a persistent volume at `/app/data` to prevent data loss on redeploy (Storage tab → Add Volume → mount path: `/app/data`).

---

## Connecting Claude.ai

Once HTTPS is working, connect Claude.ai to the MCP server:

### 1. Generate a long-lived JWT token

Standard login tokens expire in 1 hour. For the Claude.ai connector you need a token that lasts longer. Generate a 365-day token using your JWT_SECRET:

```bash
cd /home/<user>/gamebacklog
node -e "
const jwt = require('jsonwebtoken');
const fs  = require('fs');
const env = fs.readFileSync('.env','utf8').split('\n')
  .find(l => l.startsWith('JWT_SECRET=')).split('=').slice(1).join('=').trim();
console.log(jwt.sign({ sub: '<your-username>' }, env, { expiresIn: '365d' }));
"
```

Copy the printed token — this is your MCP connector token.

### 2. Add the MCP server in Claude.ai

1. Claude.ai → Settings → Integrations → Add MCP Server
2. Server URL: `https://yourdomain.com/mcp`
3. Authentication: `Bearer <your-365d-token>`
4. Save

### 3. Using it

Once connected, Claude has access to these tools:
- `get_game_library` — reads your full library (no notes, keeps tokens low)
- `get_taste_profile` — reads your taste profile
- `get_game_notes` — fetches notes for specific games on demand
- `suggest_game_move` — queues a category move for your approval
- `suggest_profile_update` — queues a profile edit for your approval
- `suggest_new_game` — queues a new game addition for your approval

All suggestions appear in the **Pending** tab in the frontend — nothing changes until you approve.

---

## Nightly Backups

### Set up automated backups on the Pi

```bash
cd /home/<user>/gamebacklog
npm run setup-cron
```

This adds a cron job that backs up `/data` to `~/backups/gamebacklog/` every night at 2am and deletes backups older than 7 days.

### Pull a backup to your Mac

Run this on your Mac (not the Pi). Edit `PI_HOST` if needed:

```bash
bash scripts/rsync-to-mac.sh
```

This rsyncs the Pi's `/data` directory to `~/gamebacklog-backup` on your Mac.

---

## First Run

1. Open the app URL
2. Setup screen — enter username and password
3. Scan the QR code with Google Authenticator or Authy, or enter the key manually
4. Enter the 6-digit code to confirm, then complete setup
5. Log in with username + password + MFA code

---

## Security Notes

- Passwords are hashed with PBKDF2-SHA512 (310,000 iterations, random salt per user)
- MFA tokens are standard TOTP (RFC 6238) — works with any authenticator app
- Refresh tokens are httpOnly cookies — inaccessible to JavaScript
- Access tokens (JWT) live only in memory — cleared on logout or page refresh
- Rate limiting on all auth endpoints (20 requests per 15 minutes)
- The MCP endpoint requires a valid Bearer token — the same JWT auth as all other API routes

---

## Updating

```bash
# Debian/RPi:
cd /home/<user>/gamebacklog
git pull
npm install
sudo systemctl restart gamebacklog

# Railway:
railway up
```

---

## Troubleshooting

**App won't start:**
- Check `node server.js` output for errors
- Verify `.env` exists and `JWT_SECRET` is set
- Check Node version: `node --version` (need 20+)

**Can't log in:**
- Check `data/credentials.json` exists (setup completed)
- TOTP codes expire every 30 seconds — retry if it just changed
- Clear browser cookies and retry if refresh token is stale

**MCP not connecting from Claude.ai:**
- Confirm HTTPS is working: `curl https://yourdomain.com/mcp` should return a response (401 without auth is expected)
- Check Bearer token is correct — regenerate if expired
- Nginx `proxy_buffering off` is required for SSE connections
- Check server logs: `sudo journalctl -u gamebacklog -f`

**Data lost after Railway redeploy:**
- Ensure the persistent volume is mounted at `/app/data`
