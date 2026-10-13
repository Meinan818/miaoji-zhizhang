# 开发指南

## 环境

| 依赖 | 版本 |
|---|---|
| Node | 18+（开发环境用 22） |
| JDK | 21 |
| Maven | 3.6.3+ |
| MySQL | 8 |

## 两种运行模式

| 模式 | 数据来源 | 启动方式 |
|---|---|---|
| 演示 | 浏览器本地存储，不需要后端 | `npm run dev` / `npm run build` |
| 账号 | Java 后端 + MySQL | `npm run dev:server` / `npm run build:server` |

两种模式的数据互不导入：演示账本、聊天记录和照片不会自动进入账号；账号数据也不会写回浏览器。

## 本机启动

完整账号版需要先启动后端：

```bash
cd backend
cp .env.example .env.local.properties   # 填数据库、SMTP、模型密钥
./maven.ps1 test && ./maven.ps1 package
java -jar target/miaoji-backend-0.1.0.jar
```

再启动账号模式前端：

```bash
cd frontend
npm run dev:server      # http://127.0.0.1:5174，/api 代理到 8080
```

Windows 下双击仓库根目录 `start-local.cmd` 可以一次启动后端与前端，并打印访问地址；只想检查环境是否就绪用 `node scripts/local-dev.mjs --check`。

## 构建与测试

```bash
cd frontend
npm test                 # 前端单元与交互测试
npm run build            # 演示版产物（dist/）
npm run build:server     # 账号版产物（dist-server/）

cd ../backend
./maven.ps1 test         # 后端测试，内存 H2，不连真实库
./maven.ps1 package      # 打包成可执行 jar（先停掉运行中的服务）
```

项目自带的 Maven 与依赖仓库放在 `.cache/maven/`（不入库）；如果换机器，需要重新准备该目录，否则系统 Maven 可能缺少依赖。

## 配置项

后端读取工作目录下的 `.env.local.properties` 或环境变量，变量名见 `backend/.env.example`：

| 变量 | 说明 |
|---|---|
| `MIAOJI_DB_URL` / `MIAOJI_DB_USERNAME` / `MIAOJI_DB_PASSWORD` | 数据库连接，必须指向本项目专用库 |
| `MIAOJI_PORT` | 后端端口，默认 8080 |
| `MIAOJI_COOKIE_SECURE` | HTTPS 环境设为 true |
| `MIAOJI_EMAIL_ENABLED` + `MIAOJI_SMTP_*` | 邮箱验证码发信 |
| `MIAOJI_AI_ENABLED` + `MIAOJI_GLM_API_KEY` | 聊天草稿的模型调用 |
| `MIAOJI_STORAGE_DIR` | 私有照片存储目录 |

真实配置不入库。前端不持有任何密钥，所有需要密钥的调用都在后端完成。

## 目录速查

```text
frontend/src/views/        页面
frontend/src/components/   复用组件
frontend/src/stores/       Pinia 状态
frontend/src/api/          接口客户端
frontend/src/utils/        金额、账本、统计等纯函数
frontend/tests/            测试
backend/src/main/java/cn/miaoji/{auth,ledger,profile}
backend/src/main/resources/db/migration/    Flyway 迁移
```

## 排查

| 现象 | 先检查 |
|---|---|
| 页面打不开 | 服务是否在运行、端口是否被占用、实际启动地址 |
| 接口 401/403 | 会话是否过期、CSRF 是否随请求发送、账号是否已切换 |
| 接口 503 | 后端是否启动了对应能力（邮件/模型未配置时按设计返回 503） |
| 保存后数据不对 | 明细里的实际账单，而不是聊天记录里的历史回复 |
| 图表空白 | 该月是否有有效账单，逻辑删除与未确认草稿不计入统计 |
| 样式没更新 | Tailwind 扫描范围、Vite 是否重启、浏览器缓存 |
