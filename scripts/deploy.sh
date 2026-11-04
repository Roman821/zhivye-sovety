#!/bin/bash
# Выкладка на сервер: тесты → копия базы → замена кода → перезапуск → проверка, при сбое откат.
# Нужен SSH-доступ под именем «sovety» (~/.ssh/config).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then echo "Есть несохранённые изменения. Сначала сделайте коммит, чтобы сайт совпадал с репозиторием." >&2; exit 1; fi

NODE=$(command -v node || echo /c/Users/muhme/AppData/Local/OpenAI/Codex/runtimes/cua_node/989c7523a11c09b9/bin/node.exe)
echo "== Тесты"
"$NODE" --test

echo "== GitHub"
git push --quiet origin HEAD

echo "== Упаковка"
TS=$(date +%Y%m%d-%H%M%S)
ARCHIVE=$(mktemp -d)/sovety-app-$TS.tar.gz
tar -czf "$ARCHIVE" server.mjs council-features.mjs people-features.mjs registration-features.mjs plan-features.mjs materials-features.mjs notify-features.mjs package.json public
scp -q "$ARCHIVE" sovety:/tmp/sovety-app.tar.gz

echo "== Установка на сервере"
ssh sovety TS="$TS" bash -s <<'EOF'
set -euo pipefail
sqlite3 /var/lib/sovety/sovety.sqlite ".backup '/var/backups/sovety/pre-deploy-$TS.sqlite'"
chmod 600 /var/backups/sovety/pre-deploy-$TS.sqlite
rm -rf /opt/sovety.prev
cp -a /opt/sovety /opt/sovety.prev
rm -rf /opt/sovety.new && mkdir /opt/sovety.new
tar -xzf /tmp/sovety-app.tar.gz -C /opt/sovety.new
chown -R root:root /opt/sovety.new && chmod -R go-w /opt/sovety.new
rm -rf /opt/sovety && mv /opt/sovety.new /opt/sovety
systemctl restart sovety
for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:18765/api/bootstrap >/dev/null 2>&1 && { echo "DEPLOY_OK $TS"; exit 0; }
  sleep 1
done
echo "Сайт не ответил — откат на прошлую версию" >&2
rm -rf /opt/sovety && mv /opt/sovety.prev /opt/sovety
systemctl restart sovety
exit 1
EOF

CODE=$(curl -fsS -o /dev/null -w "%{http_code}" https://academic-sweet-trail.ihchost.rocks/api/bootstrap)
echo "== Публичный адрес: HTTP $CODE"
