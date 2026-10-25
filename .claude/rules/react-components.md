---
paths:
  - "apps/web/src/**/*.{tsx,css}"
---

# React 组件与样式规范

## 响应式组件（`@rabjs/react`）

- 订阅 Service 状态的组件必须使用 `observer(function ComponentName() { ... })` 包装，并通过 `useService(ServiceClass)` 获取实例。
- 页面级或壳层级的局部 Service 通过 `bindServices(ViewComponent, [ServiceClass])` 绑定，不要在子组件重复绑定同一个共享 Service。
- 属于单组件内部的瞬态 UI 状态（如弹层开关、输入草稿、拖拽临时坐标）优先使用 React `useState` / `useRef`，仅跨组件共享或需与后端同步的领域数据放入 Service。

## 样式共置与视觉令牌

- **就近共置**：组件样式文件 `<name>.css` 与组件 `<name>.tsx` 放在同一目录并直接 `import './<name>.css'`，禁止新建集中式巨型样式文件。
- **令牌优先**：颜色、圆角、阴影、毛玻璃、字体族优先复用 `apps/web/src/foundation/base.css` 与 `motion.css` 中的 CSS 变量（浅色分层灰、毛玻璃面板、单灰蓝强调色；界面无衬线、笔记正文衬线、代码等宽）。
- **基础组件规范**：`apps/web/src/shared/ui/` 下的通用组件统一以 `U` 前缀命名（如 `UButton`、`UField`、`USelect`、`UModal`、`UDateField`），保持受控/无业务耦合的 Props 接口。

## 交互与可访问性

- 用户可见文案全部使用精炼中文（与 PRD 保持一致）。
- 纯图标按钮（`.ibtn`、`.rail-btn`）必须提供中文 `aria-label`（必要时附带 `title` 显示快捷键，如 `搜索 ⌘K`）。
- 全局或画布级键盘事件（如 `Esc`、`Enter`、方向键、`⌘K`、`⌘N`）需注意焦点保护，当焦点位于 `input`、`textarea` 或富文本编辑器（`.tiptap` / `contenteditable`）内时避免误拦截用户输入。
