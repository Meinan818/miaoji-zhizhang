# 部署

目标环境：Ubuntu 22.04 的云服务器（1 核 1G 起可用，2 核 2G 更稳），
nginx 托管前端静态文件并反代 `/api`，Java 服务由 systemd 托管，数据库用同机 MySQL 8。

## 组成

| 文件 | 作用 |
|---|---|
| `setup.sh` | 服务器端一次准备：安装 Java 21、创建专用系统用户与目录、建库建账号、放置配置并启动服务 |
| `nginx/miaoji.conf` | nginx 站点：监听 18080，静态文件 + `/api` 反代 `127.0.0.1:8081` |
| `systemd/miaoji-backend.service` | 后端服务单元：开机自启、失败重启、`-Xmx320m` |
| `backend.env.example` | 后端环境变量名清单（不含真实值） |

## 首次部署

1. 本机构建产物：

```bash
cd frontend && npm run build:server     # 产出 dist-server/
cd ../backend && ./maven.ps1 package    # 产出 target/miaoji-backend-0.1.0.jar
```

2. 准备服务器配置 `backend.env`：从 `backend/.env.example` 复制，填入数据库账号口令、发信邮箱与授权码、模型密钥；数据库指向本机库，`MIAOJI_PORT=8081`，`MIAOJI_STORAGE_DIR=/opt/miaoji/storage`。**文件必须用 LF 换行**（见下方排障）。

3. 打包并上传：

```bash
tar -czf miaoji-deploy.tar.gz app.jar backend.env conf/ web/
scp -i <key> miaoji-deploy.tar.gz <user>@<服务器地址>:/home/<user>/
ssh -i <key> <user>@<服务器地址> "mkdir -p ~/miaoji-deploy && tar -xzf ~/miaoji-deploy.tar.gz -C ~/miaoji-deploy"
```

4. 在服务器执行 `cd ~/miaoji-deploy && ./setup.sh`。

5. 在云控制台的防火墙里放行站点端口（示例用 18080；用非 80/443 端口可以避免域名备案要求）。

## 日常运维

```bash
sudo systemctl status miaoji-backend       # 状态
sudo systemctl restart miaoji-backend      # 重启
sudo journalctl -u miaoji-backend -f       # 实时日志
sudo nginx -t && sudo systemctl reload nginx
sudo mysqldump miaoji > miaoji-$(date +%F).sql   # 备份数据库
```

更新版本：本机重新构建，只上传 `app.jar` 与 `web/`，覆盖 `/opt/miaoji/backend/app.jar`、清空并覆盖 `/opt/miaoji/web/`，然后 `sudo chown -R miaoji:miaoji /opt/miaoji && sudo systemctl restart miaoji-backend`。

## 目录与端口约定

| 项 | 位置 |
|---|---|
| 后端程序 | `/opt/miaoji/backend/app.jar` |
| 后端配置 | `/etc/miaoji/backend.env`（600，属主 miaoji） |
| 前端静态页 | `/opt/miaoji/web/` |
| 照片存储 | `/opt/miaoji/storage/` |
| nginx 站点 | `/etc/nginx/conf.d/miaoji.conf` |
| 服务名 | `miaoji-backend` |
| 端口 | 站点 18080，后端 127.0.0.1:8081 |

## 常见问题

1. **配置文件的换行符必须是 LF**。在 Windows 上生成 `backend.env` 时若用了 CRLF，systemd 会把回车读进变量值，后端报 `Access denied for user ...`。用 LF 重写并同步数据库口令即可。
2. **600 权限的配置要用 sudo 读**。脚本里用普通用户 `grep` 会 `Permission denied`，取到空口令，反而把数据库账号口令改错。
3. **运行中的服务会锁住 jar**。本机重新 `package` 前先停掉正在运行的后端，否则 repackage 失败。
4. **端口冲突**。后端端口和站点端口都在本目录的配置里，改成空闲端口即可；`application.yml` 默认只监听 127.0.0.1，对外只暴露 nginx。

## 安全建议

- 数据库账号只授权本项目使用的库，不要复用其他项目的账号。
- 站点默认是 HTTP。若要长期对公网开放，建议配域名与 HTTPS（云厂商签发证书），并给注册入口加邀请码或白名单。
- 密钥只放在服务器上的配置文件里，权限 600，不进仓库、不进日志。
