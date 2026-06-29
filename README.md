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

- `http://127.0.0.1:8787/`

本地默认数据目录：

- `./.data/data/app.db`
- `./.data/uploads/`

## 生产目录

生产环境固定目录：

- 代码：`/opt/invoice-submit/current`
- 数据：`/var/lib/invoice-submit`

通过环境变量固定数据根目录：

```bash
INVOICE_SUBMIT_DATA_ROOT=/var/lib/invoice-submit
```

## 初始化数据库

数据库会在服务启动时自动执行 [db/init.sql](/Users/ryan/DataDisk/Work/AI/invoice-submit/db/init.sql)。

部署前需要先创建数据目录：

```bash
mkdir -p /var/lib/invoice-submit/data
mkdir -p /var/lib/invoice-submit/uploads
```

## Nginx

参考配置：

- [deploy/nginx/invoice-submit.conf](/Users/ryan/DataDisk/Work/AI/invoice-submit/deploy/nginx/invoice-submit.conf)

固定要求：

- 监听 `8080`
- 静态目录：`/opt/invoice-submit/current/public`
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

## 安全组

对外开放：

- `8080/tcp`
- `22/tcp`

Node 服务只监听本机：

- `127.0.0.1:8787`

## 业务规则

- 发票抬头必填
- 邮箱必填
- 附件必填
- 税号始终选填，企业开票也不能强制要求税号
- 仅支持单附件
- 附件仅支持 `PNG / JPG / PDF`
- 附件大小上限 `20MB`
