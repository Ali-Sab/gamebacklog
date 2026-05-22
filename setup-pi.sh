#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════════════
# Bootstrap for Raspberry Pi 4 (Ubuntu, ARM64)
#
# Architecture:
#   Tailscale Funnel → HTTPS (TLS handled by Tailscale)
#                    → nginx HTTP on localhost:3009
#                    → services by path
#
# All services under one Tailscale MagicDNS hostname:
#   Prod:  https://<hostname>/account-manager/
#          https://<hostname>/gamebacklog/
#          https://<hostname>/chore-chart/
#          https://<hostname>/cloud-backup/
#   Dev:   https://<hostname>/<dev-prefix>/account-manager/
#          https://<hostname>/<dev-prefix>/gamebacklog/   ...etc
#
# How to use:
#   bash setup-pi.sh   (will sudo itself)
#
# Run as: bash setup-pi.sh
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

if [[ $EUID -ne 0 ]]; then
  echo "Restarting with sudo..."
  exec sudo bash "$0" "$@"
fi

# ── Static config ────────────────────────────────────────────────────────────
SERVICES=(account-manager gamebacklog chore-chart cloud-backup)

# Repos to clone — "folder_name|https://github.com/user/repo"
REPOS=(
  "account-manager|git@github.com:Ali-Sab/account-manager.git"
  "gamebacklog|git@github.com:Ali-Sab/gamebacklog.git"
  "chore-chart|git@github.com:Ali-Sab/chore-chart.git"
  "cloud-backup|git@github.com:Ali-Sab/cloud-backup.git"
)

PROJECTS_DIR="/home/apps/Projects"

declare -A EXEC=(
  [account-manager]="/opt/%e/account-manager/account-manager"
  [gamebacklog]="/usr/bin/node /opt/%e/gamebacklog/server.js"
  [chore-chart]="/opt/%e/chore-chart/chore-chart"
  [cloud-backup]="/opt/%e/cloud-backup/cloud-backup"
)

# Port nginx listens on. Tailscale Funnel forwards public HTTPS 443 → here.
NGINX_PORT=3009

# Ports assigned per service+env — populated in the port assignment section.
declare -A PORT=()

# ── Tailscale hostname ───────────────────────────────────────────────────────
section "Tailscale hostname"

info "Detecting Tailscale MagicDNS hostname..."

TS_HOSTNAME=$(tailscale status --json 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    dns = data.get('Self', {}).get('DNSName', '').rstrip('.')
    print(dns)
except:
    print('')
" 2>/dev/null || true)

if [[ -z "$TS_HOSTNAME" ]]; then
  TS_HOSTNAME=$(tailscale status 2>/dev/null | grep -o '[a-z0-9-]*\.ts\.net' | head -1 || true)
fi

if [[ -z "$TS_HOSTNAME" ]]; then
  warn "Could not auto-detect Tailscale hostname."
  warn "Find it at: login.tailscale.com/admin/machines"
  echo ""
  read -rp "Enter your Tailscale MagicDNS hostname (e.g. pi4.tail1234.ts.net): " TS_HOSTNAME
  [[ -z "$TS_HOSTNAME" ]] && error "Hostname cannot be empty."
fi

log "Tailscale hostname: ${BOLD}${TS_HOSTNAME}${NC}"

# ── Inputs ───────────────────────────────────────────────────────────────────
section "Configuration"

cat << HELP

 ┌─ DEV PATH PREFIX ──────────────────────────────────────────────────────────
 │ Dev services share the same hostname as prod but under a path prefix.
 │
 │   Prod:  https://${TS_HOSTNAME}/gamebacklog/
 │   Dev:   https://${TS_HOSTNAME}/dev/gamebacklog/
 │
 │ Press Enter to use "dev", or type a custom prefix.
 └────────────────────────────────────────────────────────────────────────────
HELP
read -rp " Dev path prefix [dev]: " DEV_PREFIX
DEV_PREFIX="${DEV_PREFIX:-dev}"

echo ""

cat << 'HELP'
 ┌─ GITHUB ACTIONS DEPLOY KEY ────────────────────────────────────────────────
 │ GitHub Actions SSHes into this Pi as the 'apps' user to deploy services.
 │ Select a public key below, or paste one manually.
 │
 │ The matching private key goes into GitHub as secret RPI_SSH_KEY.
 │ If you haven't created a deploy key yet:
 │   ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/rpi_deploy
 └────────────────────────────────────────────────────────────────────────────
HELP

# Find all .pub files under the home directories present on this machine
mapfile -t PUB_KEYS < <(find /root /home -maxdepth 3 -name "*.pub" 2>/dev/null | sort)

DEPLOY_PUBKEY=""

if [[ ${#PUB_KEYS[@]} -gt 0 ]]; then
  echo ""
  echo " Found public keys:"
  for i in "${!PUB_KEYS[@]}"; do
    fingerprint=$(ssh-keygen -lf "${PUB_KEYS[$i]}" 2>/dev/null | awk '{print $2, $4}' || echo "unreadable")
    echo "   $((i+1))) ${PUB_KEYS[$i]}  (${fingerprint})"
  done
  echo "   m) Enter key manually"
  echo ""
  read -rp " Choice [1-${#PUB_KEYS[@]}/m]: " KEY_CHOICE

  if [[ "$KEY_CHOICE" == "m" ]]; then
    read -rp " Paste public key: " DEPLOY_PUBKEY
  elif [[ "$KEY_CHOICE" =~ ^[0-9]+$ ]] && (( KEY_CHOICE >= 1 && KEY_CHOICE <= ${#PUB_KEYS[@]} )); then
    DEPLOY_PUBKEY="$(cat "${PUB_KEYS[$((KEY_CHOICE-1))]}")"
    log "Using: ${PUB_KEYS[$((KEY_CHOICE-1))]}"
  else
    error "Invalid choice."
  fi
else
  echo " No .pub files found on this machine."
  read -rp " Paste public key: " DEPLOY_PUBKEY
fi

[[ -z "$DEPLOY_PUBKEY" ]] && error "Deploy public key cannot be empty."

# ── Port assignment ──────────────────────────────────────────────────────────
# Ports are fixed — assigned sequentially per the service order above.
# Prod: 3000–3003, Dev: 3010–3013.
next_prod=3000
next_dev=3010
for svc in "${SERVICES[@]}"; do
  PORT["${svc}:prod"]=$next_prod
  PORT["${svc}:dev"]=$next_dev
  (( next_prod++ )); (( next_dev++ ))
done

# ── apps user ────────────────────────────────────────────────────────────────
section "apps user"

if id apps &>/dev/null; then
  log "User 'apps' already exists"
else
  useradd --system --create-home --shell /bin/bash apps
  log "Created user 'apps'"
fi

# ── Directory tree ────────────────────────────────────────────────────────────
section "Directory tree"

for env in prod dev; do
  for svc in "${SERVICES[@]}"; do
    mkdir -p "/opt/${env}/${svc}"
    chown apps:apps "/opt/${env}/${svc}"
    log "/opt/${env}/${svc}"
  done
done

# chore-chart serves a React build from a static/ subdir
mkdir -p /opt/prod/chore-chart/static /opt/dev/chore-chart/static
chown -R apps:apps /opt/prod/chore-chart /opt/dev/chore-chart

# Persistent data — outside /opt so deploys never touch it
for env in prod dev; do
  for svc in "${SERVICES[@]}"; do
    data_dir="/var/lib/${svc}-${env}"
    mkdir -p "$data_dir"
    chown apps:apps "$data_dir"
    chmod 750 "$data_dir"
    log "${data_dir}"
  done
done

# ── Systemd unit files ───────────────────────────────────────────────────────
section "Systemd unit files"

for env in prod dev; do
  for svc in "${SERVICES[@]}"; do
    after="network.target"
    [[ "$svc" != "account-manager" ]] && after="network.target account-manager-${env}.service"

    exec_start="${EXEC[$svc]//%e/$env}"
    unit_file="/etc/systemd/system/${svc}-${env}.service"

  cat > "$unit_file" << UNITEOF
[Unit]
Description=${svc} (${env})
After=${after}

[Service]
Type=simple
User=apps
WorkingDirectory=/opt/${env}/${svc}
EnvironmentFile=/opt/${env}/${svc}/.env
ExecStart=${exec_start}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${svc}-${env}

[Install]
WantedBy=multi-user.target
UNITEOF

    systemctl enable "${svc}-${env}" 2>/dev/null
    log "Wrote and enabled ${unit_file}"
  done
done

systemctl daemon-reload

# ── Nginx config ─────────────────────────────────────────────────────────────
section "Nginx config"

# Build location blocks only for found services.
build_proxy_location() {
  local location="$1" upstream="$2" prefix="$3" sse="${4:-no}"
  if [[ "$sse" == "yes" ]]; then
    cat << EOF
    location ${location} {
        proxy_pass http://127.0.0.1:${upstream}/mcp;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
        proxy_connect_timeout 60s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto "https";
        proxy_set_header X-Forwarded-Prefix "${prefix}";
    }
EOF
  else
    cat << EOF
    location ${location} {
        proxy_pass http://127.0.0.1:${upstream}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto "https";
        proxy_set_header X-Forwarded-Prefix "${prefix}";
        proxy_cache_bypass \$http_upgrade;
    }
EOF
  fi
}

# Accumulate location blocks into a variable
LOCATION_BLOCKS=""

for env in prod dev; do
  path_prefix=""
  [[ "$env" == "dev" ]] && path_prefix="/${DEV_PREFIX}"

  for svc in "${SERVICES[@]}"; do
    port="${PORT[${svc}:${env}]}"
    svc_path="${path_prefix}/${svc}"

    case "$svc" in
      account-manager)
        LOCATION_BLOCKS+="
    # ── ${svc} (${env}) OAuth endpoints ──
    location ${path_prefix}/.well-known/ {
        proxy_pass http://127.0.0.1:${port}/.well-known/;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \"https\";
    }
    location = ${path_prefix}/authorize {
        proxy_pass http://127.0.0.1:${port}/authorize;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
    }
    location ${path_prefix}/oauth/ {
        proxy_pass http://127.0.0.1:${port}/oauth/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
    }
    location = ${path_prefix}/token {
        proxy_pass http://127.0.0.1:${port}/token;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
    }
    location ${svc_path}/ {
        proxy_pass http://127.0.0.1:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
        proxy_set_header X-Forwarded-Prefix \"${svc_path}\";
        proxy_cache_bypass \$http_upgrade;
    }
"
        ;;
      gamebacklog)
        LOCATION_BLOCKS+="
    # ── ${svc} (${env}) ──
    location ${svc_path}/mcp {
        proxy_pass http://127.0.0.1:${port}/mcp;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
        proxy_connect_timeout 60s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
        proxy_set_header X-Forwarded-Prefix \"${svc_path}\";
    }
    location ${svc_path}/ {
        proxy_pass http://127.0.0.1:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
        proxy_set_header X-Forwarded-Prefix \"${svc_path}\";
        proxy_cache_bypass \$http_upgrade;
    }
"
        ;;
      chore-chart)
        LOCATION_BLOCKS+="
    # ── ${svc} (${env}) ──
    location ${svc_path}/api/ {
        proxy_pass http://127.0.0.1:${port}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
    }
    location ${svc_path}/ {
        alias /opt/${env}/chore-chart/static/;
        try_files \$uri \$uri/ ${svc_path}/index.html;
    }
"
        ;;
      cloud-backup)
        LOCATION_BLOCKS+="
    # ── ${svc} (${env}) ──
    location ${svc_path}/ {
        proxy_pass http://127.0.0.1:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \"https\";
        proxy_set_header X-Forwarded-Prefix \"${svc_path}\";
    }
"
        ;;
    esac
  done
done

cat > /etc/nginx/conf.d/services.conf << NGINXEOF
# Generated by setup-pi.sh on $(date)
# Tailscale Funnel terminates TLS. Nginx proxies plain HTTP only.
#
# Prod:  https://${TS_HOSTNAME}/<service>/
# Dev:   https://${TS_HOSTNAME}/${DEV_PREFIX}/<service>/

server {
    listen ${NGINX_PORT};
    server_name ${TS_HOSTNAME};
${LOCATION_BLOCKS}
    location = / {
        return 301 https://\$host/gamebacklog/;
    }
}
NGINXEOF

log "Wrote /etc/nginx/conf.d/services.conf"

[[ -L /etc/nginx/sites-enabled/default ]] && rm /etc/nginx/sites-enabled/default && log "Removed default nginx site"

info "Testing nginx config..."
if nginx -t 2>/dev/null; then
  log "Config valid"
  systemctl reload nginx
  log "Nginx reloaded"
else
  warn "Config test failed — fix manually, then: nginx -t && systemctl reload nginx"
  nginx -t || true
fi

# ── Tailscale Funnel ─────────────────────────────────────────────────────────
section "Tailscale Funnel"

info "Enabling Funnel — Tailscale terminates TLS, forwards to nginx on ${NGINX_PORT}..."

tailscale funnel --bg --https=443 ${NGINX_PORT} 2>/dev/null && log "Funnel enabled (443 → ${NGINX_PORT})" || {
  warn "Funnel setup failed. Enable Funnel in the Tailscale ACL first:"
  warn "  login.tailscale.com/admin/acls — add inside the top-level JSON object:"
  warn '  "nodeAttrs": [{"target": ["autogroup:member"], "attr": ["funnel"]}]'
  warn "Then run: tailscale funnel --bg --https=443 ${NGINX_PORT}"
}

# ── SSH deploy key ───────────────────────────────────────────────────────────
section "SSH deploy key"

APPS_SSH_DIR="/home/apps/.ssh"
AUTHORIZED_KEYS="${APPS_SSH_DIR}/authorized_keys"

mkdir -p "$APPS_SSH_DIR"
chmod 700 "$APPS_SSH_DIR"
chown apps:apps "$APPS_SSH_DIR"

if grep -qF "$DEPLOY_PUBKEY" "$AUTHORIZED_KEYS" 2>/dev/null; then
  log "Deploy key already present"
else
  echo "$DEPLOY_PUBKEY" >> "$AUTHORIZED_KEYS"
  chmod 600 "$AUTHORIZED_KEYS"
  chown apps:apps "$AUTHORIZED_KEYS"
  log "Deploy key added to ${AUTHORIZED_KEYS}"
fi

# ── Clone repos ──────────────────────────────────────────────────────────────
section "Cloning repos"

mkdir -p "$PROJECTS_DIR"
chown apps:apps "$PROJECTS_DIR"

for entry in "${REPOS[@]}"; do
  folder="${entry%%|*}"
  url="${entry##*|}"
  dest="${PROJECTS_DIR}/${folder}"

  if [[ -d "${dest}/.git" ]]; then
    info "${folder} already cloned — pulling latest..."
    sudo -u apps git -C "$dest" pull --ff-only || warn "git pull failed for ${folder} — continuing"
  else
    info "Cloning ${url} → ${dest}..."
    sudo -u apps git clone "$url" "$dest" || warn "Failed to clone ${url} — skipping"
  fi
  log "${dest}"
done

# ── Generate .env files ───────────────────────────────────────────────────────
section "Generating .env files"

# Shared OAuth credentials between account-manager and gamebacklog.
# Generated once here and passed to both services' generate-env.sh.
SHARED_CLIENT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
SHARED_CLIENT_SECRET="$(openssl rand -hex 32)"

for entry in "${REPOS[@]}"; do
  folder="${entry%%|*}"
  dest="${PROJECTS_DIR}/${folder}"
  gen_script="${dest}/scripts/generate-env.sh"

  if [[ ! -f "$gen_script" ]]; then
    warn "No scripts/generate-env.sh in ${folder} — skipping"
    continue
  fi

  extra_args=""
  if [[ "$folder" == "gamebacklog" || "$folder" == "account-manager" ]]; then
    extra_args="--client-id ${SHARED_CLIENT_ID} --client-secret ${SHARED_CLIENT_SECRET}"
  fi

  for env in prod dev; do
    out_file="/opt/${env}/${folder}/.env"
    if [[ -f "$out_file" ]]; then
      log ".env already exists at ${out_file} — skipping"
      continue
    fi
    port="${PORT[${folder}:${env}]:-}"
    if [[ -z "$port" ]]; then
      warn "No port mapping for ${folder}/${env} — skipping"
      continue
    fi
    sudo -u apps bash "$gen_script" \
      --env "$env" \
      --port "$port" \
      --account-manager-port "${PORT[account-manager:${env}]}" \
      --hostname "$TS_HOSTNAME" \
      --dev-prefix "$DEV_PREFIX" \
      --output "$out_file" \
      $extra_args
    chown apps:apps "$out_file"
    log "Generated ${out_file}"
  done
done

# ── Enforce ports ────────────────────────────────────────────────────────────
# setup-pi.sh is the authority on port assignments.
# This runs after .env generation and overwrites PORT= regardless of what
# generate-env.sh wrote or whether the file pre-existed.
section "Enforcing ports"

for env in prod dev; do
  for svc in "${SERVICES[@]}"; do
    env_file="/opt/${env}/${svc}/.env"
    port="${PORT[${svc}:${env}]}"
    if [[ ! -f "$env_file" ]]; then
      warn "No .env at ${env_file} — cannot set port"
      continue
    fi
    if grep -q "^PORT=" "$env_file"; then
      sed -i "s/^PORT=.*/PORT=${port}/" "$env_file"
    else
      echo "PORT=${port}" >> "$env_file"
    fi
    log "${svc} (${env}) → PORT=${port}"
  done
done

# ── Start services ────────────────────────────────────────────────────────────
section "Starting services"

for entry in "${REPOS[@]}"; do
  folder="${entry%%|*}"
  dest="${PROJECTS_DIR}/${folder}"
  start_script="${dest}/scripts/setup-service.sh"

  if [[ ! -f "$start_script" ]]; then
    warn "No scripts/setup-service.sh in ${folder} — skipping"
    continue
  fi

  info "Starting ${folder}..."
  bash "$start_script" && log "${folder} started" || warn "${folder} failed to start — check: journalctl -u ${folder}-prod -f"
done

# ── Summary ──────────────────────────────────────────────────────────────────
section "Done"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  Setup complete!                                             ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Services:${NC}"
for env in prod dev; do
  for svc in "${SERVICES[@]}"; do
    path_prefix=""
    [[ "$env" == "dev" ]] && path_prefix="/${DEV_PREFIX}"
    echo -e "  ${BLUE}https://${TS_HOSTNAME}${path_prefix}/${svc}/${NC}   (port ${PORT[${svc}:${env}]}, systemd: ${svc}-${env})"
  done
done
echo ""
echo -e "  ${BOLD}Service management:${NC}"
echo -e "  sudo systemctl status <service>-<env>"
echo -e "  sudo journalctl -u <service>-<env> -f"
echo ""
echo -e "  ${BOLD}GitHub Actions secrets needed:${NC}"
echo -e "  RPI_HOST     = ${TS_HOSTNAME}   (or: tailscale ip -4)"
echo -e "  RPI_USER     = apps"
echo -e "  RPI_SSH_KEY  = (private key matching the deploy key added above)"
echo ""
