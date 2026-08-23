#!/usr/bin/env bash
# 服务器端更新脚本：放到服务器上与 docker-compose.yml 同目录。
# 手动执行：bash deploy.sh；GitHub Actions 推送后也会远程调用它。
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 拉取最新镜像"
docker compose pull

echo "==> 滚动重启"
docker compose up -d --remove-orphans

echo "==> 清理悬空旧镜像"
docker image prune -f

echo "==> 等待健康检查通过"
for _ in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' mine-brain 2>/dev/null || echo unknown)
  if [ "$status" = "healthy" ]; then
    echo "部署完成：mine-brain 已就绪 -> http://<服务器IP>:8088"
    exit 0
  fi
  sleep 2
done

echo "警告：60 秒内未变为 healthy，排查日志：docker logs -f mine-brain" >&2
exit 1
