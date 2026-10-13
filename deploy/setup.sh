#!/bin/bash
# 喵叽智账：服务器端一次准备（Java 21 + 专用系统用户 + 独立数据库）
set -euo pipefail

echo "== 1. 安装 Java 21 运行时 =="
if [ -x /usr/lib/jvm/java-21-openjdk-amd64/bin/java ]; then
  echo "已安装，跳过"
else
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-21-jre-headless
fi
/usr/lib/jvm/java-21-openjdk-amd64/bin/java -version 2>&1 | head -2

echo "== 2. 专用系统用户与目录 =="
id miaoji >/dev/null 2>&1 || sudo useradd --system --home /opt/miaoji --shell /usr/sbin/nologin miaoji
sudo mkdir -p /opt/miaoji/backend /opt/miaoji/web /opt/miaoji/storage /etc/miaoji
sudo chown -R miaoji:miaoji /opt/miaoji
sudo chmod 755 /opt/miaoji /opt/miaoji/backend /opt/miaoji/web
sudo chmod 750 /opt/miaoji/storage

echo "== 3. 独立数据库（不碰现有库） =="
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
PW="$(grep '^MIAOJI_DB_PASSWORD=' "$DEPLOY_DIR/backend.env" | cut -d= -f2-)"
if [ -z "$PW" ]; then echo "缺少数据库密码，终止"; exit 1; fi
sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS miaoji CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'miaoji'@'localhost' IDENTIFIED BY '$PW';
ALTER USER 'miaoji'@'localhost' IDENTIFIED BY '$PW';
GRANT ALL PRIVILEGES ON miaoji.* TO 'miaoji'@'localhost';
FLUSH PRIVILEGES;
SQL
sudo mysql -e "show databases;" | grep -E '^(miaoji|persona_terminal)$'

echo "== 4. 放置配置与产物 =="
sudo cp "$DEPLOY_DIR/conf/miaoji-backend.service" /etc/systemd/system/miaoji-backend.service
sudo cp "$DEPLOY_DIR/conf/miaoji.conf" /etc/nginx/conf.d/miaoji.conf
sudo cp "$DEPLOY_DIR/backend.env" /etc/miaoji/backend.env
sudo cp "$DEPLOY_DIR/backend.env" /opt/miaoji/backend/.env.local.properties
sudo cp "$DEPLOY_DIR/app.jar" /opt/miaoji/backend/app.jar
sudo rm -rf /opt/miaoji/web/*
sudo cp -r "$DEPLOY_DIR/web/." /opt/miaoji/web/
sudo chown -R miaoji:miaoji /opt/miaoji
sudo chmod 600 /etc/miaoji/backend.env /opt/miaoji/backend/.env.local.properties
sudo chmod 644 /opt/miaoji/backend/app.jar

echo "== 5. 起服务 =="
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now miaoji-backend
sudo systemctl reload nginx
sleep 3
systemctl is-active miaoji-backend nginx mysql
echo "== setup done =="
