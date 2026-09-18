import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

async function setupIssue36Env(page: Page, initialProjects: Array<Record<string, unknown>> = []) {
    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 936, username: "canvas-issue-36", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-36-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "36-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
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

test("Issue #36 - 已有图像节点点击展开提示词面板并预填原提示词", async ({ page }) => {
    const initialProject = {
        id: "proj-prompt-panel-1",
        user_id: 936,
        title: "提示词面板测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "existing-image-node",
                    type: "image",
                    title: "已有图片",
                    position: { x: 200, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/existing.png",
                        prompt: "一只可爱的橘猫",
                        primaryImageId: "img-1",
                        images: [
                            { id: "img-1", content: "https://s3.example.test/images/existing.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
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

    await setupIssue36Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("提示词面板测试工程").first().click();
    const imageNode = canvas.locator('[data-node-id="existing-image-node"]');
    await expect(imageNode).toBeVisible({ timeout: 5000 });

    // 点击已有图片节点，验证下方提示词面板成功弹出且预填原提示词
    await imageNode.click();
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).toBeVisible({ timeout: 5000 });
    await expect(chipInput).toHaveText("一只可爱的橘猫");
});

test("Issue #36 - 已有图像节点重新生成原地覆写且不派生新节点", async ({ page }) => {
    let generationCalled = false;
    let editCalled = false;
    let requestPayload: { prompt?: string } | null = null;

    await page.route("**/v1/images/generations", async (route) => {
        generationCalled = true;
        requestPayload = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            json: {
                data: [
                    {
                        url: "https://s3.example.test/images/regenerated-cat.png",
                        b64_json: pngBase64,
                    },
                ],
            },
        });
    });

    await page.route("**/api/canvas/images/edits", async (route) => {
        editCalled = true;
        await route.fulfill({ status: 500 });
    });

    await page.route("**/api/images", async (route) => {
        await route.fulfill({
            status: 200,
            json: {
                success: true,
                data: {
                    id: "s3-regen-cat-uuid",
                    url: "https://s3.example.test/images/regenerated-cat.png",
                    width: 1024,
                    height: 1024,
                    bytes: 68,
                    mime_type: "image/png",
                },
            },
        });
    });

    const initialProject = {
        id: "proj-regen-1",
        user_id: 936,
        title: "原位重生成测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "existing-cat-node",
                    type: "image",
                    title: "橘猫图片",
                    position: { x: 200, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/existing.png",
                        prompt: "一只可爱的橘猫",
                        model: "gpt-image-2",
                        resolution: "1k",
                        aspectRatio: "1:1",
                        quality: "",
                        count: "1",
                        generationMode: "image",
                        primaryImageId: "img-orig",
                        images: [
                            { id: "img-orig", content: "https://s3.example.test/images/existing.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
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

    await setupIssue36Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("原位重生成测试工程").first().click();
    const imageNode = canvas.locator('[data-node-id="existing-cat-node"]');
    await expect(imageNode).toBeVisible({ timeout: 5000 });

    // 选中图片节点唤起提示词面板
    await imageNode.click();
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).toBeVisible({ timeout: 5000 });

    // 修改提示词
    await chipInput.fill("一只赛博朋克黑猫");

    // 点击生成
    const generateBtn = canvas.getByRole("button", { name: "生成", exact: true }).first();
    await generateBtn.click();

    // 验证调用的是纯文生图端点而非参考图编辑端点（没有连线时不隐式携带旧图作为参考图）
    await expect.poll(() => generationCalled).toBe(true);
    expect(editCalled).toBe(false);
    expect(requestPayload?.prompt).toBe("一只赛博朋克黑猫");

    // 验证新图片成功加载展现
    const newImg = canvas.locator('img[src="https://s3.example.test/images/regenerated-cat.png"]').first();
    await expect(newImg).toBeVisible({ timeout: 10_000 });

    // 验证节点总数仍然为 1（原地覆写，绝不派生新节点）
    await expect(canvas.locator("[data-node-id]")).toHaveCount(1);
});

test("Issue #36 - 视频节点点击悬浮工具栏编辑按钮正常展开提示词面板", async ({ page }) => {
    const initialProject = {
        id: "proj-video-panel-1",
        user_id: 936,
        title: "视频编辑面板工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "existing-video-node",
                    type: "video",
                    title: "已有视频",
                    position: { x: 200, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://example.com/video.mp4",
                        prompt: "无人机掠过雪山",
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

    await setupIssue36Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("视频编辑面板工程").first().click();
    const videoNode = canvas.locator('[data-node-id="existing-video-node"]');
    await expect(videoNode).toBeVisible({ timeout: 5000 });

    // 选中视频节点并悬浮，点击工具栏中的“编辑”按钮
    await videoNode.click();
    const editBtn = canvas.getByRole("button", { name: "编辑" }).first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // 验证底部成功展开提示词面板且填入提示词
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).toBeVisible({ timeout: 5000 });
    await expect(chipInput).toHaveText("无人机掠过雪山");
});

test("Issue #36 - 已有图像节点重新生成失败进入标准错误态并支持重试", async ({ page }) => {
    let callCount = 0;

    await page.route("**/v1/images/generations", async (route) => {
        callCount++;
        if (callCount === 1) {
            await route.fulfill({
                status: 500,
                json: {
                    error: { message: "上游服务限流" },
                },
            });
        } else {
            await route.fulfill({
                status: 200,
                json: {
                    data: [
                        {
                            url: "https://s3.example.test/images/retry-success.png",
                            b64_json: pngBase64,
                        },
                    ],
                },
            });
        }
    });

    await page.route("**/api/images", async (route) => {
        await route.fulfill({
            status: 200,
            json: {
                success: true,
                data: {
                    id: "retry-success-uuid",
                    url: "https://s3.example.test/images/retry-success.png",
                    width: 1024,
                    height: 1024,
                    bytes: 68,
                    mime_type: "image/png",
                },
            },
        });
    });

    const initialProject = {
        id: "proj-retry-fail-1",
        user_id: 936,
        title: "错误重试测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "retry-image-node",
                    type: "image",
                    title: "测试图片",
                    position: { x: 200, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/existing.png",
                        prompt: "原始提示词",
                        model: "gpt-image-2",
                        resolution: "1k",
                        aspectRatio: "1:1",
                        quality: "",
                        count: "1",
                        generationMode: "image",
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

    await setupIssue36Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("错误重试测试工程").first().click();
    const imageNode = canvas.locator('[data-node-id="retry-image-node"]');
    await expect(imageNode).toBeVisible({ timeout: 5000 });

    await imageNode.click();
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).toBeVisible({ timeout: 5000 });
    await chipInput.fill("需要重试的新提示词");

    const generateBtn = canvas.getByRole("button", { name: "生成", exact: true }).first();
    await generateBtn.click();

    // 验证失败后节点原地进入错误态并展示重试按钮
    const retryBtn = imageNode.getByRole("button", { name: "重试" });
    await expect(retryBtn).toBeVisible({ timeout: 10000 });

    // 点击重试，第 2 次请求成功返回
    await retryBtn.click();
    const newImg = canvas.locator('img[src="https://s3.example.test/images/retry-success.png"]').first();
    await expect(newImg).toBeVisible({ timeout: 10000 });
});
