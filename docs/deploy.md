# 部署文档

`gass.bilicool.com` 的部署：Nginx + HTTPS 用 [quick-ssl-deploy](https://github.com/wade0317/quick-ssl-deploy) 一键搭好；本文只讲应用本身——装 Docker、起后端、铺前端、接入 `/api/` 反代。

```
Nginx :443  ── /        → /var/www/gasstoplist
            └─ /api/    → 127.0.0.1:3840  (Docker: GassTopList)
                                          volume → /var/lib/gasstoplist
```

| 用途 | 路径 |
|------|------|
| 代码工作目录 | `/opt/GassTopList` |
| 前端站点根 | `/var/www/gasstoplist`（quick-ssl-deploy 创建） |
| 后端数据卷 | `/var/lib/gasstoplist` |
| Nginx 站点 conf | `/etc/nginx/conf.d/gass.bilicool.com.conf` |
| 证书目录 | `/etc/letsencrypt/certificates/gass.bilicool.com/` |

## 1. 环境准备

### 1.1 Nginx + HTTPS

按 [quick-ssl-deploy](https://github.com/wade0317/quick-ssl-deploy) 的 README 跑一次，确认 `https://gass.bilicool.com` 能开（即使页面是占位也行）。

### 1.2 安装 Docker（Ubuntu 24.04 / 阿里云 ECS）

国内访问 `get.docker.com` 经常被中断，直接用阿里云镜像走 apt：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker --version && docker compose version
```

**镜像加速**（拉镜像快很多）：

```bash
sudo mkdir -p /etc/docker
echo '{"registry-mirrors":["https://docker.m.daocloud.io","https://docker.1panel.live"],"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

> **常见坑**
> - 多行命令用 `\` 续行时，`\` 后面**不能有任何空格**——否则换行被当成普通命令分隔，`|` 会变成语法错误。粘贴失败时改用单行。
> - `mirrors.aliyun.com` 偶发不通时换清华：把 conf 里 `mirrors.aliyun.com/docker-ce` 替换为 `mirrors.tuna.tsinghua.edu.cn/docker-ce`。

## 2. 部署应用 / 发版

仓库内 [`deploy/install.sh`](../deploy/install.sh) 是幂等脚本，**首次部署与后续发版都用它**：起容器 → 铺前端 → 仅在 conf 变更时 reload nginx → 健康检查。

```bash
# 首次：克隆代码到服务器
sudo mkdir -p /opt/GassTopList && sudo chown $USER:$USER /opt/GassTopList
git clone https://github.com/wade0317/GassTopList.git /opt/GassTopList

# 部署（首次与发版都跑这一条）
bash /opt/GassTopList/deploy/install.sh

# 端到端校验
curl -fsS https://gass.bilicool.com/api/health
```

可覆盖的环境变量：`REPO_URL`、`CODE_DIR`、`WEB_ROOT`、`DATA_DIR`、`DATA_UID`、`NGINX_CONF`、`REF`、`HEALTH_URL`（详见脚本头部注释）。

## 3. 备份

```bash
# 每日备份（cron 友好）
sudo tar czf /var/backups/gasstoplist-$(date +%F).tgz -C /var/lib gasstoplist

# 恢复
docker compose -f /opt/GassTopList/deploy/docker/docker-compose.yml stop
sudo tar xzf /var/backups/gasstoplist-YYYY-MM-DD.tgz -C /var/lib
sudo chown -R 10001:10001 /var/lib/gasstoplist
docker compose -f /opt/GassTopList/deploy/docker/docker-compose.yml start
```

## 4. 故障排查

| 现象 | 排查 |
|------|------|
| `curl 127.0.0.1:3840/api/health` 失败 | `docker ps`、`docker logs GassTopList` |
| 浏览器 502 | `tail -f /var/log/nginx/gass.bilicool.com.error.log` |
| 浏览器 404 `/api/...` | `nginx -T \| grep -A5 'server_name.*gass'` 看 `/api/` 块在不在 |
| 数据写入失败 | `ls -ld /var/lib/gasstoplist`，应属 uid 10001 |
| 容器频繁重启 | `docker inspect --format='{{json .State.Health}}' GassTopList` |

## 5. 安全

- 后端**无鉴权**：工作区 ID 仅校验格式，泄露即等于密码。需要加固时在 Nginx 加 `auth_basic` 或 IP 白名单到 `location /api/`。
- 容器以非 root（uid 10001）运行；备份文件勿放到 `/var/www/` 内。
