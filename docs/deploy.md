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

## 6. 自动部署（GitHub Actions → SSH → install.sh）

### 6.1 触发规则

- `git push` **新建以 `v` 开头的 tag**（如 `v1.0.0`）→ 自动发版
- 或在 GitHub `Actions` 页面手动触发 `Deploy` workflow（可指定 ref）
- **不**走 `push 到 main 自动部署**（防止手滑直接上线）

### 6.2 一次性服务器配置

下面所有命令在 VPS 上以 **root** 身份执行；每条都是**单行**，可整行复制粘贴。

**(1) 生成专用部署密钥**（不要复用你日常的 SSH 私钥）：
```bash
ssh-keygen -t ed25519 -f /root/.ssh/github-actions-deploy -N '' -C "wade0317@example"
```

得到两个文件：`/root/.ssh/github-actions-deploy`（私钥，进 GitHub Secrets）+ `/root/.ssh/github-actions-deploy.pub`（公钥，进 authorized_keys）。

**(2) 把公钥写进 `authorized_keys`，并用 forced-command 锁死它**：
```bash
echo "command=\"/opt/GassTopList/deploy/deploy-wrapper.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,restrict $(cat /root/.ssh/github-actions-deploy.pub)" >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
```

> `restrict` + `command="..."` 的组合限制了：这把 key 一登录就**只能跑** wrapper 脚本，无法开 shell、转发端口、跑任意命令。

**(3) 确认 wrapper 脚本可执行**（仓库已带，部署到 `/opt/GassTopList` 后路径就在）：
```bash
ls -la /opt/GassTopList/deploy/deploy-wrapper.sh
```
期望看到 `-rwxr-xr-x`。如果没有可执行权限：`chmod +x /opt/GassTopList/deploy/deploy-wrapper.sh`

**(4) 复制私钥准备贴到 GitHub Secrets**：
```bash
cat /root/.ssh/github-actions-deploy
```
完整复制输出（含 `-----BEGIN/END OPENSSH PRIVATE KEY-----` 两行）。

**(5) 在 VPS 本机自检合法 ref**（应进入 install.sh 流程）：
```bash
ssh -i /root/.ssh/github-actions-deploy -o StrictHostKeyChecking=no root@127.0.0.1 "main"
```

**(6) 在 VPS 本机自检非法 ref**（应被 wrapper 拒绝）：
```bash
ssh -i /root/.ssh/github-actions-deploy -o StrictHostKeyChecking=no root@127.0.0.1 "; rm -rf /"
```
期望输出：`[deploy-wrapper] 拒绝：非法的 ref 格式 -> ; rm -rf /`

### 6.3 GitHub 仓库配置

`Settings → Secrets and variables → Actions → New repository secret`，新增 3 个：

| 名称 | 值 |
|------|----|
| `SSH_HOST` | `gass.bilicool.com`（或服务器 IP） |
| `SSH_USER` | `root` |
| `SSH_PRIVATE_KEY` | 第 (4) 步那段完整私钥内容 |

### 6.4 发版流程

```bash
# 在本地仓库
git tag v1.0.0
git push origin v1.0.0
# → GitHub Actions 监听到 tag push，自动跑 .github/workflows/deploy.yml
# → SSH 进 VPS 触发 deploy-wrapper.sh → install.sh
# → 部署日志全程在 GitHub Actions 的 run 页面里看
```

紧急情况手动触发：进 GitHub `Actions` → `Deploy` → `Run workflow` → 填 ref（默认 `main`） → 跑。

### 6.5 故障排查

| 现象 | 排查 |
|------|------|
| Actions 中 SSH 连接失败 | 服务器 22 端口防火墙 / 安全组；`/var/log/auth.log` 看是否拒绝 |
| `Permission denied (publickey)` | `authorized_keys` 文件权限必须 600，所属目录 `~/.ssh` 必须 700；`SELinux` 严格模式下 `restorecon -R ~/.ssh` |
| `[deploy-wrapper] 拒绝：非法的 ref 格式` | ref 不在白名单里。要部署其他分支需要修改 `deploy/deploy-wrapper.sh` 的正则 |
| `install.sh` 半路报错 | Actions 日志里直接看；常见是 `git fetch` 网络抖动、`docker compose up` 镜像构建超时 |
| `curl 28 Failed to connect to github.com` | 国内 ECS 访问 github.com:443 被墙。按 § 6.6 改走 SSH over 443 |
| 想撤回某个版本 | `git tag v0.9.x-revert` 指向老的 commit 然后 push，触发回滚部署；或手动触发 workflow 指定历史 commit SHA |

### 6.6 国内 VPS 访问 GitHub（SSH over 443）

国内云厂商 ECS 经常无法稳定连 `github.com:443`。GitHub 官方提供 `ssh.github.com:443` 备用入口，**install.sh 的默认 `REPO_URL` 已切换为 SSH URL**，配套需在 VPS 上做一次性配置：

**(1) 生成只读部署密钥**：
```bash
ssh-keygen -t ed25519 -f /root/.ssh/github_repo_readonly -N '' -C "vps-readonly"
```

**(2) 看公钥**：
```bash
cat /root/.ssh/github_repo_readonly.pub
```

**(3) 在 GitHub 仓库加 Deploy Key**：`Settings → Deploy keys → Add deploy key` → 粘贴公钥 → 不勾 "Allow write access" → 保存

**(4) 配置 SSH 走 443 端口**（只对 github.com，不影响其他）：
```bash
printf 'Host github.com\n  HostName ssh.github.com\n  User git\n  Port 443\n  IdentityFile /root/.ssh/github_repo_readonly\n' >> /root/.ssh/config && chmod 600 /root/.ssh/config
```

**(5) 测试连通性**：
```bash
ssh -T git@github.com
```
期望：`Hi wade0317/GassTopList! You've successfully authenticated, but GitHub does not provide shell access.`

**(6) 切换现有仓库 remote 为 SSH URL**（首次只用做这一次）：
```bash
git -C /opt/GassTopList remote set-url origin git@github.com:wade0317/GassTopList.git && git -C /opt/GassTopList fetch origin
```

之后所有 `git fetch / git pull` 都走 22 / 443，不再依赖 github.com:443。
