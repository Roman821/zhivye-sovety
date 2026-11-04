#!/bin/bash
# Скачивает согласованную копию рабочей базы с сервера в папку backups/ (она не попадает в git).
set -euo pipefail
cd "$(dirname "$0")/.."
F=sovety-$(date +%F-%H%M).sqlite
mkdir -p backups
ssh sovety "sqlite3 /var/lib/sovety/sovety.sqlite \".backup '/root/$F'\" && sqlite3 /root/$F 'pragma integrity_check'"
scp -q "sovety:/root/$F" backups/
ssh sovety "rm /root/$F"
echo "Сохранено: backups/$F"
