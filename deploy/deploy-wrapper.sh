#!/usr/bin/env bash
# 部署 wrapper：
#   被 root 的 ~/.ssh/authorized_keys 中的 forced-command 调用；
#   作用是对 ref 做严格白名单校验，再以受控方式调用 install.sh。
#
# 不直接接受 SSH_ORIGINAL_COMMAND 拼接 shell（会有命令注入），
# 而是把它视为一个"参数"，正则校验后通过环境变量 REF 传给 install.sh。
#
# authorized_keys 配置示例（一行）：
#   command="/opt/GassTopList/deploy/deploy-wrapper.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,restrict ssh-ed25519 AAAA... github-actions-deploy

set -euo pipefail

# 客户端 ssh 命令的尾随字符串（即 GitHub Actions 工作流里 ssh 后面那段）
RAW="${SSH_ORIGINAL_COMMAND:-main}"

# 白名单：
#   - 主分支 main
#   - 形如 v1 / v1.2 / v1.2.3 / v1.2.3-rc.1 的 tag
#   - 完整 40 位提交 SHA（小写十六进制）
if ! [[ "$RAW" =~ ^(main|v[0-9]+(\.[0-9]+)*(-[a-z0-9.]+)?|[a-f0-9]{40})$ ]]; then
  echo "[deploy-wrapper] 拒绝：非法的 ref 格式 -> $RAW" >&2
  exit 1
fi

# 校验通过，调用幂等部署脚本
exec env REF="$RAW" bash /opt/GassTopList/deploy/install.sh
