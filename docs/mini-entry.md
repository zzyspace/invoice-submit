# 网页与微信小程序共用入口

`mini.html` 是唯一源码，构建同步到 `public/mini.html`；正式地址为 `https://comeover.cn/mini.html`。独立小程序项目 `../comeover-miniprogram` 的 web-view 只打开这个地址。入口内联样式和脚本，没有另一份小程序业务前端，也没有新增业务数据库或登录接口。

## 内容和权限

- 公共开票和入职表单必须先在入口选择门店；跳转至既有 canonical 路径，保留 `fuzzy-qz` URL 与服务端门店键的原有映射。
- 已登录时只采用 `/auth/api/session` 返回的合法 `destinations`；仅报账提交账号仍进入 `/expense/submit`。账号管理只看 `canManageAccounts === true`，角色名称不推导权限。
- 未登录（明确的 401）才展示选择后台后的登录链接，同时提供“报账中心”和“提交报账”两个明确选择。网关会保留 returnTo，因此仅提交账号应直接选择“提交报账”，避免进入要求 report:view 的列表页；登录后仅显示网关给出的实际目的地址。超时、网络故障、非 200/401 或畸形响应显示重试，不冒充未登录。公共入口继续可用。
- 对 gateway 返回的路径使用精确白名单，不接收查询参数、外部域名或未知模块为任意导航目标。新增应用时，先按原架构实现服务端授权，再扩展入口定义；不要根据前端参数授予权限。
- 页面重新可见、从浏览器历史恢复时重新检查会话。仅入口更新导航；不会刷新正在填写的业务页面。页面自身不读写 Cookie、密码或业务令牌，仅保存可选外观偏好。
- 登录、表单、历史、附件、核销等业务仍直接由原网页和接口提供；入口隐藏不是权限检查。

## 构建和测试

```sh
npm run build
cmp mini.html public/mini.html
npm test
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:mini-browser
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:mini-gateway
```

浏览器检查需要已安装 Playwright 和 Chrome；可以使用环境提供的 Playwright，无需为生产服务新增依赖。`MINI_CHROME_PATH` 可指定 Chrome 可执行文件，默认使用 Playwright 的 chrome channel。截图默认放在临时目录，也可以设置 `MINI_SCREENSHOT_DIR`。

浏览器检查启动临时本地服务，使用假会话响应，验证公共门店跳转、授权入口、仅提交账号、恶意目标、服务故障、权限失效、浅深色及 320/390/1440px 布局。这些结果不是微信真机或生产鉴权证明。

网关联调还需要同级 `admin-auth-gateway` 及其已安装依赖；可用 `MINI_GATEWAY_ROOT` 指定另一份本地 checkout。它使用实际网关和入口源码、随机测试密码及临时数据库，实际点击匿名登录入口，验证 Cookie／CSRF、仅报账提交、账号管理、授权撤销、退出和停用。业务目的页为按会话权限校验的测试页，HTTP 使用仅本地测试的 Secure=false，不代表生产 HTTPS、Nginx 或全业务流程通过。测试结束关闭服务并删除临时数据库，报告和截图留在打印的结果目录。

仅查看入口：

```sh
node scripts/test-mini-browser.mjs --serve
```

终端会打印本地地址；可用 `MINI_PREVIEW_PORT` 指定端口。预览的会话固定为 401，不连接真实账号或业务服务，业务链接需要在完整联调环境验收。

## 部署与后续同步

1. 发布本项目的 `public/mini.html`，核对源码／生成文件一致。
2. 由 `server-infra` 发布 `/mini.html` 的精确静态路由与重验证缓存规则。本地继续使用已有 Express 静态服务的 `max-age=0` 与 ETag 重验证，不新增 Node 路由；不得从本项目修改或 reload 共享 Nginx。
3. 用真实小程序 AppID 配置业务域名并验收。真实校验文件 `public/rWCVyc66DT.txt` 已发布，用户已于 2026-09-23 确认业务域名配置成功；保留原文件名及原字节。

以后修改原网页或后端后按对应项目正常发布。重新加载的小程序使用同一新版网页；已打开的旧页不会自动更新，服务端需保留兼容。这个单文件入口没有独立 JS/CSS 缓存错配问题，但不代表各原业务页面的资源版本已被统一改造。新增原生能力或修改容器时才需要另发小程序。

完整的主体、真机、业务、发布和同步清单见 `../server-infra/docs/mini-program-runbook.md`（相对本项目根目录）。未完成真实 iOS／Android、AppID、域名及审核前，不将本地检查标为“全部功能可上线”。
