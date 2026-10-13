# M12 图片数字资产双向复用 — Agent 交接指南

本文档旨在帮助后续执行 Agent **跳过盲目探索，直接进入改动与验证**。

---

## 1. 核心改动文件索引与调用链路

### 1.1 后端（Go / GORM / PostgreSQL）
- **实体模型**：`model/digital_asset.go`
  - `DigitalAsset` 结构体：增加 `ImageId *string` (`gorm:"type:varchar(64);index"`)，以及外键关系 `Image *Image` (`gorm:"foreignKey:ImageId;references:Id"`，注意标记 `json:"image,omitempty"` 或 `json:"image"`）。
  - `ListDigitalAssets` / `GetDigitalAsset`：查询时链式调用 `.Preload("Image")`；`filter` 增加 `AssetType string`，按需要添加 `.Where("asset_type = ?", filter.AssetType)`。
  - `CreateDigitalAsset`：入参增加 `imageId *string`。
- **关联模型**：`model/image.go`
  - 已有 `GetImageById(id string) (*Image, error)`，返回 S3 Key, URL, Width, Height, MimeType 等。
- **DTO 载荷**：`dto/digital_asset.go`
  - `DigitalAssetWriteRequest`：增加 `ImageId *string \`json:"image_id"\``。
- **控制器与校验**：`controller/digital_asset.go`
  - `bindDigitalAssetWriteRequest`：
    - `AssetType` 放行 `"text"` 与 `"image"`。
    - 当为 `"image"` 时：必填 `ImageId`，通过 `model.GetImageById(*request.ImageId)` 校验底层图片存在性。**注意（模型 B 核心共识）**：仅需校验图片存在且有效，**不要**阻断 `image.UserId != userId`（允许作为个人收藏引用他人/系统图片）。
  - `ListDigitalAssets`：读取查询参数 `c.Query("asset_type")`，传入 Filter。
- **后端测试先例**：`controller/digital_asset_test.go`
  - 既有 setup 函数直接提供内存测试环境，复制现有测试套件增加图片资产用例即可。

### 1.2 主站前端（`web/`，React 19 / Tailwind）
- **类型定义**：`web/src/features/digital-assets/types.ts`
  - `DigitalAsset`：`asset_type: 'text' | 'image'`，增加 `image?: { id: string; url: string; width: number; height: number; mime_type: string }` 与可选 `image_id?: string`。
  - `DigitalAssetPayload`：增加 `image_id?: string`。
- **API 客户端**：`web/src/features/digital-assets/api.ts`
  - `listDigitalAssets`：增加可选参数 `assetType?: 'text' | 'image'`，传递给 query params。
- **列表与卡片多态**：
  - `web/src/features/digital-assets/index.tsx`：顶栏增加轻量类型切换 Pills（全部 / 文本 / 图片）。
  - `web/src/features/digital-assets/components/asset-card.tsx`：
    - 参考 `web/src/features/drawing/index.tsx` 约 1360 行的 `PromptCard`。
    - 若 `asset.asset_type === 'image'`，卡片上半部渲染封面缩略图（`aspect-video` 或 `h-32`，带 `object-cover rounded-t-lg`），下半部展示标题、Prompt 摘要、标签和收藏按钮。
- **详情与编辑弹窗**：
  - `web/src/features/digital-assets/components/asset-detail-dialog.tsx`：
    - 若为图片资产，弹窗中央呈现大图（`img` 居中自适应高质量渲染），下方展示 Prompt、尺寸与标签。
  - `web/src/features/digital-assets/components/asset-form-dialog.tsx`：
    - 若为图片资产，仅开放修改标题与标签，隐藏大正文输入区或展示为只读 Prompt，不提供底图上传/替换表单。

### 1.3 画布前端（`canvas/web/`，Ant Design / Canvas Store）
- **数据层**：`canvas/web/src/services/api/digital-assets.ts`
  - 同步更新类型声明：`DigitalAsset` 支持 `asset_type: "text" | "image"` 与 `image?: ...`。
  - `CreateDigitalAssetPayload`：支持 `image_id?: string`。
- **图片节点一键存入资产**：`canvas/web/src/pages/canvas/project.tsx`
  - 定位 `saveNodeAsset`（约 2160 行）：
    - 增加 `node.type === CanvasNodeType.Image` 的分支。
    - **状态与就绪检查**：读取 `node.metadata?.storageKey`。若 `!storageKey` 或正在生成中/上传中，立即 `message.warning(t("canvas.sidePanel.imageNotReady"))` 并 return。
    - 构造载荷：`asset_type: "image"`, `image_id: storageKey`, `title: node.title || t("canvas.node.image")`, `content: node.metadata?.prompt || ""`, `tags: ["画布"]`。
    - 调用 `createDigitalAsset`，成功后 Toast 并刷新 Query Key：`DIGITAL_ASSETS_QUERY_KEY`。
- **资产侧边栏（对齐上游 29ba7a9）**：`canvas/web/src/components/canvas/canvas-side-panel.tsx`
  - 定位 `CanvasAssetsTab`（约 308 行）：
    - 激活搜索框右侧原本隐藏的「+」按钮（约 392 行 `{false && ...}`）：点击唤起文件选择器，处理多图上传。
    - 上传流转：调用现有的 `uploadImage(file)` 获得 `image`（包含 `url` 与 `storageKey`），随后调用 `createDigitalAsset` 存入个人资产库，刷新列表。
    - 卡片渲染（`DigitalAssetCard`，约 440 行）：
      - 若 `asset.asset_type === 'image'`，渲染图片缩略图封面。
      - 点击 Hover 浮现的「+」按钮，调用外部传入的 `onInsert({ kind: "image", dataUrl: asset.image?.url, storageKey: asset.image?.id, title: asset.title })`。
- **资产插入流转**：`canvas/web/src/pages/canvas/project.tsx`
  - 定位 `handleAssetInsert`（约 2742 行）：
    - 已经有 `insertAssistantImage({ id: ..., prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey })`，在 2702 行它会检查：如果已有 `storageKey`，直接复用元数据，**绝不调用二次 uploadImage**，完美契合零网络重传规范。

---

## 2. 隐藏陷阱与排坑指南

1. **路由尾部斜杠问题**：
   - 本站路由 `/api/digital-assets/` 在部分路径配置中带有尾部斜杠（特别是 `GET /api/digital-assets/` 和 `POST /api/digital-assets/`）。在画布端调用 `fetch('/api/digital-assets/')` 时必须保留尾部斜杠，否则可能触发 301 重定向导致 POST body 丢失。
2. **GORM 外键级联**：
   - 删除 `DigitalAsset` 时，GORM 仅删除关系记录。千万不要在 `model.DeleteDigitalAsset` 中误调 `DeleteImage` 或 S3 删除操作。底层的 `Image` 是公共实体，可能被其他工程或节点引用。
3. **未上传图片防假收录**：
   - 画布中如果用户拖入本地图片，但 S3 离线导致上传失败，节点会处于错误态或仅有临时 `blob:`。在此类节点上点击“存入资产”，`storageKey` 必定为空，必须硬拦截，不能发送空字符串作为 `image_id`。
4. **I18n 补齐**：
   - 修改文案（如“存入资产成功”、“图片尚未同步完成”等）请确保同步在 `web/src/i18n/locales/zh.json`、`en.json` 以及 `canvas/web/src/locales/zh.json` 中配置对应键值。

---

## 3. 常用验证与回归命令

```bash
# 1. 运行 Go 后端数字资产测试
go test -v ./controller -run TestDigitalAsset

# 2. 运行画布单元测试
cd canvas/web && bun run test:unit

# 3. 运行主站单元测试
cd web && bun run test

# 4. 运行画布 E2E 测试（依赖主站 dev 环境已启动）
cd canvas/web && bun run test:e2e
# 或者单独跑 m12：
cd canvas/web && npx playwright test tests/m12.spec.ts

# 5. 前后端类型与构建检查
cd canvas/web && bun run typecheck
cd web && bun run typecheck
make build-web
```
