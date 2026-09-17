import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

async function setupIssue35Env(page: Page, initialProjects: any[] = []) {
    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 935, username: "canvas-issue-35", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-35-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "35-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-5.6-terra", "gpt-image-2", "minimax_h3_zm_u24"] : user } });
        }
    });

    await page.route("https://s3.example.test/images/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: pngBuffer,
        });
    });

    return projectApi;
}

test("Issue #35 - 多图卡片展开布局防文字挤压截断与子卡片独立操作", async ({ page }) => {
    const initialProject = {
        id: "proj-batch-1",
        user_id: 935,
        title: "多图测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "batch-image-node",
                    type: "image",
                    title: "批量图片 1",
                    position: { x: 200, y: 150 },
                    width: 240,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/img-1.png",
                        primaryImageId: "img-1",
                        images: [
                            { id: "img-1", content: "https://s3.example.test/images/img-1.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
                            { id: "img-2", content: "https://s3.example.test/images/img-2.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
                            { id: "img-3", content: "https://s3.example.test/images/img-3.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
                            { id: "img-4", content: "https://s3.example.test/images/img-4.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
                        ],
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

    await setupIssue35Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("多图测试工程").first().click();
    const batchNode = canvas.locator('[data-node-id="batch-image-node"]');
    await expect(batchNode).toBeVisible({ timeout: 5000 });

    // 点击图片展开多图
    const expandBtn = batchNode.getByRole("button", { name: /展开|图片组已收起|4/ }).first();
    if (await expandBtn.isVisible()) {
        await expandBtn.click();
    } else {
        await batchNode.click();
        const toggleBtn = batchNode.locator("button").filter({ hasText: /4/ }).first();
        if (await toggleBtn.isVisible()) await toggleBtn.click();
    }

    // 验证子卡片顶栏按钮存在
    const copyBtns = canvas.locator('button[title="创建副本"]');
    const primaryBtns = canvas.locator('button[title="设为主图"]');
    const downloadBtns = canvas.locator('button[title="下载"]');

    await expect(copyBtns.first()).toBeVisible({ timeout: 5000 });
    await expect(primaryBtns.first()).toBeVisible();
    await expect(downloadBtns.first()).toBeVisible();

    // 在 240px 窄尺寸下，子卡片内不应包含 truncate 类或挤压截断的标签
    const childCard = copyBtns.first().locator("xpath=ancestor::div[contains(@class, 'rounded-3xl')]");
    await expect(childCard.locator(".truncate")).toHaveCount(0);

    // 测试创建副本
    const initialNodeCount = await canvas.locator("[data-node-id]").count();
    await copyBtns.first().click();
    await expect.poll(async () => canvas.locator("[data-node-id]").count(), { timeout: 5000 }).toBeGreaterThan(initialNodeCount);
});

test("Issue #35 - 参考图栏加号按钮与交互式连线选图闭环", async ({ page }) => {
    const initialProject = {
        id: "proj-ref-1",
        user_id: 935,
        title: "参考图连线测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "source-image-node",
                    type: "image",
                    title: "源图片节点",
                    position: { x: 100, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/source.png",
                    },
                },
                {
                    id: "target-image-node",
                    type: "image",
                    title: "目标图片节点",
                    position: { x: 600, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "idle",
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

    await setupIssue35Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("参考图连线测试工程").first().click();
    const targetNode = canvas.locator('[data-node-id="target-image-node"]');
    await expect(targetNode).toBeVisible({ timeout: 5000 });

    // 选中目标节点唤起输入/提示词面板
    await targetNode.click();

    // 验证参考栏中的加号按钮存在
    const addRefBtn = canvas.locator('button[title="从画布选择参考节点"]');
    await expect(addRefBtn).toBeVisible({ timeout: 5000 });

    // 点击加号按钮进入连线选图模式
    await addRefBtn.click();

    // 验证顶部提示横条出现
    const hintBanner = canvas.getByRole("button", { name: /从画布选择参考/ });
    await expect(hintBanner).toBeVisible({ timeout: 5000 });

    // 点击源图片节点以建立连线
    const sourceNode = canvas.locator('[data-node-id="source-image-node"]');
    await sourceNode.click();

    // 验证源图片节点已成功作为参考图接入
    await expect(canvas.locator('[title="断开参考连接"]')).toBeVisible({ timeout: 5000 });
});

test("Issue #35 - 连线拖拽创建快捷菜单选项与下游节点生成", async ({ page }) => {
    const initialProject = {
        id: "proj-drag-1",
        user_id: 935,
        title: "连线拖拽测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "source-node-drag",
                    type: "image",
                    title: "拖拽源节点",
                    position: { x: 150, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/source.png",
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

    await setupIssue35Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("连线拖拽测试工程").first().click();
    const sourceNode = canvas.locator('[data-node-id="source-node-drag"]');
    await expect(sourceNode).toBeVisible({ timeout: 5000 });

    // 选中源节点，展示连接桩
    await sourceNode.click();
    const rightHandle = sourceNode.locator(".cursor-crosshair").last();
    await expect(rightHandle).toBeVisible({ timeout: 5000 });

    // 获取连接桩位置并向右侧空白处拖拽释放
    const handleBox = await rightHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (handleBox) {
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + 260, handleBox.y + 120);
        await page.mouse.up();
    }

    // 连线创建菜单弹出
    const menu = canvas.locator("[data-connection-create-menu]");
    await expect(menu).toBeVisible({ timeout: 5000 });

    // 验证菜单项对齐：包含文本、图片、视频、配置与音频参考
    await expect(menu.getByText("文本生成")).toBeVisible();
    await expect(menu.getByText("图片生成")).toBeVisible();
    await expect(menu.getByText("视频生成")).toBeVisible();
    await expect(menu.getByText("配置节点")).toBeVisible();
    await expect(menu.getByText("音频参考")).toBeVisible();

    // 点击视频生成，生成下游连接的视频节点
    await menu.getByText("视频生成").click();

    // 验证下游新节点创建成功（节点数量从 1 变为 2）
    await expect.poll(async () => canvas.locator("[data-node-id]").count(), { timeout: 5000 }).toBe(2);
});
