#!/usr/bin/env bash
# Установка раннера банковских ссылок на чистый Ubuntu 22.04+ VPS.
#
# Ставит: зависимости, Node 20, Xvfb (виртуальный дисплей для Dolphin),
# сам Dolphin Anty, код раннера и два systemd-сервиса (Dolphin + воркер).
#
# Запуск от root:
#   bash setup-vps.sh "<ссылка_на_dolphin_deb>"
# Ссылку взять на https://dolphin-anty.com/download/ (формат .deb для Linux).

set -euo pipefail

DOLPHIN_DEB_URL="${1:-}"
RUN_USER="runner"
APP_DIR="/opt/arb-runner"
REPO="https://github.com/maksshulga98/arb-stats.git"

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

[ "$(id -u)" -eq 0 ] || { echo "Запускать от root"; exit 1; }

log "1/7 Системные пакеты"
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates git fuse xvfb x11-utils \
  libgbm1 libnss3 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 fonts-liberation
# В Ubuntu 24.04 часть библиотек переименована с суффиксом t64 —
# ставим то имя, которое доступно в текущем релизе.
for p in libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0; do
  apt-get install -y --no-install-recommends "$p" 2>/dev/null \
    || apt-get install -y --no-install-recommends "${p}t64" 2>/dev/null \
    || echo "  ! пропускаю $p (нет в репозитории)"
done

log "2/7 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

log "3/7 Пользователь $RUN_USER"
id -u "$RUN_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$RUN_USER"

log "4/7 Dolphin Anty"
if [ -n "$DOLPHIN_DEB_URL" ]; then
  tmp=$(mktemp /tmp/dolphin-XXXX.deb)
  curl -fL "$DOLPHIN_DEB_URL" -o "$tmp"
  apt-get install -y "$tmp"
  rm -f "$tmp"
else
  echo "  ! Ссылка на .deb не передана — пропускаю установку Dolphin."
  echo "    Поставить позже: apt-get install -y /путь/к/dolphin.deb"
fi

log "5/7 Код раннера в $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
cd "$APP_DIR/runner"
npm install --omit=dev
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

log "6/7 systemd: Dolphin под виртуальным дисплеем"
cat >/etc/systemd/system/dolphin-anty.service <<UNIT
[Unit]
Description=Dolphin Anty (headless, Xvfb) — Local API :3001
After=network-online.target

[Service]
User=$RUN_USER
Environment=DISPLAY=:99
# Виртуальный дисплей + само приложение. --no-sandbox обязателен без GUI-сессии.
ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /opt/dolphin-anty/dolphin-anty --no-sandbox --disable-gpu
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

log "7/7 systemd: воркер очереди"
cat >/etc/systemd/system/arb-runner.service <<UNIT
[Unit]
Description=Arb Stats — раннер банковских ссылок (очередь bank_link_jobs)
After=dolphin-anty.service
Requires=dolphin-anty.service

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR/runner
ExecStart=/usr/bin/node worker.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/arb-runner.log
StandardError=append:/var/log/arb-runner.log

[Install]
WantedBy=multi-user.target
UNIT

touch /var/log/arb-runner.log && chown "$RUN_USER" /var/log/arb-runner.log
systemctl daemon-reload

cat <<'NEXT'

────────────────────────────────────────────────────────
Установка завершена. Осталось:

1) Заполнить настройки раннера:
     cp /opt/arb-runner/runner/.env.example /opt/arb-runner/runner/.env
     nano /opt/arb-runner/runner/.env
   (Supabase URL + service_role, токен Dolphin, мобильный прокси,
    RUNNER_ID=runner-vps, HEADLESS=1)

2) Запустить Dolphin и авторизовать его Local API токеном:
     systemctl enable --now dolphin-anty
     sleep 20
     curl -s -X POST -H "Content-Type: application/json" \
       -d "{\"token\":\"<ТОКЕН>\"}" \
       http://localhost:3001/v1.0/auth/login-with-token
   Ожидаемый ответ: {"success":true}

3) Запустить воркер:
     systemctl enable --now arb-runner
     tail -f /var/log/arb-runner.log
────────────────────────────────────────────────────────
NEXT
