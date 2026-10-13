import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

type MockTag = {
    id: number;
    user_id: number;
    name: string;
    created_at: number;
    updated_at: number;
};

type MockAsset = {
    id: number;
    user_id: number;
    asset_type: "text";
    title: string;
    content: string;
    is_favorite: boolean;
    created_at: number;
    updated_at: number;
    tags: MockTag[];
};

const defaultMockTags: MockTag[] = [
    { id: 1, user_id: 910, name: "画布", created_at: 1726000000, updated_at: 1726000000 },
    { id: 2, user_id: 910, name: "人物", created_at: 1726000000, updated_at: 1726000000 },
    { id: 3, user_id: 910, name: "风景", created_at: 1726000000, updated_at: 1726000000 },
];

const defaultMockAssets: MockAsset[] = [
    {
        id: 201,
        user_id: 910,
        asset_type: "text",
        title: "赛博朋克文本",
        content: "赛博朋克霓虹街道详细设定正文",
        is_favorite: false,
        created_at: 1726000000,
        updated_at: 1726000000,
        tags: [
            { id: 1, user_id: 910, name: "画布", created_at: 1726000000, updated_at: 1726000000 },
            { id: 2, user_id: 910, name: "人物", created_at: 1726000000, updated_at: 1726000000 },
        ],
    },
    {
        id: 202,
        user_id: 910,
        asset_type: "text",
        title: "江南水乡画作",
        content: "烟雨江南水墨群山风景描写",
        is_favorite: false,
        created_at: 1726000100,
        updated_at: 1726000100,
        tags: [{ id: 3, user_id: 910, name: "风景", created_at: 1726000000, updated_at: 1726000000 }],
    },
];

async function setupM11Env(
    page: Page,
    initialProjects: any[] = [],
    options: {
        user?: { id: number; username: string; role: number; group: string };
        initialAssets?: MockAsset[];
        initialTags?: MockTag[];
    } = {},
) {
    page.on("pageerror", (err) => console.error(`[PAGE ERROR]`, err));

    let currentUser = options.user || { id: 910, username: "canvas-m11", role: 100, group: "default" };
    let assets = JSON.parse(JSON.stringify(options.initialAssets || defaultMockAssets)) as MockAsset[];
    const tags = JSON.parse(JSON.stringify(options.initialTags || defaultMockTags)) as MockTag[];
    const createdPayloads: any[] = [];
    const deletedIds: number[] = [];
    let nextAssetId = 300;

    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: `canvas-m11-session-${currentUser.id}`,
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user: currentUser,
                        session: { sid: "m11-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-image-2", "gpt-5.6-terra"] : currentUser } });
        }
    });

    await page.route("**/api/digital-assets/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const method = req.method();

        if (url.pathname === "/api/digital-assets/tags") {
            if (currentUser.id !== 910) {
                await route.fulfill({ json: { success: true, message: "", data: [] } });
                return;
            }
            await route.fulfill({
                json: {
                    success: true,
                    message: "",
                    data: tags,
                },
            });
            return;
        }

        if (method === "DELETE") {
            const parts = url.pathname.replace(/\/$/, "").split("/");
            const id = Number(parts[parts.length - 1]);
            deletedIds.push(id);
            assets = assets.filter((a) => a.id !== id);
            await route.fulfill({ json: { success: true, message: "", data: null } });
            return;
        }

        if (method === "POST") {
            const body = req.postDataJSON();
            createdPayloads.push(body);
            const newAsset: MockAsset = {
                id: ++nextAssetId,
                user_id: currentUser.id,
                asset_type: body.asset_type || "text",
                title: body.title,
                content: body.content,
                is_favorite: false,
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                tags: (body.tags || []).map((name: string, i: number) => ({
                    id: 10 + i,
                    user_id: currentUser.id,
                    name,
                    created_at: Math.floor(Date.now() / 1000),
                    updated_at: Math.floor(Date.now() / 1000),
                })),
            };
            assets.unshift(newAsset);
            await route.fulfill({ json: { success: true, message: "", data: newAsset } });
            return;
        }

        // GET /api/digital-assets/?...
        if (currentUser.id !== 910) {
            await route.fulfill({
                json: {
                    success: true,
                    message: "",
                    data: { page: 1, page_size: 50, total: 0, items: [] },
                },
            });
            return;
        }

        const search = (url.searchParams.get("search") || "").trim().toLowerCase();
        const tagIds = url.searchParams.getAll("tag_id").map(Number).filter(Boolean);

        let filtered = assets.filter((a) => a.user_id === currentUser.id);
        if (search) {
            filtered = filtered.filter((a) => a.title.toLowerCase().includes(search) || a.content.toLowerCase().includes(search));
        }
        if (tagIds.length > 0) {
            filtered = filtered.filter((a) => tagIds.every((tid) => a.tags.some((t) => t.id === tid)));
        }

        await route.fulfill({
            json: {
                success: true,
                message: "",
                data: {
                    page: 1,
                    page_size: 50,
                    total: filtered.length,
                    items: filtered,
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
        getCreatedPayloads: () => createdPayloads,
        getDeletedIds: () => deletedIds,
        setCurrentUser: (user: { id: number; username: string; role: number; group: string }) => {
            currentUser = user;
        },
    };
}

test("M11 文本节点工具栏“存入资产”，验证载荷包含 tags: ['画布'] 并触发保存", async ({ page }) => {
    const initialProject = {
        id: "proj-m11-save-1",
        user_id: 910,
        title: "存资产测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "target-text-node",
                    type: "text",
                    title: "待存入文本",
                    position: { x: 200, y: 200 },
                    width: 320,
                    height: 240,
                    metadata: {
                        content: "这是待存入资产的文本正文",
                        status: "success",
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

    const env = await setupM11Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("存资产测试工程").first().click();
    const textNode = canvas.locator('[data-node-id="target-text-node"]');
    await expect(textNode).toBeVisible({ timeout: 5000 });

    // 选中/点击该文本节点唤起浮动工具栏
    await textNode.click();

    // 找到并点击浮动工具栏上的存入资产按钮（aria-label 为 "加入我的资产"，显示文字为 "存资产"）
    const saveAssetBtn = canvas.locator(".z-\\[70\\]").getByRole("button", { name: /存.*资产|加入我的资产/ }).first();
    await expect(saveAssetBtn).toBeVisible({ timeout: 5000 });
    await saveAssetBtn.click();
    await page.waitForTimeout(1000);
    console.log("CREATED PAYLOADS COUNT:", env.getCreatedPayloads().length);

    // 验证成功提示出现
    await expect(canvas.getByText(/已加入我的资产/)).toBeVisible({ timeout: 5000 });

    // 验证网络载荷中确切包含 tags: ["画布"]、标题及文本内容
    const payloads = env.getCreatedPayloads();
    expect(payloads.length).toBe(1);
    expect(payloads[0].asset_type).toBe("text");
    expect(payloads[0].tags).toEqual(["画布"]);
    expect(payloads[0].content).toBe("这是待存入资产的文本正文");
    expect(payloads[0].title).toBe("待存入文本");
});

test("M11 侧边栏资产列表呈现、防抖搜索过滤、标签过滤与一键派生 Text 节点致脏", async ({ page }) => {
    const initialProject = {
        id: "proj-m11-sidebar-1",
        user_id: 910,
        title: "资产侧边栏测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "existing-node-1",
                    type: "text",
                    title: "已有节点",
                    position: { x: 100, y: 100 },
                    width: 300,
                    height: 200,
                    metadata: { content: "原有文本", status: "success" },
                },
            ],
            connections: [],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    await setupM11Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("资产侧边栏测试工程").first().click();
    await expect(canvas.locator('[data-node-id="existing-node-1"]')).toBeVisible({ timeout: 5000 });

    // 1. 切换到“资产”Tab
    const assetsTabBtn = canvas.getByRole("button", { name: "资产" }).first();
    await expect(assetsTabBtn).toBeVisible({ timeout: 5000 });
    await assetsTabBtn.click();

    // 2. 验证服务端数字资产列表渲染
    await expect(canvas.getByText("赛博朋克文本").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("江南水乡画作").first()).toBeVisible({ timeout: 5000 });

    // 3. 验证 300ms 防抖搜索
    const searchInput = canvas.getByPlaceholder("搜索资产");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("水乡");
    await expect(canvas.getByText("江南水乡画作").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("赛博朋克文本")).toHaveCount(0);

    // 清空搜索框恢复全部
    await searchInput.fill("");
    await expect(canvas.getByText("赛博朋克文本").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("江南水乡画作").first()).toBeVisible({ timeout: 5000 });

    // 4. 验证标签 Pill 过滤
    const tagPill = canvas.locator(".prompt-filter-tag").filter({ hasText: "人物" }).first();
    await tagPill.click();
    await expect(canvas.getByText("赛博朋克文本").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("江南水乡画作")).toHaveCount(0);

    // 点击“全部”重置标签过滤
    await canvas.locator(".prompt-filter-tag").filter({ hasText: "全部" }).first().click();
    await expect(canvas.getByText("江南水乡画作").first()).toBeVisible({ timeout: 5000 });

    // 5. 点击卡片上的“+”按钮插入文本节点到画布
    const targetCard = canvas.locator(".group").filter({ hasText: "江南水乡画作" }).first();
    await targetCard.hover();
    const insertBtn = targetCard.locator('button[aria-label="插入画布"]').first();
    await expect(insertBtn).toBeVisible({ timeout: 5000 });
    await insertBtn.click();

    // 验证画布上生成了新的文本节点
    const derivedTextNode = canvas.locator("[data-node-id]").filter({ hasText: "烟雨江南水墨群山风景描写" });
    await expect(derivedTextNode).toBeVisible({ timeout: 5000 });

    // 验证画布被标记为脏态（未保存）
    await expect(canvas.getByText("未保存").first()).toBeVisible({ timeout: 5000 });
});

test("M11 卡片删除资产调用 DELETE 路由并触发列表刷新", async ({ page }) => {
    const initialProject = {
        id: "proj-m11-delete-1",
        user_id: 910,
        title: "资产删除测试工程",
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

    const env = await setupM11Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("资产删除测试工程").first().click();

    // 切换到“资产”Tab
    const assetsTabBtn = canvas.getByRole("button", { name: "资产" }).first();
    await assetsTabBtn.click();
    await expect(canvas.getByText("江南水乡画作").first()).toBeVisible({ timeout: 5000 });

    // Hover 目标卡片并点击删除按钮（垃圾桶图标）
    const targetCard = canvas.locator(".group").filter({ hasText: "江南水乡画作" }).first();
    await targetCard.hover();
    const deleteBtn = targetCard.locator('button[aria-label="移除资产"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // 在气泡确认框中点击“移除”
    const popover = canvas.locator(".ant-popconfirm, .ant-popover");
    await expect(popover).toBeVisible({ timeout: 5000 });
    const confirmBtn = popover.getByRole("button", { name: /移\s*除/ }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // 验证发起 DELETE /api/digital-assets/202
    expect(env.getDeletedIds()).toContain(202);

    // 验证提示与列表自动刷新（“江南水乡画作”不再存在）
    await expect(canvas.getByText("资产已移除").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("江南水乡画作")).toHaveCount(0, { timeout: 5000 });
});

test("M11 切换到不同用户时数字资产列表隔离为空", async ({ page }) => {
    const initialProject = {
        id: "proj-m11-user-iso",
        user_id: 999,
        title: "多用户隔离工程",
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

    // 使用不同用户 ID（999）
    await setupM11Env(page, [initialProject], {
        user: { id: 999, username: "canvas-guest", role: 100, group: "default" },
    });
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("多用户隔离工程").first().click();

    // 切换到“资产”Tab
    const assetsTabBtn = canvas.getByRole("button", { name: "资产" }).first();
    await assetsTabBtn.click();

    // 验证没有渲染任何前一用户的资产，显示“暂无资产”
    await expect(canvas.getByText("暂无资产").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("赛博朋克文本")).toHaveCount(0);
    await expect(canvas.getByText("江南水乡画作")).toHaveCount(0);
});
