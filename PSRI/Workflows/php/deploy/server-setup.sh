#!/usr/bin/env bash
# server-setup.sh — install the PSRI workflow API on the Ubuntu/Apache server
# that serves https://openmindservices.in (same box as the MySQL database).
#
# Run as root (or with sudo) from a folder containing the php/ files:
#   sudo bash server-setup.sh
#
# What it does (safe to re-run):
#   1. installs PHP + pdo_mysql/curl/mbstring for Apache, and postfix for mail()
#   2. copies the code to /opt/psri-workflow (NOT web-readable) and puts a
#      one-line api.php stub in the web root → https://<domain>/psri-workflow/api.php
#   3. writes /opt/psri-workflow/config.php from the environment (asks for the
#      DB password if PSRI_DB_PASS is not set) — never inside the web root
#   4. creates the workflow tables if missing and smoke-tests the API
#
# Optional env: DOCROOT (default /var/www/html), DOMAIN (default openmindservices.in),
#   PSRI_DB_HOST (default 127.0.0.1), PSRI_DB_USER (default inder), PSRI_DB_NAME (default psri),
#   PSRI_CORS_ORIGIN (default https://inder20216.github.io), PSRI_MAIL_FROM, TEST_EMAIL
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"          # the php/ folder
APP=/opt/psri-workflow
DOCROOT="${DOCROOT:-/var/www/html}"
DOMAIN="${DOMAIN:-openmindservices.in}"
DB_HOST="${PSRI_DB_HOST:-127.0.0.1}"
DB_USER="${PSRI_DB_USER:-inder}"
DB_NAME="${PSRI_DB_NAME:-psri}"
CORS="${PSRI_CORS_ORIGIN:-https://inder20216.github.io}"
MAIL_FROM="${PSRI_MAIL_FROM:-crm@${DOMAIN}}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo/root."; exit 1; }
[ -f "$SRC/api.php" ] && [ -f "$SRC/runner.php" ] || { echo "api.php/runner.php not found in $SRC"; exit 1; }
[ -d "$DOCROOT" ] || { echo "DOCROOT $DOCROOT does not exist — set DOCROOT=… (see: apache2ctl -S)"; exit 1; }

echo "== 1/4 packages"
export DEBIAN_FRONTEND=noninteractive
if ! dpkg -s postfix >/dev/null 2>&1; then
  debconf-set-selections <<<"postfix postfix/mailname string ${DOMAIN}"
  debconf-set-selections <<<"postfix postfix/main_mailer_type string 'Internet Site'"
fi
apt-get update -qq
apt-get install -y -qq php libapache2-mod-php php-mysql php-curl php-mbstring postfix mailutils >/dev/null
php -v | head -1

echo "== 2/4 code → $APP, stub → $DOCROOT/psri-workflow/api.php"
install -d -m 755 "$APP" "$DOCROOT/psri-workflow"
install -m 644 "$SRC/api.php" "$SRC/runner.php" "$SRC/db.php" "$APP/"
cat > "$DOCROOT/psri-workflow/api.php" <<EOF
<?php
// Public entry for the PSRI workflow API — the code (and its credentials) live in $APP.
require '$APP/api.php';
EOF
chmod 644 "$DOCROOT/psri-workflow/api.php"

echo "== 3/4 config ($APP/config.php, readable by Apache only)"
if [ ! -f "$APP/config.php" ]; then
  DB_PASS="${PSRI_DB_PASS:-}"
  [ -n "$DB_PASS" ] || { read -r -s -p "MySQL password for ${DB_USER}: " DB_PASS; echo; }
  php -r '
    [$f,$h,$u,$n,$p,$m,$c] = array_slice($argv, 1);
    $cfg = "<?php\ndeclare(strict_types=1);\n\n\$env = static fn (string \$k, string \$d): string =>\n    (getenv(\$k) !== false && getenv(\$k) !== \"\") ? (string) getenv(\$k) : \$d;\n\nreturn [\n"
         . "    \"db\" => [\n"
         . "        \"host\" => \$env(\"PSRI_DB_HOST\", " . var_export($h, true) . "),\n"
         . "        \"port\" => \$env(\"PSRI_DB_PORT\", \"3306\"),\n"
         . "        \"name\" => \$env(\"PSRI_DB_NAME\", " . var_export($n, true) . "),\n"
         . "        \"user\" => \$env(\"PSRI_DB_USER\", " . var_export($u, true) . "),\n"
         . "        \"pass\" => \$env(\"PSRI_DB_PASS\", " . var_export($p, true) . "),\n"
         . "    ],\n"
         . "    \"mail_from\"   => \$env(\"PSRI_MAIL_FROM\", " . var_export($m, true) . "),\n"
         . "    \"cors_origin\" => \$env(\"PSRI_CORS_ORIGIN\", " . var_export($c, true) . "),\n];\n";
    file_put_contents($f, $cfg);' "$APP/config.php" "$DB_HOST" "$DB_USER" "$DB_NAME" "$DB_PASS" "$MAIL_FROM" "$CORS"
fi
chown root:www-data "$APP/config.php"; chmod 640 "$APP/config.php"

echo "== 4/4 database + smoke test"
( cd "$APP" && sudo -u www-data php api.php migrate ) | tr -d '\n' ; echo
systemctl reload apache2
URL="https://${DOMAIN}/psri-workflow/api.php"
echo "GET  $URL/psri-workflow-get → $(curl -s -m 20 "$URL/psri-workflow-get" | head -c 160)"
echo "CORS header: $(curl -s -m 20 -D - -o /dev/null -H "Origin: $CORS" "$URL/psri-workflow-get" | grep -i '^access-control-allow-origin' | tr -d '\r')"
if [ -n "${TEST_EMAIL:-}" ]; then
  echo "PSRI workflow mail test from $(hostname)" | mail -s "PSRI workflow mail test" -a "From: $MAIL_FROM" "$TEST_EMAIL" \
    && echo "test email queued to $TEST_EMAIL (check inbox/spam; queue: mailq)"
fi
echo
echo "Done. Frontend: build with VITE_PSRI_WORKFLOW_BASE=$URL"
