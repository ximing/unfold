---
paths:
  - ".github/workflows/desktop-release.yml"
  - "apps/desktop/package.json"
  - "apps/desktop/src-tauri/tauri.conf.json"
  - "apps/desktop/src-tauri/Cargo.toml"
  - "apps/desktop/src-tauri/Cargo.lock"
---

# 桌面版本与发布

- 安装包由仓库 `.github/workflows/desktop-release.yml` 构建并上传到 GitHub Release。标签是 `desktop-v` 加上版本号。版本在 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处保持相同。
- 矩阵是 Windows x64、Linux x64、macOS Apple 芯片（`aarch64-apple-darwin`）和 macOS Intel（`x86_64-apple-darwin`）。不要把 `apps/web` 的构建塞进这条 workflow。
