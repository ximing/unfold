# Unfold 部署

密码、AccessKey、`SESSION_SECRET` 不写在这里，只在应用机 `/root/apps/unfold/.env`（权限 600）。

## 拓扑

```
https://unfold.aimo.plus
  → 入口 openresty（39.96.159.212）
  → 应用机 222.128.65.91:13009
  → unfold-server:3000（Fastify 同时返回页面和 /api）
  → PostgreSQL 18（192.168.9.109:5432，库 unfold_prod）
  → 图片文件在容器卷 unfold_unfold-assets，目录 /data/assets
  → 头像对象在 https://s3.aimo.plus 桶 unfold
```

域名解析指向 `39.96.159.212`，证书是现有 `*.aimo.plus` 的 `/root/apps/nginx/ssl/aimo.plus.cer`。容器里没有 nginx。

## 机器与路径

| 角色 | 登录 | 路径 |
| --- | --- | --- |
| 应用 | `ssh -p 11022 root@222.128.65.91` | `/root/apps/unfold/`（`docker-compose.yml` + `.env`），镜像 `ghcr.io/ximing/unfold-server:stable` |
| 数据库 | `ssh -p 11023 root@222.128.65.91` | 宿主机 PostgreSQL 18，`postgresql@18-main`。内网地址 `192.168.9.109` |
| 入口 | `ssh root@39.96.159.212` | `/root/apps/nginx/sites/aimo.plus/unfold.conf`，容器名 `openresty` |

应用机端口 `13009`。`13000`–`13008` 和 `13016` 已被别的服务占用。

## 发布

镜像只由 GitHub Actions 构建，推到 `ghcr.io/ximing/unfold-server`。推送到 `main` 后，默认分支的标签是 `stable`。应用机不接收源码，也不在机器上构建。

等 Actions 成功后，在应用机执行：

```bash
cd /root/apps/unfold
docker compose pull
docker compose run --rm --no-deps --entrypoint node server --import tsx src/migrate.ts
docker compose up -d
```

compose 里的镜像是 `ghcr.io/ximing/unfold-server:stable`。migrate 的输出是 `migrated`。有新迁移时必须先 migrate，再 `up -d`。

禁止把工作区同步到应用机再 `docker build`。

## 数据库

复用库机上已有的 `unfold_prod` / `unfold_prod_user`。`pg_hba.conf` 里原来就有这条：

```
host unfold_prod unfold_prod_user 0.0.0.0/0 scram-sha-256
```

口令只在应用机 `.env` 和两台机器的 `/root/.unfold-prod-password`（600）。迁移用上一节的命令。

业务表：`users`、`collections`、`nodes`、`memberships`、`edges`、`collection_edges`、`collection_inclusions`、`cards`、`assets`。

## 对象存储

桶 `unfold` 在 `s3.aimo.plus`。访问密钥与 inwit 生产环境同一组，放在 unfold 的 `.env`，不另建密钥。`ATTACHMENT_S3_IS_PUBLIC=false`，`ATTACHMENT_S3_FORCE_PATH_STYLE=true`，区域 `cn-beijing`。

## 入口

`unfold.conf` 只听 443，`client_max_body_size 20m`，反代到 `http://222.128.65.91:13009`，并带上 `X-Forwarded-Proto https`。改完先测语法再 reload：

```bash
ssh root@39.96.159.212 'docker exec openresty nginx -t && docker exec openresty nginx -s reload'
```

`UNFOLD_ENV=production` 时登录 Cookie 带 `Secure`，必须走这条 HTTPS。应用听 `0.0.0.0:3000`，由 compose 映射到宿主机 `13009`。

## 桌面客户端

安装包不包含页面。窗口打开 `https://unfold.aimo.plus`。页面更新只靠上面的镜像发布，不靠用户重装壳。壳的标识是 `plus.aimo.unfold`。壳里的登录 Cookie 留在这个标识的 WebView 里，和系统浏览器不是同一份。

安装包由 `.github/workflows/desktop-release.yml` 构建，不在应用机上编译。覆盖 Windows x64、Linux x64、macOS Apple 芯片和 macOS Intel。把 `apps/desktop/package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本改成同一个 `x.y.z`，提交后打标签 `desktop-vx.y.z`。Release 与标签同名，资产可直接下载。手动跑这条 workflow 时，标签是 `desktop-v` 加上配置里的版本。macOS 只做临时签名，没有公证。

## 验收

- 应用机 `curl http://127.0.0.1:13009/health` → `{"ok":true}`，容器状态 healthy，镜像是 `ghcr.io/ximing/unfold-server:stable`
- `https://unfold.aimo.plus/` → 200，HTML 标题 Unfold
- `https://unfold.aimo.plus/library` → 200，`text/html`（刷新走 `index.html`）
- `https://unfold.aimo.plus/health` → `{"ok":true}`
- `https://unfold.aimo.plus/api/me` → 401 `unauthenticated`

## 注意

- 应用机只从 GHCR 拉镜像。拉不动时查登录和包权限，不要在应用机补构建。
- `apps/web` 的 `tsc` 依赖仓库根上的 `tsconfig.base.json`。Dockerfile 的 web 阶段必须 `COPY` 这个文件，否则类型检查按默认配置跑，镜像构建停在 `pnpm --filter @unfold/web build`。
- 入口 nginx 是容器 `openresty`，配置挂在 `/root/apps/nginx`。站点文件放进 `sites/aimo.plus/` 就会被 `aimo.plus.conf` 的 include 带上。不要去容器里另找一份 `/etc/nginx`。
