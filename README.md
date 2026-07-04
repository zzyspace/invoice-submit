# 开票信息提交项目

阿里云轻量应用服务器单机版：

- 静态页：Nginx 托管
- API：Node.js + Express
- 数据库：SQLite
- 附件：本机目录

## 项目结构

- `invoice-form-concept.html`：前端单页源码
- `public/`：构建后的静态资源
- `server/`：Express 服务、表单校验、SQLite 写入
- `deploy/deploy-invoice-submit.sh`：一键部署脚本
- `db/init.sql`：SQLite 初始化 SQL
- `deploy/nginx/invoice-submit.conf`：Nginx 配置模板
- `deploy/systemd/invoice-submit.service`：systemd 服务模板

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 构建静态资源

```bash
npm run build
```

3. 启动本地服务

```bash
npm run dev
```

默认监听：

- `http://127.0.0.1:8787/fuzzy`
- `http://127.0.0.1:8787/fuzzy_qz`
- `http://127.0.0.1:8787/peanut`

如需本地查看后台，再额外设置管理员账号密码：

```bash
export INVOICE_ADMIN_USERNAME=admin
export INVOICE_ADMIN_PASSWORD='change-this-password'
```

然后访问：

- `http://127.0.0.1:8787/invoice`

本地默认数据目录：

- `./.data/data/app.db`
- `./.data/uploads/`

## 首次部署

服务器当前方案：

- Web 入口：`http://<server-ip>:8080/fuzzy`
- Web 入口：`http://<server-ip>:8080/fuzzy_qz`
- Web 入口：`http://<server-ip>:8080/peanut`
- Nginx 对外监听：`8080`
- Node 服务监听：`127.0.0.1:8787`

首次部署步骤：

1. 安装基础包

```bash
apt update
apt install -y nginx sqlite3 curl git nodejs npm
```

2. 创建目录

```bash
mkdir -p /opt/invoice-submit
mkdir -p /var/lib/invoice-submit/data
mkdir -p /var/lib/invoice-submit/uploads
```

3. 拉取代码

```bash
git clone https://github.com/zzyspace/invoice-submit.git /opt/invoice-submit/current
cd /opt/invoice-submit/current
```

4. 执行部署脚本

```bash
sudo bash deploy/deploy-invoice-submit.sh local
```

脚本会自动完成：

- `git pull --ff-only origin main`
- `npm install --omit=dev`
- `npm run build`
- 安装 `systemd` 服务文件
- 安装 Nginx 配置并校验
- 重启 `invoice-submit.service`
- 校验 `healthz`

手动方式如下。

5. 安装依赖并构建

```bash
npm install --omit=dev
npm run build
```

6. 安装 `systemd` 服务

```bash
cp deploy/systemd/invoice-submit.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now invoice-submit.service
```

7. 安装 Nginx 配置

```bash
cp deploy/nginx/invoice-submit.conf /etc/nginx/sites-available/invoice-submit
ln -sf /etc/nginx/sites-available/invoice-submit /etc/nginx/sites-enabled/invoice-submit
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

8. 验证

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8080/healthz
curl -I http://127.0.0.1:8080/fuzzy
curl -I http://127.0.0.1:8080/fuzzy_qz
curl -I http://127.0.0.1:8080/peanut
```

## 生产目录

生产环境固定目录：

- 代码：`/opt/invoice-submit/current`
- 数据：`/var/lib/invoice-submit`

通过环境变量固定数据根目录：

```bash
INVOICE_SUBMIT_DATA_ROOT=/var/lib/invoice-submit
```

管理员后台账号密码建议放到单独环境文件：

```bash
cat >/etc/invoice-submit.env <<'EOF'
INVOICE_ADMIN_USERNAME=admin
INVOICE_ADMIN_PASSWORD=replace-with-a-strong-password
EOF
chmod 600 /etc/invoice-submit.env
systemctl restart invoice-submit.service
```

后台入口：

- `http://<server-ip>:8080/invoice`

## 初始化数据库

数据库会在服务启动时自动执行 [db/init.sql](/Users/ryan/DataDisk/Work/AI/invoice-submit/db/init.sql)。

部署前需要先创建数据目录：

```bash
mkdir -p /var/lib/invoice-submit/data
mkdir -p /var/lib/invoice-submit/uploads
```

## 数据库结构

当前 SQLite 只有一张业务表：

- `submissions`

字段如下：

- `submit_id INTEGER PRIMARY KEY AUTOINCREMENT`
  - 数据库内部自增主键
- `id TEXT NOT NULL UNIQUE`
  - 提交记录业务唯一 ID
- `invoice_type TEXT NOT NULL`
  - 开票主体类型，值为 `enterprise` 或 `personal`
- `invoice_title TEXT NOT NULL`
  - 发票抬头
- `tax_number TEXT`
  - 税号，选填
- `email TEXT NOT NULL`
  - 接收电子发票的邮箱
- `contact TEXT`
  - 联系方式，选填
- `note TEXT`
  - 备注信息，选填
- `store_key TEXT`
  - 门店标识，由访问路径自动带入，当前支持 `fuzzy`、`fuzzy_qz`、`peanut`
- `attachment_path TEXT NOT NULL`
  - 服务器本地附件完整路径
- `attachment_name TEXT NOT NULL`
  - 用户上传时的原始文件名
- `attachment_content_type TEXT NOT NULL`
  - 附件 MIME 类型，例如 `image/png`
- `attachment_size_bytes INTEGER NOT NULL`
  - 附件大小，单位字节
- `created_at TEXT NOT NULL`
  - 提交时间，ISO 8601 格式

索引如下：

- `idx_submissions_created_at`
- `idx_submissions_email`

## 管理员后台

后台是一个最小只读页面，默认需要 HTTP Basic Auth：

- 页面：`/invoice`
- 列表接口：`/api/admin/submissions`
- 附件查看：`/api/admin/submissions/:id/attachment`

支持能力：

- 按门店筛选
- 按抬头、邮箱、联系方式、税号、备注关键词搜索
- 分页查看最近提交记录
- 直接打开用户上传的凭证附件

## Nginx

参考配置：

- [deploy/nginx/invoice-submit.conf](/Users/ryan/DataDisk/Work/AI/invoice-submit/deploy/nginx/invoice-submit.conf)

固定要求：

- 监听 `8080`
- 静态目录：`/opt/invoice-submit/current/public`
- 仅开放 `/fuzzy`、`/fuzzy_qz`、`/peanut` 三个开票页面路径
- `/invoice` 反代到 `127.0.0.1:8787/invoice`
- `/api/` 反代到 `127.0.0.1:8787`
- `client_max_body_size 20M`

## systemd

参考服务文件：

- [deploy/systemd/invoice-submit.service](/Users/ryan/DataDisk/Work/AI/invoice-submit/deploy/systemd/invoice-submit.service)

启用命令：

```bash
cp deploy/systemd/invoice-submit.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now invoice-submit.service
```

如需后台登录，再创建可选环境文件：

```bash
cat >/etc/invoice-submit.env <<'EOF'
INVOICE_ADMIN_USERNAME=admin
INVOICE_ADMIN_PASSWORD=replace-with-a-strong-password
EOF
chmod 600 /etc/invoice-submit.env
systemctl restart invoice-submit.service
```

查看运行状态：

```bash
systemctl status --no-pager invoice-submit.service
systemctl status --no-pager nginx
```

## 安全组

对外开放：

- `8080/tcp`
- `22/tcp`

Node 服务只监听本机：

- `127.0.0.1:8787`

## 更新发布

后续每次更新代码：

```bash
bash deploy/deploy-invoice-submit.sh root@<server-ip>
```

发布后快速验证：

```bash
curl http://127.0.0.1:8080/healthz
```

如果脚本直接在服务器上执行：

```bash
sudo bash deploy/deploy-invoice-submit.sh local
```

## 运维手册

### 查看服务日志

```bash
journalctl -u invoice-submit.service -f
tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

### 查看最近提交记录

```bash
sqlite3 /var/lib/invoice-submit/data/app.db \
  "select submit_id, id, invoice_type, invoice_title, store_key, email, attachment_path, created_at from submissions order by submit_id desc limit 20;"
```

### 查看已上传附件

```bash
find /var/lib/invoice-submit/uploads -type f | tail -n 20
```

### 重启服务

```bash
systemctl restart invoice-submit.service
systemctl reload nginx
```

### 备份数据库

```bash
mkdir -p /var/backups/invoice-submit
cp /var/lib/invoice-submit/data/app.db /var/backups/invoice-submit/app-$(date +%F-%H%M%S).db
```

### 备份附件

```bash
mkdir -p /var/backups/invoice-submit
tar -czf /var/backups/invoice-submit/uploads-$(date +%F-%H%M%S).tar.gz /var/lib/invoice-submit/uploads
```

## 常见排障

### 页面打不开

先检查：

```bash
curl http://127.0.0.1:8080/healthz
systemctl status --no-pager nginx
ss -lntp | grep 8080
```

### Nginx 返回 502

说明 Nginx 没连上 Node，检查：

```bash
curl http://127.0.0.1:8787/healthz
systemctl status --no-pager invoice-submit.service
journalctl -u invoice-submit.service -n 100 --no-pager
```

### 提交失败但页面能打开

先看应用日志：

```bash
journalctl -u invoice-submit.service -n 100 --no-pager
```

再确认数据库和上传目录权限：

```bash
ls -ld /var/lib/invoice-submit
ls -ld /var/lib/invoice-submit/data
ls -ld /var/lib/invoice-submit/uploads
```

### 附件没有落盘

检查：

```bash
find /var/lib/invoice-submit/uploads -type f | tail
journalctl -u invoice-submit.service -n 100 --no-pager
```

### 数据库记录没有写入

检查：

```bash
sqlite3 /var/lib/invoice-submit/data/app.db ".tables"
sqlite3 /var/lib/invoice-submit/data/app.db "select count(*) from submissions;"
```

## 业务规则

- 发票抬头必填
- 邮箱必填
- 附件必填
- `store_key` 必填，且由访问路径自动带入
- 税号始终选填，企业开票也不能强制要求税号
- 仅支持单附件
- 附件仅支持 `PNG / JPG / PDF`
- 附件大小上限 `20MB`
