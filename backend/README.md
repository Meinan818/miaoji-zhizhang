# 喵叽智账后端

Java 21 + Spring Boot 3.5 + Spring Security + Spring JDBC + Flyway + MySQL 8。
认证、账单、草稿、统计、资料与备份都在这个服务里，前端只通过同源 `/api` 访问。

## 运行

```bash
cp .env.example .env.local.properties   # 填数据库、SMTP、模型密钥
./maven.ps1 test && ./maven.ps1 package
./run.ps1                                # 或 java -jar target/miaoji-backend-0.1.0.jar
```

默认只监听 `127.0.0.1:8080`。启动时 Flyway 在空库上建表（拒绝基线化已有表、禁止 clean），因此**不要指向已有业务库**。会话保存在内存中，重启需要重新登录，账单仍在 MySQL。

`test` 使用内存 H2，不连真实数据库。

## 配置

读取工作目录下的 `.env.local.properties`，或同名环境变量（变量名见 `.env.example`）：

| 变量 | 说明 |
|---|---|
| `MIAOJI_DB_URL` / `MIAOJI_DB_USERNAME` / `MIAOJI_DB_PASSWORD` | 数据库连接（本项目专用库） |
| `MIAOJI_PORT` | 服务端口，默认 8080 |
| `MIAOJI_COOKIE_SECURE` | HTTPS 环境下设为 true |
| `MIAOJI_EMAIL_ENABLED` + `MIAOJI_SMTP_HOST` / `PORT` / `USERNAME` / `AUTHORIZATION` | 注册验证码发信 |
| `MIAOJI_AI_ENABLED` + `MIAOJI_GLM_API_KEY` | 聊天草稿的模型调用 |
| `MIAOJI_STORAGE_DIR` | 私有照片存储目录 |

## 接口约定

接口不接受浏览器指定账单归属，服务端始终按会话身份处理。金额是十进制字符串，业务日期用 `YYYY-MM-DD`，账单 ID 与请求键是 UUID。

| 方法与路径 | 行为 |
|---|---|
| GET `/api/auth/csrf` | 返回 `headerName` 与 `token`，并建立匿名会话 |
| POST `/api/auth/email/code` | 请求发信验证码，返回 `challengeId/expiresIn/resendAfter`，不回传验证码 |
| POST `/api/auth/email/register` | 提交 `email,password,challengeId,code`，成功 201 |
| POST `/api/auth/login` | 表单 `username`/`password`，成功 204 |
| GET `/api/auth/me` | 当前账号 ID 与用户名 |
| POST `/api/auth/logout` | 失效会话并删除 Cookie，204 |
| POST `/api/records` | 新建单笔，需带 UUID 格式 `Idempotency-Key`；首次 201，重放 200 |
| POST `/api/records/batch` | 1–5 笔整组确认，同幂等规则 |
| GET `/api/records?month=&page=&size=` | 分页读取当月账单，`page` 从 0 开始，`size` 1–100 |
| GET `/api/records/{id}` / PUT / DELETE | 单笔读取、修改（带 `version`）、逻辑删除 |
| GET `/api/records/snapshot` · `/snapshot/page` | 全量快照（上限 5000，超限 413）与分段读取（每段最多 500，带 `revision` 与 `nextAfter`） |
| GET `/api/statistics/month` · `/month/detail` | 月度收支结余笔数，以及按收支拆分的分类金额与占比 |
| GET `/api/categories` | 预设分类（8 支出 / 6 收入） |
| GET/PUT `/api/profile` | 读取或更新名片（`version,nickname,signature,avatar`） |
| POST `/api/profile/avatar` | multipart 上传照片，服务端校验并裁剪为 256px JPEG |
| GET `/api/profile/avatar` | 只向本人返回照片，`Cache-Control: no-store` |
| PUT/POST `/api/drafts/{id}` | 服务端草稿：建立、读取、修改、取消与确认 |
| POST `/api/ai/parse` | 把聊天文字整理成待确认草稿 |
| GET `/api/records/export` · POST `/api/records/import` | 账本导出与导入（导入只新增、按编号跳过） |

## 安全

- 无状态前端 + 会话 Cookie：CSRF 默认开启，所有写请求必须带 CSRF 响应头；登录/退出后旧 token 失效，需要重新获取。
- 会话 Cookie 为 `HttpOnly` + `SameSite=Lax`，HTTPS 环境用 `MIAOJI_COOKIE_SECURE=true` 开启 Secure。
- 前端发送 `X-Expected-Account` 断言当前页面身份，与服务端会话不一致时返回 409 `ACCOUNT_CHANGED`，避免多标签切换账号后串数据；真正的归属仍然只取会话。
- 登录/注册按来源地址限流：60 秒内最多 20 次，超过返回 429 `AUTH_RATE_LIMITED`；CSRF 先校验，限流在密码计算之前。
- 密码 12–64 位可见 ASCII，BCrypt 散列；邮箱验证码 BCrypt 散列、5 分钟有效、同邮箱 60 秒可重发、5 次错误后失效。
- 错误响应不返回密码、SQL 或请求原文；其他账号的账单统一 404。

## 幂等与事务

- 一次确认生成一个 UUID 请求键，网络超时、重复点击、重新登录后的同次重试都要复用它。相同账号 + 相同键 + 相同内容返回原回执，响应头 `Idempotency-Replayed` 标明是否重放；`1` 与 `1.00` 视为同一内容。
- 同键不同内容、不同顺序或单笔/整组接口混用返回 409 `REQUEST_KEY_REUSED`，不覆盖旧内容；不同账号的同键互不影响。
- 请求键、账单、回执、审计记录在同一个事务里提交，任何一步失败整体回滚，失败后可用同键重试。并发防重依赖数据库唯一约束，不依赖进程内锁。
- 回执是入账当时的快照，重放不会恢复之后被编辑或删除的账单；当前事实必须重新读取。

## 数据约束

- 金额大于 0、上限 999999999.99、最多两位小数；服务端用 DECIMAL 存储。
- 业务日期年份 1000–9998；`time` 为严格 `HH:mm`，未提供时保持未知，不补当前时间。
- 备注最多 200 字；未知字段一律拒绝（`fail-on-unknown-properties`）。
- 逻辑删除保留删除标记与版本，不改动历史；列表、统计、导出都会带上删除事实供读取方过滤。

## 审计

创建、修改、逻辑删除的操作与前后版本写入 `ledger_audit`，与业务同事务；幂等重放不追加事件。只记录账号、账单 ID、操作、版本、请求键和时间，不复制金额、备注或照片。

## 当前限制

自定义分类与预算、服务端聊天历史同步、多币种尚未实现；聊天历史按账号保存在浏览器本地。照片只有上传与读取，没有删除入口。限流是单进程内存实现，重启后重置。

## 参考

- [Spring Boot 3.5 环境要求](https://docs.spring.io/spring-boot/3.5/system-requirements.html)
- [Spring Security 会话管理](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html)
- [Spring Security CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
- [智谱 GLM-4-Flash-250414](https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414)
