import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

const defaultFeaturedPrompts = [
    {
        id: 101,
        title: "赛博朋克霓虹猫咪",
        prompt: "Cyberpunk neon cat with glowing blue eyes, 8k resolution cinematic lighting",
        cover_url: "https://assets.test/cat.webp",
        sort_order: 1,
        created_at: 1726000000,
        updated_at: 1726000000,
    },
    {
        id: 102,
        title: "水墨江南画卷",
        prompt: "Traditional Chinese ink wash painting of misty river and mountains",
        cover_url: "https://assets.test/ink.webp",
        sort_order: 2,
        created_at: 1726000100,
        updated_at: 1726000100,
    },
    {
        id: 103,
        title: "未来科幻太空战舰",
        prompt: "Futuristic sci-fi battleship in orbit around Saturn rings",
        cover_url: "",
        sort_order: 3,
        created_at: 1726000200,
        updated_at: 1726000200,
    },
];

async function setupM10Env(
    page: Page,
    initialProjects: any[] = [],
    featuredPrompts: any[] = defaultFeaturedPrompts,
    options: { failFeaturedPrompts?: boolean } = {},
) {
    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 910, username: "canvas-m10", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-m10-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m10-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-image-2", "gpt-5.6-terra"] : user } });
        }
    });

    let currentFeaturedPromptsFail = options.failFeaturedPrompts ?? false;

    await page.route("**/api/featured-prompts**", async (route) => {
        if (currentFeaturedPromptsFail) {
            await route.fulfill({
                status: 500,
                json: { success: false, message: "词库服务暂时不可用" },
            });
            return;
        }
        await route.fulfill({
            status: 200,
            json: {
                success: true,
                message: "",
                data: {
                    page: 1,
                    page_size: 100,
                    total: featuredPrompts.length,
                    items: featuredPrompts,
                },
            },
        });
    });

    await page.route("https://assets.test/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: pngBuffer,
        });
    });

    return {
        projectApi,
        setFeaturedPromptsFail: (fail: boolean) => {
            currentFeaturedPromptsFail = fail;
        },
    };
}

test("M10 侧边栏精选词库展示、0ms 即时过滤、查看详情与一键插入独立文本节点", async ({ page }) => {
    const initialProject = {
        id: "proj-m10-sidebar-1",
        user_id: 910,
        title: "词库侧边栏测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "existing-image-1",
                    type: "image",
                    title: "已有图片节点",
                    position: { x: 100, y: 120 },
                    width: 320,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://assets.test/sample.png",
                    },
                },
            ],
            connections: [],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    await setupM10Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("词库侧边栏测试工程").first().click();
    const existingNode = canvas.locator('[data-node-id="existing-image-1"]');
    await expect(existingNode).toBeVisible({ timeout: 5000 });

    // 1. 切换到“提示词库”Tab
    const promptTabBtn = canvas.getByRole("button", { name: "提示词库" }).first();
    await expect(promptTabBtn).toBeVisible({ timeout: 5000 });
    await promptTabBtn.click();

    // 2. 验证“Bululu精选”折叠分组默认展开，并显示条目总数 3
    await expect(canvas.getByText("Bululu精选").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("3").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("赛博朋克霓虹猫咪").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("水墨江南画卷").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("未来科幻太空战舰").first()).toBeVisible({ timeout: 5000 });

    // 3. 验证 0ms 关键词即时搜索过滤
    const searchInput = canvas.getByPlaceholder("搜索提示词");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("水墨");
    await expect(canvas.getByText("水墨江南画卷").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("赛博朋克霓虹猫咪")).toHaveCount(0);
    await expect(canvas.getByText("未来科幻太空战舰")).toHaveCount(0);

    // 清空搜索框，恢复全量展示
    await searchInput.fill("");
    await expect(canvas.getByText("赛博朋克霓虹猫咪").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("水墨江南画卷").first()).toBeVisible({ timeout: 5000 });

    // 4. 点击眼睛图标打开详情对话框
    const viewDetailBtn = canvas.getByRole("button", { name: "查看详情" }).first();
    await viewDetailBtn.click();
    await expect(canvas.getByText("Cyberpunk neon cat with glowing blue eyes, 8k resolution cinematic lighting").first()).toBeVisible({ timeout: 5000 });
    // 关闭详情弹窗（点击右上角关闭按钮或按 ESC）
    await canvas.locator(".ant-modal-close").first().click();

    // 5. 点击加号按钮一键插入文本节点
    const insertBtn = canvas.getByRole("button", { name: "插入画布" }).first();
    await insertBtn.click();

    // 验证画布上生成了新的节点且包含对应提示词
    await expect(canvas.locator("[data-node-id]")).toHaveCount(2, { timeout: 5000 });
    const derivedTextNode = canvas.locator("[data-node-id]").filter({ hasText: "Cyberpunk neon cat with glowing blue eyes, 8k resolution cinematic lighting" });
    await expect(derivedTextNode).toBeVisible({ timeout: 5000 });

    // 验证原有节点完好无损
    await expect(existingNode).toBeVisible();
});

test("M10 节点编辑面板快捷图书弹窗：对齐 200px 侧栏、即时搜索与选词覆盖填入", async ({ page }) => {
    const initialProject = {
        id: "proj-m10-node-panel-1",
        user_id: 910,
        title: "节点弹窗选词测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "target-gen-node",
                    type: "image",
                    title: "目标生图节点",
                    position: { x: 300, y: 150 },
                    width: 320,
                    height: 240,
                    metadata: {
                        prompt: "原始占位提示词",
                        model: "gpt-image-2",
                    },
                },
            ],
            connections: [],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    await setupM10Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("节点弹窗选词测试工程").first().click();
    const targetNode = canvas.locator('[data-node-id="target-gen-node"]');
    await expect(targetNode).toBeVisible({ timeout: 5000 });

    // 选中节点唤起底部提示词编辑面板
    await targetNode.click();

    // 验证图书图标按钮（CanvasPromptLibrary）存在于操作栏中（位于放大编辑按钮旁）
    const promptLibraryBtn = canvas.getByRole("button", { name: "放大编辑" }).locator("..").getByRole("button", { name: "提示词库" });
    await expect(promptLibraryBtn).toBeVisible({ timeout: 5000 });
    await promptLibraryBtn.click();

    // 验证 PromptSelectDialog 弹窗打开
    const dialogModal = canvas.locator(".ant-modal:visible");
    await expect(dialogModal).toBeVisible({ timeout: 5000 });

    // 验证左侧 200px 侧栏分类包含“Bululu精选”
    await expect(dialogModal.getByText("Bululu精选")).toBeVisible({ timeout: 5000 });

    // 验证弹窗右侧卡片展示
    await expect(dialogModal.getByText("赛博朋克霓虹猫咪").first()).toBeVisible({ timeout: 5000 });
    await expect(dialogModal.getByText("水墨江南画卷").first()).toBeVisible({ timeout: 5000 });

    // 验证弹窗内搜索框
    const dialogSearchInput = dialogModal.getByPlaceholder("按标题查询");
    await expect(dialogSearchInput).toBeVisible();
    await dialogSearchInput.fill("江南");
    await expect(dialogModal.getByText("水墨江南画卷").first()).toBeVisible({ timeout: 5000 });
    await expect(dialogModal.getByText("赛博朋克霓虹猫咪")).toHaveCount(0);

    // 点击水墨江南画卷卡片覆盖填入
    await dialogModal.getByText("水墨江南画卷").first().click();

    // 验证弹窗已自动关闭
    await expect(canvas.locator(".ant-modal-content")).toHaveCount(0);

    // 验证节点输入框中已覆盖填入所选词条
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).toBeVisible({ timeout: 5000 });
    await expect(chipInput).toHaveText("Traditional Chinese ink wash painting of misty river and mountains");
});

test("M10 接口异常时在侧边栏明确提示错误并支持重试，坚决不崩溃与回退外部源", async ({ page }) => {
    const initialProject = {
        id: "proj-m10-error-1",
        user_id: 910,
        title: "错误降级测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [],
            connections: [],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    const env = await setupM10Env(page, [initialProject], defaultFeaturedPrompts, { failFeaturedPrompts: true });
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("错误降级测试工程").first().click();

    // 切换到“提示词库”Tab
    const promptTabBtn = canvas.getByRole("button", { name: "提示词库" }).first();
    await expect(promptTabBtn).toBeVisible({ timeout: 5000 });
    await promptTabBtn.click();

    // 验证显示加载失败并提示重试
    const retryBtn = canvas.getByRole("button", { name: "加载失败，点击重试" });
    await expect(retryBtn).toBeVisible({ timeout: 5000 });

    // 恢复接口正常响应并点击重试
    env.setFeaturedPromptsFail(false);
    await retryBtn.click();

    // 验证重试成功后展示精选词列表
    await expect(canvas.getByText("赛博朋克霓虹猫咪").first()).toBeVisible({ timeout: 5000 });
});
