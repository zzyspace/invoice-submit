#!/usr/bin/env bash

set -euo pipefail

DEFAULT_SERVER="${INVOICE_SUBMIT_DEPLOY_SERVER:-root@139.196.140.215}"
SERVER="${1:-${DEFAULT_SERVER}}"

APP_DIR="/opt/invoice-submit/current"
DATA_ROOT="/var/lib/invoice-submit"
SERVICE_NAME="invoice-submit.service"
SYSTEMD_UNIT_DIR="/etc/systemd/system"
NGINX_SITE_NAME="invoice-submit"
NGINX_AVAILABLE_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
HEALTHZ_NODE_URL="http://127.0.0.1:8787/healthz"
HEALTHZ_WEB_URL="http://127.0.0.1:8080/healthz"

SSH_OPTS=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=10
)

usage() {
  cat <<EOF
Usage:
  bash deploy/deploy-invoice-submit.sh [server]

Examples:
  bash deploy/deploy-invoice-submit.sh
  bash deploy/deploy-invoice-submit.sh root@your-server
  sudo bash deploy/deploy-invoice-submit.sh local

Notes:
  - Without an argument, the script deploys to ${DEFAULT_SERVER}.
  - Use "local" when running directly on the server.
EOF
}

wait_for_http_ok() {
  local label="$1"
  local url="$2"
  local attempts="${3:-30}"
  local sleep_seconds="${4:-1}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error "${url}" >/dev/null 2>&1; then
      echo "[deploy] ${label} is healthy"
      return 0
    fi

    sleep "${sleep_seconds}"
  done

  echo "[deploy] ${label} failed health check: ${url}" >&2
  return 1
}

run_release() {
  set -euo pipefail

  if [[ "${EUID}" -ne 0 ]]; then
    echo "Please run this script as root or with sudo on the server." >&2
    exit 1
  fi

  for cmd in curl git install ln nginx node npm systemctl; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
      echo "Missing required command: ${cmd}" >&2
      exit 1
    fi
  done

  if [[ ! -d "${APP_DIR}/.git" ]]; then
    echo "Application checkout does not exist: ${APP_DIR}" >&2
    exit 1
  fi

  local service_source="${APP_DIR}/deploy/systemd/invoice-submit.service"
  local service_target="${SYSTEMD_UNIT_DIR}/${SERVICE_NAME}"
  local nginx_source="${APP_DIR}/deploy/nginx/invoice-submit.conf"
  local nginx_target="${NGINX_AVAILABLE_DIR}/${NGINX_SITE_NAME}"
  local nginx_enabled_target="${NGINX_ENABLED_DIR}/${NGINX_SITE_NAME}"

  echo "[deploy] Ensuring runtime directories exist"
  install -d -m 755 "${DATA_ROOT}/data" "${DATA_ROOT}/uploads"
  install -d -m 755 "${NGINX_AVAILABLE_DIR}" "${NGINX_ENABLED_DIR}"

  echo "[deploy] Pulling latest code from origin/main"
  git -C "${APP_DIR}" pull --ff-only origin main

  echo "[deploy] Installing production dependencies"
  npm --prefix "${APP_DIR}" install --omit=dev

  echo "[deploy] Building static assets"
  npm --prefix "${APP_DIR}" run build

  if [[ ! -f "${service_source}" ]]; then
    echo "Missing service file: ${service_source}" >&2
    exit 1
  fi

  if [[ ! -f "${nginx_source}" ]]; then
    echo "Missing nginx config: ${nginx_source}" >&2
    exit 1
  fi

  echo "[deploy] Installing systemd unit"
  install -m 644 "${service_source}" "${service_target}"

  echo "[deploy] Installing nginx site config"
  install -m 644 "${nginx_source}" "${nginx_target}"
  ln -sfn "${nginx_target}" "${nginx_enabled_target}"

  echo "[deploy] Reloading systemd daemon"
  systemctl daemon-reload

  echo "[deploy] Enabling services"
  systemctl enable "${SERVICE_NAME}" >/dev/null
  systemctl enable nginx >/dev/null

  echo "[deploy] Validating nginx config"
  nginx -t

  echo "[deploy] Restarting application service"
  systemctl restart "${SERVICE_NAME}"

  echo "[deploy] Reloading nginx"
  systemctl reload nginx

  echo "[deploy] Verifying health endpoints"
  if ! wait_for_http_ok "Application health endpoint" "${HEALTHZ_NODE_URL}" 30 1; then
    systemctl --no-pager --full status "${SERVICE_NAME}" || true
    journalctl -u "${SERVICE_NAME}" -n 100 --no-pager || true
    exit 1
  fi

  if ! wait_for_http_ok "Web health endpoint" "${HEALTHZ_WEB_URL}" 30 1; then
    systemctl --no-pager --full status nginx || true
    systemctl --no-pager --full status "${SERVICE_NAME}" || true
    exit 1
  fi

  echo "[deploy] Service status"
  systemctl --no-pager --full status "${SERVICE_NAME}"
}

case "${SERVER}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if [[ "${SERVER}" == "local" || "${SERVER}" == "localhost" ]]; then
  run_release
elif [[ -d "${APP_DIR}/.git" && "${SERVER}" == "${DEFAULT_SERVER}" ]]; then
  run_release
else
  ssh "${SSH_OPTS[@]}" "${SERVER}" "$(declare -f wait_for_http_ok); $(declare -f run_release); APP_DIR='${APP_DIR}'; DATA_ROOT='${DATA_ROOT}'; SERVICE_NAME='${SERVICE_NAME}'; SYSTEMD_UNIT_DIR='${SYSTEMD_UNIT_DIR}'; NGINX_SITE_NAME='${NGINX_SITE_NAME}'; NGINX_AVAILABLE_DIR='${NGINX_AVAILABLE_DIR}'; NGINX_ENABLED_DIR='${NGINX_ENABLED_DIR}'; HEALTHZ_NODE_URL='${HEALTHZ_NODE_URL}'; HEALTHZ_WEB_URL='${HEALTHZ_WEB_URL}'; run_release"
fi
