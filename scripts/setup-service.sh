#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════════
# Game Backlog — Systemd Service Setup
# Creates, enables and starts the gamebacklog systemd service
# Run as: bash setup-service.sh
# ═══════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $1"; }
info()    { echo -e "${BLUE}[→]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
section() { echo -e "\n${BOLD}━━━ $1 ━━━${NC}"; }

# ── Preflight ──────────────────────────────────────────────────────────────
section "Preflight"

if [[ $EUID -eq 0 ]]; then
  error "Do not run as root. Run as your normal user with sudo access."
fi

sudo true || error "sudo failed."

CURRENT_USER=$(whoami)
APP_DIR="/home/$CURRENT_USER/Projects/gamebacklog"
ENV_FILE="$APP_DIR/.env"
SERVICE_FILE="/etc/systemd/system/gamebacklog.service"

# Verify app directory exists
if [[ ! -d "$APP_DIR" ]]; then
  error "App directory not found at $APP_DIR. Deploy the app first."
fi

# Verify .env exists
if [[ ! -f "$ENV_FILE" ]]; then
  error ".env file not found at $ENV_FILE. Copy .env.example and fill it in first:
  cp $APP_DIR/.env.example $APP_DIR/.env
  nano $APP_DIR/.env"
fi

cd $APP_DIR && npm ci

# Verify node_modules exists
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  error "node_modules not found. Run: cd $APP_DIR && npm install"
fi

info "Building frontend..."
cd "$APP_DIR" && npm run build
log "Frontend built"

# Find node binary
NODE_BIN=$(which node 2>/dev/null || true)
if [[ -z "$NODE_BIN" ]]; then
  error "Node.js not found. Install it first."
fi

log "User: $CURRENT_USER"
log "App dir: $APP_DIR"
log "Node: $NODE_BIN ($(node --version))"
log ".env: found"

# ── Create service file ────────────────────────────────────────────────────
section "Creating Service File"

info "Writing $SERVICE_FILE..."

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Game Backlog
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN server/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gamebacklog
EnvironmentFile=$ENV_FILE

[Install]
WantedBy=multi-user.target
EOF

log "Service file written"

# ── Enable and start ───────────────────────────────────────────────────────
section "Starting Service"

info "Reloading systemd daemon..."
sudo systemctl daemon-reload
log "Daemon reloaded"

info "Enabling service (auto-start on boot)..."
sudo systemctl enable gamebacklog
log "Service enabled"

# Stop if already running (clean restart)
if sudo systemctl is-active --quiet gamebacklog 2>/dev/null; then
  info "Stopping existing instance..."
  sudo systemctl stop gamebacklog
fi

info "Starting service..."
sudo systemctl start gamebacklog

# Give it a moment to start
sleep 2

# Check it's actually running
if sudo systemctl is-active --quiet gamebacklog; then
  log "Service is running"
else
  echo ""
  warn "Service failed to start. Last 20 log lines:"
  echo ""
  sudo journalctl -u gamebacklog -n 20 --no-pager
  echo ""
  error "Fix the error above then re-run this script."
fi

# ── Summary ────────────────────────────────────────────────────────────────
section "Done"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  Service is running!                                 ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Status:${NC}   sudo systemctl status gamebacklog"
echo -e "  ${BOLD}Logs:${NC}     sudo journalctl -u gamebacklog -f"
echo -e "  ${BOLD}Restart:${NC}  sudo systemctl restart gamebacklog"
echo -e "  ${BOLD}Stop:${NC}     sudo systemctl stop gamebacklog"
echo ""
