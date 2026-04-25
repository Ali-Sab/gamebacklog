#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
(crontab -l 2>/dev/null; echo "0 2 * * * $SCRIPT_DIR/backup.sh >> $HOME/backups/backup.log 2>&1") | crontab -
echo "Cron job added — backups run nightly at 2am"
