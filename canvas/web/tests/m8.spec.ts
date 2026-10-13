import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

async function setupM8Env(page: Page, initialProjects: any[] = []) {
    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 908, username: "canvas-m8", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-m8-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m8-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-image-2"] : user } });
        }
    });

    // 模拟公开 S3 图片的静态拉取
    await page.route("https://s3.example.test/images/**", async (route) => {
        const url = route.request().url();
        if (url.includes("fail-load")) {
            await route.fulfill({ status: 500, body: "Error" });
        } else {
            await route.fulfill({
                status: 200,
                contentType: "image/png",
                body: pngBuffer,
            });
        }
    });

    return projectApi;
}

test("M8 连接参考图出图派生新节点，持有独立云端 UUID 且原图不受修改", async ({ page }) => {
    let editRequests = 0;
    let uploadRequests = 0;
    let requestSize = "";

    await page.route("**/api/images", async (route) => {
        if (route.request().method() === "POST") uploadRequests++;
        await route.continue();
    });

    const refImageUrl = "https://s3.example.test/images/908/ref-uuid-1111.png";
    const editedImageUrl = "https://s3.example.test/images/908/m8-edited-uuid-8888.png";

    await page.route("**/api/canvas/images/edits", async (route) => {
        editRequests++;
        expect(route.request().headers().authorization).toBe("Bearer canvas-m8-session");
        expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
        const postData = route.request().postData() || "";
        expect(postData).toContain("gpt-image-2");
        expect(postData).toContain("赛博朋克重绘");
        expect(postData).toContain("auto 1k");

        await route.fulfill({
            json: {
                success: true,
                data: [
                    {
                        id: "m8-edited-uuid-8888",
                        url: editedImageUrl,
                        width: 800,
                        height: 600,
                        bytes: 2048,
                        mime_type: "image/png",
                    },
                ],
            },
        });
    });

    const initialProject = {
        id: "proj-m8-edit-1",
        user_id: 908,
        title: "图生图闭环测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "ref-node-1",
                    type: "image",
                    title: "原始参考图",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: refImageUrl,
                        storageKey: "ref-uuid-1111",
                        status: "success",
                        naturalWidth: 800,
                        naturalHeight: 600,
                    },
                },
                {
                    id: "target-node-1",
                    type: "image",
                    title: "派生目标节点",
                    position: { x: 550, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {},
                },
            ],
            connections: [
                {
                    id: "conn-1",
                    fromNodeId: "ref-node-1",
                    toNodeId: "target-node-1",
                },
            ],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    const projectApi = await setupM8Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("图生图闭环测试").first().click();
    await expect(canvas.getByText("原始参考图")).toBeVisible();

    // 选中目标节点并输入提示词发起编辑生成
    const targetNode = canvas.locator('[data-node-id="target-node-1"]');
    await targetNode.click();
    const promptInput = canvas.locator('[contenteditable="true"]');
    await expect(promptInput).toBeVisible({ timeout: 5000 });
    await promptInput.fill("赛博朋克重绘");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();

    // 验证触发编辑接口
    await expect.poll(() => editRequests).toBe(1);

    // 验证新出图渲染
    const editedImg = canvas.locator(`img[src="${editedImageUrl}"]`).first();
    await expect(editedImg).toBeVisible({ timeout: 10_000 });

    // 验证原图完好无损
    const refImg = canvas.locator(`img[src="${refImageUrl}"]`).first();
    await expect(refImg).toBeVisible();

    // 验证零二次上传
    expect(uploadRequests).toBe(0);

    // 验证自动持久化元数据持有 UUID 快照与 edit 类型
    await expect
        .poll(() => {
            const saved = projectApi.getProjects().find((p) => p.id === "proj-m8-edit-1");
            if (!saved) return false;
            try {
                const parsed = JSON.parse(saved.content);
                const target = parsed.nodes.find((n: any) => n.id === "target-node-1");
                return target?.metadata?.generationType === "edit" && target?.metadata?.storageKey === "m8-edited-uuid-8888" && Array.isArray(target?.metadata?.references) && target?.metadata?.references.includes("ref-uuid-1111");
            } catch {
                return false;
            }
        })
        .toBe(true);

    // 验证页面刷新重载后工程完整还原拓扑、图像与节点身份
    await page.reload();
    const reloadedCanvas = page.frameLocator('iframe[title="Infinite Canvas"]');
    await reloadedCanvas.getByText("图生图闭环测试").first().click();
    await expect(reloadedCanvas.locator(`img[src="${refImageUrl}"]`).first()).toBeVisible({ timeout: 10_000 });
    await expect(reloadedCanvas.locator(`img[src="${editedImageUrl}"]`).first()).toBeVisible({ timeout: 10_000 });
});

test("M8 超过 3 张参考图在前端发送前立即阻断并友好提示", async ({ page }) => {
    let editRequests = 0;
    await page.route("**/api/canvas/images/edits", async (route) => {
        editRequests++;
        await route.continue();
    });

    const initialProject = {
        id: "proj-m8-max-1",
        user_id: 908,
        title: "超限参考图测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                { id: "ref-1", type: "image", title: "图1", position: { x: 50, y: 50 }, width: 100, height: 100, metadata: { content: "https://s3.example.test/images/908/r1.png", storageKey: "r1", status: "success" } },
                { id: "ref-2", type: "image", title: "图2", position: { x: 160, y: 50 }, width: 100, height: 100, metadata: { content: "https://s3.example.test/images/908/r2.png", storageKey: "r2", status: "success" } },
                { id: "ref-3", type: "image", title: "图3", position: { x: 270, y: 50 }, width: 100, height: 100, metadata: { content: "https://s3.example.test/images/908/r3.png", storageKey: "r3", status: "success" } },
                { id: "ref-4", type: "image", title: "图4", position: { x: 380, y: 50 }, width: 100, height: 100, metadata: { content: "https://s3.example.test/images/908/r4.png", storageKey: "r4", status: "success" } },
                { id: "target-4refs", type: "image", title: "目标节点", position: { x: 550, y: 50 }, width: 340, height: 240, metadata: {} },
            ],
            connections: [
                { id: "c1", fromNodeId: "ref-1", toNodeId: "target-4refs" },
                { id: "c2", fromNodeId: "ref-2", toNodeId: "target-4refs" },
                { id: "c3", fromNodeId: "ref-3", toNodeId: "target-4refs" },
                { id: "c4", fromNodeId: "ref-4", toNodeId: "target-4refs" },
            ],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    await setupM8Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("超限参考图测试").first().click();
    const targetNode = canvas.locator('[data-node-id="target-4refs"]');
    await targetNode.click();

    const promptInput = canvas.locator('[contenteditable="true"]');
    await expect(promptInput).toBeVisible({ timeout: 5000 });
    await promptInput.fill("融合成新图");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();

    // 验证前端弹出阻断提示，且不调用出图接口
    await expect(canvas.getByText(/请重新设置：参考图/).first()).toBeVisible({ timeout: 5000 });
    expect(editRequests).toBe(0);
});

test("M8 参考图读取失败时严格阻断，不降级为文生图", async ({ page }) => {
    let editRequests = 0;
    let genRequests = 0;

    await page.route("**/api/canvas/images/edits", async (route) => {
        editRequests++;
        await route.continue();
    });
    await page.route("**/api/canvas/images/generations", async (route) => {
        genRequests++;
        await route.continue();
    });

    const brokenImageUrl = "https://s3.example.test/images/908/fail-load-image.png";

    const initialProject = {
        id: "proj-m8-fail-1",
        user_id: 908,
        title: "拉取失败测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "ref-node-bad",
                    type: "image",
                    title: "损坏参考图",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: brokenImageUrl,
                        storageKey: "broken-uuid",
                        status: "success",
                    },
                },
                {
                    id: "target-node-bad",
                    type: "image",
                    title: "目标节点",
                    position: { x: 550, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {},
                },
            ],
            connections: [
                {
                    id: "conn-bad",
                    fromNodeId: "ref-node-bad",
                    toNodeId: "target-node-bad",
                },
            ],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    await setupM8Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("拉取失败测试").first().click();
    const targetNode = canvas.locator('[data-node-id="target-node-bad"]');
    await targetNode.click();
    const promptInput = canvas.locator('[contenteditable="true"]');
    await expect(promptInput).toBeVisible({ timeout: 5000 });
    await promptInput.fill("尝试生成");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();

    // 弹出错误提示且不向后端发出任何出图请求
    await expect(canvas.getByText("参考图读取失败，请换一张图片或重新上传").first()).toBeVisible({ timeout: 5000 });
    expect(editRequests).toBe(0);
    expect(genRequests).toBe(0);
});

test("M8 历史编辑节点在参考图被删除后重试明确提示参考图缺失", async ({ page }) => {
    let editRequests = 0;
    let genRequests = 0;

    await page.route("**/api/canvas/images/edits", async (route) => {
        editRequests++;
        await route.continue();
    });
    await page.route("**/api/canvas/images/generations", async (route) => {
        genRequests++;
        await route.continue();
    });

    const initialProject = {
        id: "proj-m8-retry-1",
        user_id: 908,
        title: "缺失重试测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "edit-node-alone",
                    type: "image",
                    title: "孤立编辑节点",
                    position: { x: 300, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: "",
                        status: "error",
                        errorDetails: "上游错误",
                        prompt: "历史提示词",
                        generationType: "edit",
                        references: ["deleted-uuid-999"],
                        images: [{ id: "img-err", content: "", status: "error", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }],
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

    await setupM8Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("缺失重试测试").first().click();

    // 点击重试按钮
    const retryBtn = canvas.getByRole("button", { name: "重试", exact: true }).first();
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // 验证提示参考图片已丢失，不产生网络请求
    await expect(canvas.getByText("参考图片已丢失，无法继续重试").first()).toBeVisible({ timeout: 5000 });
    expect(editRequests).toBe(0);
    expect(genRequests).toBe(0);
});
