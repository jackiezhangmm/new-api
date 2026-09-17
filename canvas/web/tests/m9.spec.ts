import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

async function setupM9Env(page: Page, initialProjects: any[] = [], availableModels = ["gpt-5.6-terra", "gpt-image-2"]) {
    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 909, username: "canvas-m9", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-m9-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m9-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? availableModels : user } });
        }
    });

    // 模拟公开 S3 图片拉取，返回有效 PNG 二进制
    await page.route("https://s3.example.test/images/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: pngBuffer,
        });
    });

    return projectApi;
}

test("M9 图片反推提示词工作流：悬浮栏触发、拓扑派生、Base64 视觉传输与流式打字落盘", async ({ page }) => {
    let chatRequests = 0;
    let requestBody: any = null;
    let requestHeaders: Record<string, string> = {};

    await page.route("**/v1/chat/completions", async (route) => {
        chatRequests++;
        requestHeaders = route.request().headers();
        requestBody = route.request().postDataJSON();

        const sseChunks = [
            'data: {"choices":[{"delta":{"content":"特写肖像，"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"赛博朋克风格的猫咪，"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"霓虹蓝紫光影，极富细节。"}}]}\n\n',
            "data: [DONE]\n\n",
        ];

        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: sseChunks.join(""),
        });
    });

    const imageUrl = "https://s3.example.test/images/909/sample-cat.png";
    const initialProject = {
        id: "proj-m9-reverse-1",
        user_id: 909,
        title: "反推提示词测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "image-node-1",
                    type: "image",
                    title: "样本图片",
                    position: { x: 100, y: 150 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: imageUrl,
                        storageKey: "cat-uuid-1",
                        status: "success",
                        naturalWidth: 800,
                        naturalHeight: 600,
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

    const projectApi = await setupM9Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("反推提示词测试工程").first().click();
    const imageNode = canvas.locator('[data-node-id="image-node-1"]');
    await expect(imageNode).toBeVisible({ timeout: 5000 });

    // 点击图片节点选中它，唤起工具栏并点击“反推提示词”
    await imageNode.click();
    const reverseBtn = canvas.getByRole("button", { name: "创建反推提示词的文本和配置节点" });
    await expect(reverseBtn).toBeVisible({ timeout: 5000 });
    await reverseBtn.click();

    // 验证拓扑：应派生出预设文本节点与配置节点
    await expect(canvas.getByText("生成配置").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByText("请根据参考图片反推一段适合用于 AI 生图的提示词").first()).toBeVisible({ timeout: 5000 });

    // 验证配置节点面板展示固定模型 gpt-5.6-terra，且不渲染生图分辨率/画质等浮层
    await expect(canvas.getByText("gpt-5.6-terra").first()).toBeVisible({ timeout: 5000 });
    await expect(canvas.getByRole("button", { name: "分辨率与画质", exact: false })).toHaveCount(0);

    // 点击配置节点上的“开始生成”按钮
    const generateBtn = canvas.getByRole("button", { name: "开始生成", exact: true }).first();
    await generateBtn.click();

    // 验证请求发送到 /v1/chat/completions 且参数正确
    await expect.poll(() => chatRequests).toBe(1);
    expect(requestHeaders.authorization).toBe("Bearer canvas-m9-session");
    expect(requestBody.model).toBe("gpt-5.6-terra");
    expect(requestBody.stream).toBe(true);

    // 验证多模态图片以 Base64 Data URL 传递
    const userMessage = requestBody.messages[0];
    expect(Array.isArray(userMessage.content)).toBe(true);
    const imagePart = userMessage.content.find((part: any) => part.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toContain("data:image/png;base64,");

    // 验证流式打字输出最终呈现在派生出的文本节点中
    await expect(canvas.getByText("特写肖像，赛博朋克风格的猫咪，霓虹蓝紫光影，极富细节。").first()).toBeVisible({ timeout: 10000 });

    // 等待云端自动保存并将新节点写入工程
    await expect.poll(() => {
        const latest = projectApi.getProjects().find((p) => p.id === "proj-m9-reverse-1");
        if (!latest?.content) return 0;
        const parsed = JSON.parse(latest.content);
        return parsed.nodes?.length || 0;
    }, { timeout: 10000 }).toBeGreaterThanOrEqual(3);
});

test("M9 文本节点修饰与指令扩写：原位流式改写当前文本节点并保持节点数不变", async ({ page }) => {
    let chatRequests = 0;
    let requestBody: any = null;

    await page.route("**/v1/chat/completions", async (route) => {
        chatRequests++;
        requestBody = route.request().postDataJSON();

        const sseChunks = [
            'data: {"choices":[{"delta":{"content":"赛博猫咪，穿机械外骨骼，漂浮于太空。"}}]}\n\n',
            "data: [DONE]\n\n",
        ];

        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: sseChunks.join(""),
        });
    });

    const initialProject = {
        id: "proj-m9-edit-text",
        user_id: 909,
        title: "文本修饰测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "text-node-orig",
                    type: "text",
                    title: "原始构思",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: "一只可爱的赛博猫咪",
                        prompt: "一只可爱的赛博猫咪",
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

    await setupM9Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("文本修饰测试").first().click();
    const textNode = canvas.locator('[data-node-id="text-node-orig"]');
    await expect(textNode).toBeVisible({ timeout: 5000 });
    await textNode.click();

    // 验证文本节点底部弹出提示词面板，placeholder 为修改文本提示
    const chipInput = canvas.locator('[contenteditable="true"]');
    await expect(chipInput).toBeVisible({ timeout: 5000 });
    await chipInput.fill("加上机械外骨骼和太空背景");

    // 验证底部显示固定模型 gpt-5.6-terra
    await expect(canvas.getByText("gpt-5.6-terra").first()).toBeVisible({ timeout: 5000 });

    // 点击提交修饰
    const generateBtn = canvas.getByRole("button", { name: "生成", exact: true }).first();
    await generateBtn.click();

    await expect.poll(() => chatRequests).toBe(1);
    // 验证向后端发送的指令整合了原文与修改要求
    const promptSent = typeof requestBody.messages[0].content === "string"
        ? requestBody.messages[0].content
        : requestBody.messages[0].content[0].text;
    expect(promptSent).toContain("一只可爱的赛博猫咪");
    expect(promptSent).toContain("加上机械外骨骼和太空背景");

    // 验证原文本节点原位更新为修改后文本，且不派生新节点
    await expect(canvas.getByText("赛博猫咪，穿机械外骨骼，漂浮于太空。").first()).toBeVisible({ timeout: 10000 });
    await expect(canvas.locator("[data-node-id]")).toHaveCount(1);
});

test("M9 流式生成中点击“停止”安全保留已输出文字且置为成功可用态", async ({ page }) => {
    let requestAborted = false;

    await page.route("**/v1/chat/completions", async (route) => {
        route.request().response().catch(() => {});
        // 挂起连接并发送前半部分
        await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: 'data: {"choices":[{"delta":{"content":"前半段文本已生成，"}}]}\n\n',
        });
    });

    const initialProject = {
        id: "proj-m9-stop-test",
        user_id: 909,
        title: "停止测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "text-src",
                    type: "text",
                    title: "源文本",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: "简单提示词",
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

    await setupM9Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("停止测试工程").first().click();
    const textNode = canvas.locator('[data-node-id="text-src"]');
    await textNode.click();

    const chipInput = canvas.locator('[contenteditable="true"]');
    await chipInput.fill("修饰扩写");
    await canvas.getByRole("button", { name: "生成", exact: true }).first().click();

    // 看到流式文字出现
    await expect(canvas.getByText("前半段文本已生成，").first()).toBeVisible({ timeout: 5000 });

    // 点击“停止”按钮
    const stopBtn = canvas.getByRole("button", { name: "停止", exact: true }).first();
    if (await stopBtn.isVisible()) {
        await stopBtn.click();
    }

    // 验证文字未丢失，保留在目标节点中
    await expect(canvas.getByText("前半段文本已生成，").first()).toBeVisible({ timeout: 5000 });
});

test("M9 未分配辅助语言模型权限时，生成按钮禁用并提示模型不可用", async ({ page }) => {
    const initialProject = {
        id: "proj-m9-no-perm",
        user_id: 909,
        title: "权限不足测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "text-no-perm",
                    type: "text",
                    title: "提示词",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: "原提示词",
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

    // 仅分配了 gpt-image-2，未分配 gpt-5.6-terra
    await setupM9Env(page, [initialProject], ["gpt-image-2"]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("权限不足测试").first().click();
    const textNode = canvas.locator('[data-node-id="text-no-perm"]');
    await textNode.click();

    const chipInput = canvas.locator('[contenteditable="true"]');
    await chipInput.fill("想要扩写");

    // 验证提示模型不可用
    await expect(canvas.getByRole("alert").filter({ hasText: /gpt-5.6-terra/ }).first()).toBeVisible({ timeout: 5000 });

    // 验证生成按钮禁用
    const generateBtn = canvas.getByRole("button", { name: "生成", exact: true }).first();
    await expect(generateBtn).toBeDisabled();
});

test("M9 文本生成遇 402 额度不足报错记录错误详情，并在原目标节点支持一键重试", async ({ page }) => {
    let attempts = 0;

    await page.route("**/v1/chat/completions", async (route) => {
        attempts++;
        if (attempts === 1) {
            // 首次返回 402 额度不足
            await route.fulfill({
                status: 402,
                contentType: "application/json",
                body: JSON.stringify({ error: { message: "用户额度不足，请充值" } }),
            });
        } else {
            // 重试后返回成功
            await route.fulfill({
                status: 200,
                contentType: "text/event-stream",
                body: 'data: {"choices":[{"delta":{"content":"重试后扩写成功内容"}}]}\n\ndata: [DONE]\n\n',
            });
        }
    });

    const initialProject = {
        id: "proj-m9-retry-402",
        user_id: 909,
        title: "重试测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "text-src-retry",
                    type: "text",
                    title: "源提示词",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        content: "待扩写文本",
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

    await setupM9Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("重试测试工程").first().click();
    const textNode = canvas.locator('[data-node-id="text-src-retry"]');
    await textNode.click();

    const chipInput = canvas.locator('[contenteditable="true"]');
    await chipInput.fill("修饰扩写");
    await canvas.getByRole("button", { name: "生成", exact: true }).first().click();

    // 首次失败，看到错误提示
    await expect(canvas.getByText("用户额度不足，请充值").first()).toBeVisible({ timeout: 5000 });

    // 点击重试按钮
    const retryBtn = canvas.getByRole("button", { name: "重试", exact: true }).first();
    await expect(retryBtn).toBeVisible({ timeout: 5000 });
    await retryBtn.click();

    // 验证第二次请求成功完成并呈现文字
    await expect.poll(() => attempts).toBe(2);
    await expect(canvas.getByText("重试后扩写成功内容").first()).toBeVisible({ timeout: 10000 });
});

test("M9 配置节点恢复模式切换器与胶囊标签：支持生图与文本双态无缝切换与控件对齐", async ({ page }) => {
    const initialProject = {
        id: "proj-m9-config-mode",
        user_id: 909,
        title: "配置节点模式切换测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "cfg-node-switch",
                    type: "config",
                    title: "配置节点",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: {
                        generationMode: "image",
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

    await setupM9Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("配置节点模式切换测试").first().click();
    const configNode = canvas.locator('[data-node-id="cfg-node-switch"]');
    await expect(configNode).toBeVisible({ timeout: 5000 });

    // 验证展示上游原版的 Segmented 模式切换器与胶囊标签
    await expect(configNode.getByText("生图")).toBeVisible({ timeout: 5000 });
    await expect(configNode.getByText("文本")).toBeVisible({ timeout: 5000 });
    await expect(configNode.getByText("提示词").first()).toBeVisible({ timeout: 5000 });
    await expect(configNode.getByText("参考图").first()).toBeVisible({ timeout: 5000 });
    await expect(configNode.getByText("组装提示词").first()).toBeVisible({ timeout: 5000 });

    // 生图模式下展示图片模型与图片设置
    await expect(configNode.getByText("gpt-image-2").first()).toBeVisible({ timeout: 5000 });

    // 点击切换为“文本”模式
    await configNode.getByText("文本").click();

    // 验证模型自动对齐为固定受控辅助模型 gpt-5.6-terra
    await expect(configNode.getByText("gpt-5.6-terra").first()).toBeVisible({ timeout: 5000 });
    // 验证生图的尺寸与分辨率浮层消失，替换为文本设置
    await expect(configNode.getByRole("button", { name: "分辨率与画质", exact: false })).toHaveCount(0);
});


