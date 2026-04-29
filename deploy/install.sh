#!/usr/bin/env bash
# 部署 GassTopList 到本机：拉代码 / 起后端容器 / 铺前端 / 接 Nginx 反代 / 健康检查。
# 幂等：首次安装与后续发版均可重复执行。
#
# 前置：Nginx + HTTPS 已由 quick-ssl-deploy 配好；Docker / docker compose 已安装。
#
# 用法：
#   bash deploy/install.sh                          # 默认 main 最新
#   REF=v1.0.0 bash deploy/install.sh               # 切到指定 tag/分支/SHA
#   CODE_DIR=/srv/gass bash deploy/install.sh       # 自定义路径
#
# 可覆盖的环境变量及默认值：
#   REPO_URL    https://github.com/wade0317/GassTopList.git
#   CODE_DIR    /opt/GassTopList
#   WEB_ROOT    /var/www/gasstoplist
#   DATA_DIR    /var/lib/gasstoplist
#   DATA_UID    10001
#   NGINX_CONF  /etc/nginx/conf.d/gass.bilicool.com.conf
#   REF         main
#   HEALTH_URL  http://127.0.0.1:3840/api/health

set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:wade0317/GassTopList.git}"
CODE_DIR="${CODE_DIR:-/opt/GassTopList}"
WEB_ROOT="${WEB_ROOT:-/var/www/gasstoplist}"
DATA_DIR="${DATA_DIR:-/var/lib/gasstoplist}"
DATA_UID="${DATA_UID:-10001}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/gass.bilicool.com.conf}"
REF="${REF:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3840/api/health}"

log()  { printf '→ %s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }

need() { command -v "$1" >/dev/null || { warn "缺少命令：$1"; exit 1; }; }
need git
need docker
need rsync
need curl
docker compose version >/dev/null 2>&1 || { warn "需要 docker compose v2 (插件)"; exit 1; }

# ── 1. 代码 ─────────────────────────────────────────────────
if [[ -d "$CODE_DIR/.git" ]]; then
  log "更新代码 [$REF] → $CODE_DIR"
  git -C "$CODE_DIR" fetch --all --tags --prune
  git -C "$CODE_DIR" -c advice.detachedHead=false checkout "$REF"
  # 仅当当前在分支上才 pull（tag/SHA 处于 detached HEAD，跳过）
  if git -C "$CODE_DIR" symbolic-ref -q HEAD >/dev/null; then
    git -C "$CODE_DIR" pull --ff-only
  fi
else
  log "首次 clone → $CODE_DIR"
  sudo mkdir -p "$CODE_DIR"
  sudo chown "$(id -un)":"$(id -gn)" "$CODE_DIR"
  git clone "$REPO_URL" "$CODE_DIR"
  git -C "$CODE_DIR" -c advice.detachedHead=false checkout "$REF"
fi

cd "$CODE_DIR"

# ── 2. 数据目录 ────────────────────────────────────────────
if [[ ! -d "$DATA_DIR" ]]; then
  log "创建数据目录 $DATA_DIR (uid=$DATA_UID)"
  sudo mkdir -p "$DATA_DIR"
  sudo chown "$DATA_UID":"$DATA_UID" "$DATA_DIR"
fi

# ── 3. 后端容器 ────────────────────────────────────────────
log "构建并启动后端容器（GassTopList）"
docker compose -f deploy/docker/docker-compose.yml up -d --build

# ── 4. 前端静态文件 ────────────────────────────────────────
log "部署前端 → $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete web/ "$WEB_ROOT/"

# ── 5. Nginx 配置（仅在内容变化时替换 + reload） ─────────
SRC_CONF="$CODE_DIR/deploy/nginx/gass.bilicool.com.conf"
if [[ ! -f "$SRC_CONF" ]]; then
  warn "找不到 $SRC_CONF"; exit 1
fi
if cmp -s "$SRC_CONF" "$NGINX_CONF" 2>/dev/null; then
  log "Nginx 配置无变化，跳过 reload"
else
  log "更新 Nginx 配置 → $NGINX_CONF"
  if [[ -f "$NGINX_CONF" ]]; then
    sudo cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%F-%H%M%S)"
  fi
  sudo cp "$SRC_CONF" "$NGINX_CONF"
  sudo nginx -t
  sudo systemctl reload nginx
fi

# ── 6. 健康检查 ────────────────────────────────────────────
log "等待后端就绪 ($HEALTH_URL)"
for _ in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "✓ /api/health OK"
    curl -fsS "$HEALTH_URL"; echo
    exit 0
  fi
  sleep 2
done

warn "✗ /api/health 在 30 秒内未就绪"
docker logs --tail 80 GassTopList || true
exit 1
