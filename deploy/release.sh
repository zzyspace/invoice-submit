# Release hooks for comeover/scripts/deploy-release.sh (sourced as root on the server).
# Shared Nginx entry (root /opt/invoice-submit/current/public) is managed by server-infra.
SERVICES=(invoice-submit.service)
UNIT_FILES=(deploy/systemd/invoice-submit.service)
HEALTH_URL=http://127.0.0.1:8787/health/invoice

release_prepare() {
  install -d -m 755 /var/lib/invoice-submit/data /var/lib/invoice-submit/uploads
  install_node_modules
  npm run build
  # The admin top bar comes from admin-auth-gateway; deploy the gateway first.
  for asset in admin-shell.css admin-shell.js admin-theme.js; do
    expect_status "https://comeover.cn/auth/accounts/$asset" 200
  done
  # mini.html renders the workbench bar; an older gateway shell would leave it empty.
  curl -fsS --max-time 15 https://comeover.cn/auth/accounts/admin-shell.js | grep -q 'id: "workbench"'
}

release_test() {
  run_isolated node --test tests/*.test.js
}

release_backup() {
  backup_sqlite /var/lib/invoice-submit/data/app.db
}

release_verify() {
  expect_status https://comeover.cn/health/invoice 200
  expect_status https://comeover.cn/ 200
  expect_status https://comeover.cn/mini.html 200
  expect_status https://comeover.cn/invoice/fuzzy 200
  expect_status https://comeover.cn/invoice 303
}
