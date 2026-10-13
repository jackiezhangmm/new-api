# `/playground/canvas` 承载方式研究

> 研究时间：2026-02-01。本文只记录 M0 的承载决策，不表示已完成实现。

## 结论

推荐采用：**主站 TanStack Router 的认证路由 + 同源 iframe 承载独立 Vite 画布应用**。

```text
主站 Browser/TanStack Router
  └── /playground/canvas（认证布局、导航、页面标题、离开保护）
        └── iframe src="/canvas/index.html"（独立 React/Vite 应用）
```

推荐 iframe 而不是把 V0 源码直接编译进 `web/`，原因是 V0 已经是独立 React Router/Vite 应用；直接合并会产生路由、依赖、全局样式、状态和构建配置冲突，且难以保持“独立依赖、独立构建”。iframe 同时保留上游应用边界，并允许主站只通过明确的宿主协议通信。

推荐**同源但不把 iframe 当作安全隔离**：主站和画布使用同一站点，使相对 API、Cookie/会话和公开图片请求自然工作；但同源 iframe 在浏览器权限模型中不是安全边界，宿主接口、消息校验和 CSP 仍必须按不可信子应用设计。上游页面若含有自己的 API Key/Base URL 配置，不能因为 iframe 就认为凭据安全，后续 M1 必须裁剪或禁用它们。

## 候选方案比较

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 主站路由直接挂载画布组件 | 不选 | 破坏 V0 独立应用边界；需要迁移路由、Provider、全局 CSS 和依赖，难以控制集成 diff |
| 同源 iframe | **推荐** | 独立构建和运行时，路由/样式隔离，主站导航保留，API 使用同源路径；宿主协议清晰 |
| 跨源 iframe | 不选 | 需要 postMessage、CORS、跨源认证桥和更多部署复杂度；当前规划并不需要安全租户隔离 |
| 新窗口/独立页面 | 不选 | 主站导航和应用上下文断裂；无法自然满足 `/playground/canvas` 的内嵌入口 |
| iframe + `sandbox` | 暂不选 | V0 上游应用需要脚本、存储、下载/文件能力；同源场景 `allow-scripts allow-same-origin` 不能提供有效安全边界，反而增加浏览器兼容风险。安全限制应由 M1 的能力裁剪、CSP 和消息协议解决 |

## 关键技术事实

### iframe

MDN 说明 iframe 是独立 browsing context；同源父页面可以访问其内容，但跨源场景应使用 `window.postMessage`。`sandbox` 在未声明 `allow-same-origin` 时会使内容成为 opaque origin，影响 Cookie、存储等能力；同源页面同时声明 `allow-scripts` 和 `allow-same-origin` 时不应把它当作安全隔离。

因此 M0 的 iframe 只负责承载和布局，不直接操作子应用 DOM，也不依赖跨窗口 DOM 访问。主站通过 `postMessage` 发送初始化信息；消息必须校验 `event.origin`、`event.source` 和协议版本。M0 可以只发送产品/宿主版本和 API 基路径，认证凭据获取与注入放到 M1。

### Vite

Vite 官方文档说明，部署到子路径时应配置 `base`，构建产物中的资源 URL 才会使用该路径。若画布入口最终位于 `/canvas/`，Vite 必须以 `/canvas/` 为 base；开发服务器则通过代理或专用入口提供一致的资源前缀。不能用 `base: './'` 掩盖服务端错误路由，否则深层页面刷新、动态 import 和 CSS URL 容易出现环境差异。

M0 应让子应用构建产物稳定地位于 `web/dist/canvas/`，入口为 `/canvas/index.html`，并让 `/playground/canvas` 由主站认证页面加载 iframe。`/canvas/<真实资源>` 缺失必须 404，不能被主站 SPA 兜底吞掉。

### React Router

V0 使用 `createBrowserRouter`，不是组件片段。保留 Browser Router 时，子应用的 URL 历史属于 iframe 自己的 browsing context；它不会把画布工程路由直接写入主站地址栏。这是本阶段接受的代价：主站 back 返回 `/playground/canvas` 页面，画布内部的 back 由子应用处理。

不建议在 M0 为了嵌入改成 Memory Router：Memory Router 不提供可复制的画布 URL，也会使刷新、深链和工程打开行为更不透明。若后续产品要求主站地址栏反映画布工程，应另立承载决策，不能在 M0 隐式重构路由。

## M0 的具体承载契约

### 主站

新增认证路由 `/playground/canvas`，位于现有认证布局内。页面职责仅限：

- 渲染 `iframe`，占满内容区域，保留主站 header/sidebar；
- 监听 iframe `load`/`error`，提供加载中和失败提示；
- 通过 `postMessage` 发送版本化宿主初始化消息；
- 接收子应用的 ready、title/dirty 状态（若 V0 已能发出）；
- 后续负责统一会话失效和离开页面保护；
- 不读取或修改 iframe 内部 DOM，不复制画布状态。

iframe 使用稳定的同源绝对路径 `/canvas/index.html`，而不是 `/playground/canvas`，避免主站路由和子应用 Browser Router 互相争抢 URL。`title`、`className`、`allow` 等属性明确设置；M0 不默认开放 camera/microphone，图片文件选择通过浏览器标准 file input，不需要权限策略。

### 子应用

保留 V0 的独立入口和 Browser Router，M0 只做承载所需的最小适配：

- `base: '/canvas/'`；
- 生产入口可从 `/canvas/index.html` 加载；
- 开发模式提供同样的 `/canvas/` 前缀代理；
- 通过 `postMessage` 发 `canvas:ready`，接收 `canvas:host-init`；
- 不把 token、API Key 或宿主配置写入 localStorage/IndexedDB；
- 不通过 `window.parent.location` 导航主站，主站导航由宿主完成。

### Go 静态托管

现有 `router/web-router.go` 使用 `static.Serve("/", frontendFS)`，NoRoute 对未知非 API 路径返回主站 IndexPage。M0 必须在静态服务与 SPA 兜底之间增加明确判断：

1. `/canvas/` 入口和真实资源从 embedded `web/dist/canvas` 提供；
2. `/canvas/` 页面路由若确实需要 HTML 兜底，范围只限画布内部页面；
3. `/canvas/*.js`、`*.css`、字体、图片等缺失资源返回 404；
4. `/playground/canvas` 仍由主站 TanStack Router 认证页面处理；
5. `/api`、`/v1` 和 `/assets` 继续进入 API/Relay 404 逻辑。

优先使用显式 `/canvas` 文件服务，而不是把整个 root static handler 改造成两个 SPA 的猜测式兜底。

## M0 验收

### 自动化

- `canvas/web` 能独立 `bun run build`，产物含 `index.html`、JS、CSS 和 `/canvas/` 前缀资源引用；
- `make build-web` 能把画布制品装配到 `web/dist/canvas/`；
- 访问 `/playground/canvas` 未认证时遵循主站认证行为；
- 已认证访问返回主站布局和 iframe；
- `/canvas/` 真实入口为 200；缺失 `/canvas/not-found.js` 为 404；不能返回主站 index；
- 主站已有路由和静态资源行为不回归；
- `postMessage` 只接受当前 iframe 的来源和协议版本。

### `make dev` 人工验收

1. 登录 `http://127.0.0.1:5173`，进入 `/playground/canvas`；主站 header/sidebar 保留，iframe 填满剩余区域。
2. 直接刷新 `/playground/canvas`，不出现 Vite 404；画布资源来自预期开发代理。
3. 在画布内部从 `/canvas` 进入 `/canvas/:id`，刷新后内部路由正常；主站导航仍可用。
4. 在浏览器 Network 中确认画布静态资源不是通过主站 SPA HTML 返回；故意访问缺失 JS，得到 404。
5. 打开主站其他 `/playground/*` 页面，确认布局和路由不受影响。

### `make preview` 人工验收

1. 执行 `make preview`，访问 `http://127.0.0.1:5174/playground/canvas`。
2. 验证正式制品中 JS、CSS、字体和图片资源全部从 `/canvas/` 正确加载。
3. 在新标签页直达 `/canvas/index.html`，确认它是独立画布制品；这不是认证入口，M1 前不承诺业务可用。
4. 查看控制台，不应有资源 MIME 错误、动态 import 404 或主站 HTML 被当作 JS 执行。

## 不在本次研究结论中解决的问题

- M1 的认证头如何由宿主注入；
- 是否需要专用能力查询接口；
- iframe 是否长期保留，或未来迁移为主站原生路由；
- 画布内部 URL 是否同步到主站地址栏；
- 生产环境是否配置独立 CSP header；
- V0 上游页面本身的类型检查错误。

这些问题会影响行为或长期架构，实施时若需要改变上述承载结论，应重新进入 grilling，而不是在 M0 中顺手决定。

## 参考来源

- MDN，`<iframe>`：https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- MDN，Permissions Policy：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy
- Vite，Building for Production：https://vite.dev/guide/build.html
- React Router，`createMemoryRouter`：https://reactrouter.com/api/data-routers/createMemoryRouter
- TanStack Router，Navigation Blocking：https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking
