#!/bin/bash
# Run on your Mac to pull a backup from the Pi
# Edit PI_HOST to match your Tailscale hostname or local IP
PI_HOST="gamebacklog.local"
PI_USER="${PI_USER:-$(whoami)}"
LOCAL_BACKUP="$HOME/gamebacklog-backup"
mkdir -p $LOCAL_BACKUP
rsync -avz $PI_USER@$PI_HOST:/home/$PI_USER/gamebacklog/data/ $LOCAL_BACKUP/
echo "Backup pulled to $LOCAL_BACKUP"
