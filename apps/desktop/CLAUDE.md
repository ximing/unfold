# `apps/desktop` 桌面壳指令

## 这个目录负责什么

- 基于 Tauri 2（`src-tauri/`）的轻量桌面外壳。
- 开发模式加载 `http://localhost:5173`，生产模式直接加载 `https://unfold.aimo.plus`。
- 会话沿用页面同源的 HttpOnly Cookie `unfold_session`，服务端写 `Max-Age` 400 天。没有过期时间时，WebView 会在进程退出后丢掉它。壳和系统浏览器不共享 Cookie。

## 放置约束

- `src-tauri/src/` — 窗口、系统菜单、macOS 托盘、导航策略。
- `src-tauri/capabilities/default.json` — 权限白名单。页面不调用 IPC，权限数组保持为空。
- `src-tauri/icons/` — `pnpm --filter @unfold/desktop icons` 的产物，禁止手改。
- `scripts/raster-icon.mjs` — 用 ImageMagick 处理仓库根目录 `logo.png`：外圈透明，圆角白底，再交给 `tauri icon`。托盘图是标记的黑色模板。
- `scripts/before-dev.mjs` — `5173` 没有页面时，在仓库根启动 `@unfold/web`。不启动 server。
- `__tests__/tauri.contract.test.mjs` — 壳的 URL、导航和权限契约。
- **不放什么**：不打包 `apps/web/dist`，不依赖 `@unfold/web` 或 `@tauri-apps/api`，不引入 HTTP、存储或令牌插件。

## 开发偏好与架构约束

修改后运行 `pnpm --filter @unfold/desktop test`。

- 安装包由仓库 `.github/workflows/desktop-release.yml` 构建并上传到 GitHub Release。标签是 `desktop-v` 加上版本号。版本在 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处保持相同。
- 矩阵是 Windows x64、Linux x64、macOS Apple 芯片（`aarch64-apple-darwin`）和 macOS Intel（`x86_64-apple-darwin`）。不要把 `apps/web` 的构建塞进这条 workflow。

- `devUrl` 必须是 `http://localhost:5173`。不要改成 `127.0.0.1`。Vite 代理到 `3000`，浏览器看到的源仍是 `localhost`。
- 不设置 `beforeBuildCommand`。`frontendDist` 保持 `https://unfold.aimo.plus`，无路径、无末尾斜杠。
- 导航只拒绝 `tauri:` 和 `tauri.localhost`。`open::that` 只出现在 `on_new_window`。
- macOS 红灯隐藏窗口。托盘图标使用 `icon_as_template(true)`。
- `window-state` 排除 `VISIBLE`。不要把该插件或托盘的 JS 权限写进 capability。
- Web 源码不检测 Tauri。壳不提供截图、剪贴板或自定义命令。
