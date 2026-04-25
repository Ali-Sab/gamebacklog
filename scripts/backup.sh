#!/bin/bash
BACKUP_DIR="$HOME/backups/gamebacklog"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
cp -r "$SCRIPT_DIR/data" $BACKUP_DIR/data-$DATE
find $BACKUP_DIR -maxdepth 1 -name "data-*" -mtime +7 -exec rm -rf {} \;
echo "Backup complete: $BACKUP_DIR/data-$DATE"
