# 喵叽智账

<img src="frontend/src/assets/design/mascot/miao-avatar.png" width="96" align="right" alt="喵叽智账">

用聊天记账的手账应用：说一句「今天吃面 25，买咖啡 18」，AI 把这句话整理成账单草稿，确认后才记进账本；日历、明细、统计用来核对，手动记账作备用。

前端 Vue 3，后端 Java 21 + Spring Boot，数据存 MySQL，AI 用智谱 GLM-4-Flash 在后端调用。

## 功能

**记账**

- 聊天记账：一句话可以整理出多笔账单；信息不全时追问，说错了可以纠正金额或日期，确认后才写入。
- 手动记账：首页、聊天、明细三个入口都能直接填表，不依赖 AI。
- 明细管理：单笔编辑、逻辑删除、按日期/收支/分类/关键词筛选、筛选结果小计、导出 CSV。
- 日历与统计：按天查看当天账单与小计，按月看收支、结余、分类占比。

**账号与数据**

- 邮箱验证码注册、密码登录、退出；服务端按登录身份隔离数据，账单归属只认会话。
- 个人资料：昵称、签名、预置头像或上传私有照片（服务端保存，不公开）。
- 备份保险柜：把账本导出成一个文件，也可以从文件导入恢复，导入只新增、不覆盖已有账单。

**形态**

- 手机优先的响应式布局，320px 起可用；桌面端居中显示。
- 带 PWA 资源（在 HTTPS 或 localhost 下可安装到主屏、离线打开）。

## 技术栈

| 层次 | 方案 |
|---|---|
| 前端 | Vue 3、Vite 5、Vue Router、Pinia、Tailwind CSS、dayjs、ECharts |
| 后端 | Java 21、Spring Boot 3.5、Spring Security、Spring JDBC、Flyway |
| 数据库 | MySQL 8 |
| AI | 智谱 GLM-4-Flash-250414（只在后端调用，密钥不进前端） |
| 部署 | nginx 托管静态页并反代 API，systemd 托管 Java 服务 |

## 系统结构

```text
浏览器 ──> nginx ──/api──> Spring Boot（会话认证 + 业务校验）──> MySQL
                     |
                     └──> GLM-4-Flash（把聊天整理成待确认草稿）
```

- 模型只产出待确认草稿，不写库；金额、日期、归属都在服务端再校验一次。
- 写入按「组」做事务并带幂等键，重复提交不会重复入账。
- 账号模式读服务端账本；演示模式读浏览器本地数据，两者互不干扰。

## 快速开始

需要 Node 18+、JDK 21、Maven 3.6.3+、MySQL 8。

只看前端演示（不需要后端和数据库）：

```bash
cd frontend
npm install
npm run dev          # 打开 http://127.0.0.1:5173
```

完整账号版：

```bash
# 1. 建库
mysql -u root -p -e "create database miaoji character set utf8mb4;"

# 2. 后端配置（参考 backend/.env.example，真实文件不入库）
cd backend
cp .env.example .env.local.properties

# 3. 打包并启动后端（Flyway 自动建表）
./maven.ps1 package                  # Linux/macOS 用 mvn package
java -jar target/miaoji-backend-0.1.0.jar

# 4. 启动账号模式前端（Vite 把 /api 代理到 8080）
cd ../frontend
npm run dev:server
```

Windows 上也可以双击仓库根目录的 `start-local.cmd`，它会启动后端与账号模式前端并给出访问地址。

## 测试

```bash
cd frontend && npm test          # 金额、日期、草稿、导航、账本、资料等单元与交互测试
cd backend  && ./maven.ps1 test  # 认证、账本、幂等、资料（内存 H2，不连真实库）
```

当前统计：前端 574 项、后端 94 项通过；`npm run build`（演示）与 `npm run build:server`（账号版）均通过。

## 部署

`deploy/` 目录包含 nginx 站点、systemd 单元和服务器准备脚本，步骤与排障记录见 [deploy/README.md](deploy/README.md)。

## 目录结构

```text
frontend/           Vue 应用
  src/views/        首页、聊天、明细、新增、统计、个人页、登录
  src/components/   日历、账单表单与编辑器、聊天卡片、导航、图标
  src/stores/       会话、账本、聊天草稿状态
  src/api/          同源 /api 客户端与账号模式接口
  src/utils/        金额、账本、统计、导出、本地资料等纯函数
  tests/            单元与交互测试
backend/            Spring Boot 应用
  src/main/java/cn/miaoji/auth      注册登录、验证码、限流、会话
  src/main/java/cn/miaoji/ledger    账单读写、草稿、幂等、审计、备份
  src/main/java/cn/miaoji/profile   资料与私有照片
  src/main/resources/db/migration   Flyway 迁移
deploy/             部署配置与说明
docs/               设计规范、代码约定、开发指南
scripts/            本机启动脚本与整库备份脚本
```

## 实现说明

- 金额统一按「分」在前后端传递与计算，服务端用 DECIMAL 存储，避免浮点误差。
- 业务日期、发生时间与写入时间分开记录，没有时间信息时不编造。
- 记录标识用 UUID，组标识用于整组确认；编辑不改变标识，删除保留删除标记供读取方过滤。
- 备份文件带格式版本号，导入前整体校验；编号冲突的账单跳过而不是覆盖。
- 演示模式的数据只存在浏览器，账号模式的数据只存在服务端，不互相导入。
