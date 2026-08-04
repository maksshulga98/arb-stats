# Раннер на отдельном VPS

Перенос генерации банковских ссылок с Mac на отдельный сервер, чтобы менеджеры
могли брать ссылки круглосуточно, а Telegram-бот на другом сервере не трогался.

## 1. Какой сервер заказать

Требования диктует Dolphin Anty (он ставится на этот же сервер):

| Параметр | Минимум | Рекомендую |
|---|---|---|
| ОС | Ubuntu 22.04+ | Ubuntu 24.04 |
| RAM | 2 ГБ | **4 ГБ** (Dolphin + Chromium + запас) |
| Диск | 40 ГБ свободных | **50–60 ГБ** |
| CPU | 2 ядра | 2 ядра |

Регион не важен: весь трафик к банку идёт через мобильный прокси, а не через IP сервера.

> Текущий VPS с ботом (1 ГБ RAM / 10 ГБ диска) под это не подходит — Dolphin туда
> физически не влезет, и при нехватке памяти система начнёт убивать процессы,
> включая бота.

## 2. Установка

На чистом сервере под root:

```bash
git clone --depth 1 https://github.com/maksshulga98/arb-stats.git /tmp/arb
bash /tmp/arb/runner/setup-vps.sh "<ссылка_на_dolphin_.deb>"
```

Ссылку на `.deb` взять на https://dolphin-anty.com/download/ (раздел Linux).

Скрипт поставит: зависимости, Node 20, Xvfb (виртуальный дисплей), Dolphin,
код раннера и два systemd-сервиса — `dolphin-anty` и `arb-runner`.

## 3. Настройка и запуск

```bash
cp /opt/arb-runner/runner/.env.example /opt/arb-runner/runner/.env
nano /opt/arb-runner/runner/.env       # Supabase, токен Dolphin, прокси
# в .env для сервера: RUNNER_ID=runner-vps, HEADLESS=1

systemctl enable --now dolphin-anty
sleep 20
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"token":"<ТОКЕН_DOLPHIN>"}' \
  http://localhost:3001/v1.0/auth/login-with-token      # ждём {"success":true}

systemctl enable --now arb-runner
tail -f /var/log/arb-runner.log
```

## 4. Что проверить в первую очередь

**Авторизация Dolphin без GUI.** На Mac приложение уже было залогинено вручную,
на чистом сервере — нет. Расчёт на то, что `auth/login-with-token` авторизует
Local API одним токеном, без ввода логина/пароля.

- Если вернёт `{"success":true}` и `/browser_profiles/{id}/start?automation=1`
  отдаст `wsEndpoint` — всё, GUI не нужен.
- Если Local API будет отвечать `invalid session token` — значит приложению нужен
  однократный вход руками. Тогда: поднять VNC (`x11vnc -display :99`), зайти
  через SSH-туннель и залогиниться в Dolphin **самому** (пароль ввожу не я).
  После разового входа сессия сохранится, дальше сервис работает сам.

## 5. Про два раннера одновременно

Захват задач атомарный (`claim_bank_link_job` с `FOR UPDATE SKIP LOCKED`), поэтому
Mac и VPS можно держать включёнными одновременно — одну заявку дважды не возьмут.
Когда сервер заработает, раннер на Mac можно просто не запускать.

Одна учётка Dolphin на двух машинах разом может конфликтовать по синхронизации
профилей — надёжнее гонять раннер только на сервере.

## 6. Полезные команды

```bash
systemctl status arb-runner dolphin-anty
journalctl -u arb-runner -f
tail -f /var/log/arb-runner.log
curl -s http://localhost:3001/v1.0/browser_profiles | head -c 200   # жив ли Local API
systemctl restart arb-runner
```
