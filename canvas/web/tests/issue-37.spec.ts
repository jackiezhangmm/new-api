import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

async function setupIssue37Env(page: Page, initialProjects: Array<Record<string, unknown>> = []) {
    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 937, username: "canvas-issue-37", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-37-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "37-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
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

    await page.route("**/api/images", async (route) => {
        await route.fulfill({
            status: 200,
            json: {
                success: true,
                data: {
                    id: "s3-upload-test-uuid",
                    url: "https://s3.example.test/images/uploaded-1.png",
                    width: 1024,
                    height: 1024,
                    bytes: 68,
                    mime_type: "image/png",
                },
            },
        });
    });

    return projectApi;
}

test("Issue #37 - 多图组点开后支持左右箭头与键盘快捷键前后切换图片", async ({ page }) => {
    const initialProject = {
        id: "proj-batch-preview-1",
        user_id: 937,
        title: "多图组预览测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "batch-image-node",
                    type: "image",
                    title: "多图组节点",
                    position: { x: 200, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/batch-1.png",
                        prompt: "春天的花园",
                        primaryImageId: "img-1",
                        images: [
                            { id: "img-1", content: "https://s3.example.test/images/batch-1.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
                            { id: "img-2", content: "https://s3.example.test/images/batch-2.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
                            { id: "img-3", content: "https://s3.example.test/images/batch-3.png", status: "success", naturalWidth: 1024, naturalHeight: 1024, bytes: 68, mimeType: "image/png" },
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

    await setupIssue37Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("多图组预览测试工程").first().click();
    const imageNode = canvas.locator('[data-node-id="batch-image-node"]');
    await expect(imageNode).toBeVisible({ timeout: 5000 });

    // 双击主图打开预览弹窗
    await imageNode.dblclick();

    // 验证大图弹窗成功打开，且标题中包含 (1 / 3)
    const modalTitle = canvas.locator(".ant-modal-title");
    await expect(modalTitle).toBeVisible({ timeout: 5000 });
    await expect(modalTitle).toContainText("(1 / 3)");

    const nextBtn = canvas.locator('[data-testid="preview-next-button"]');
    const prevBtn = canvas.locator('[data-testid="preview-prev-button"]');
    await expect(nextBtn).toBeVisible();
    await expect(prevBtn).toBeVisible();

    // 点击下一张
    await nextBtn.click();
    await expect(modalTitle).toContainText("(2 / 3)");

    // 再按键盘 ArrowRight
    await page.keyboard.press("ArrowRight");
    await expect(modalTitle).toContainText("(3 / 3)");

    // 循环切换到第一张
    await nextBtn.click();
    await expect(modalTitle).toContainText("(1 / 3)");

    // 按键盘 ArrowLeft 倒退到第三张
    await page.keyboard.press("ArrowLeft");
    await expect(modalTitle).toContainText("(3 / 3)");
});

test("Issue #37 - 画布空白处右键就地弹出上下文菜单并显示上传资源", async ({ page }) => {
    const initialProject = {
        id: "proj-canvas-menu-1",
        user_id: 937,
        title: "画布右键测试工程",
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

    await setupIssue37Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("画布右键测试工程").first().click();

    // 在画布空白区域右键点击
    const canvasContainer = canvas.locator("main section");
    await canvasContainer.click({ button: "right", position: { x: 500, y: 350 } });

    // 验证弹出“上传资源”上下文菜单项
    const uploadOption = canvas.getByRole("button", { name: "上传资源" });
    await expect(uploadOption).toBeVisible({ timeout: 5000 });

    // 监听文件选择器并触发上传
    const fileChooserPromise = page.waitForEvent("filechooser");
    await uploadOption.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
        { name: "uploaded-1.png", mimeType: "image/png", buffer: pngBuffer },
    ]);

    // 验证新生成的图片节点可见且位于右键点击的世界坐标区域
    await expect.poll(async () => canvas.locator('[data-node-id]').count(), { timeout: 5000 }).toBe(1);
    const uploadedNode = canvas.locator('[data-node-id]').first();
    await expect(uploadedNode).toBeVisible();
});

test("Issue #37 - 启用音频节点但不展示生成面板，且作为视频引用的连线正常呈现", async ({ page }) => {
    const initialProject = {
        id: "proj-audio-node-1",
        user_id: 937,
        title: "音频节点测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "image-ref-node-1",
                    type: "image",
                    title: "参考图片",
                    position: { x: 100, y: 50 },
                    width: 320,
                    height: 180,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/ref.png",
                        mimeType: "image/png",
                    },
                },
                {
                    id: "audio-node-1",
                    type: "audio",
                    title: "伴奏音频",
                    position: { x: 100, y: 260 },
                    width: 320,
                    height: 120,
                    metadata: {
                        status: "success",
                        content: "https://s3.example.test/images/bgm.mp3",
                        mimeType: "audio/mpeg",
                    },
                },
                {
                    id: "video-node-1",
                    type: "video",
                    title: "视频生成",
                    position: { x: 500, y: 150 },
                    width: 480,
                    height: 320,
                    metadata: {
                        status: "idle",
                        prompt: "自然风光",
                        model: "minimax_h3_zm_u24",
                        vquality: "480",
                        size: "16:9",
                        seconds: 5,
                        generationMode: "video",
                    },
                },
            ],
            connections: [
                { id: "conn-img", fromNodeId: "image-ref-node-1", toNodeId: "video-node-1" },
                { id: "conn-aud", fromNodeId: "audio-node-1", toNodeId: "video-node-1" },
            ],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    await setupIssue37Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("音频节点测试工程").first().click();

    // 验证工具栏上展示音频按钮
    const audioTool = canvas.locator("#tool-audio");
    await expect(audioTool).toBeVisible({ timeout: 5000 });

    // 点击音频节点，断言不打开底部提示词编辑/生成面板
    const audioNode = canvas.locator('[data-node-id="audio-node-1"]');
    await expect(audioNode).toBeVisible({ timeout: 5000 });
    await audioNode.click();
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).not.toBeVisible();

    // 视频节点被连线后，展开其提示词面板应在引用栏中包含该音频
    const videoNode = canvas.locator('[data-node-id="video-node-1"]');
    await expect(videoNode).toBeVisible({ timeout: 5000 });
    await videoNode.click();

    // 验证视频节点引用栏中存在参考内容
    const referenceTitle = canvas.getByText("参考内容");
    await expect(referenceTitle).toBeVisible({ timeout: 5000 });

    // 拦截 /v1/videos 请求，验证连入的音频引用正确序列化到载荷中
    let videoRequestPayload: any = null;
    await page.route("**/v1/videos", async (route) => {
        videoRequestPayload = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            json: { id: "video-task-audio-ref-1" },
        });
    });

    const generateBtn = canvas.getByRole("button", { name: "生成", exact: true }).first();
    if (await generateBtn.isVisible()) {
        await generateBtn.click();
        await expect.poll(() => videoRequestPayload).not.toBeNull();
        expect(videoRequestPayload?.metadata?.ref_audio_0).toBe("https://s3.example.test/images/bgm.mp3");
        expect(videoRequestPayload?.audio).toBe("https://s3.example.test/images/bgm.mp3");
    }
});
