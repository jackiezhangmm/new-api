import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";

async function openCanvas(page: Page, models = ["gpt-image-2"]) {
    await mockCanvasProjectApi(page);
    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 903, username: "canvas-m2", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m2", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? models : user } });
    });
    await page.route("**/api/images", async (route) => {
        if (route.request().method() === "POST") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        id: "mock-image-id",
                        url: "https://s3.example.test/mock-image.png",
                        width: 1,
                        height: 1,
                        bytes: 68,
                        mime_type: "image/png",
                    },
                },
            });
            return;
        }
        await route.continue();
    });
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');
    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await canvas.getByRole("button", { name: "图片", exact: true }).click();
    return canvas;
}

test("image2 设置、语义尺寸、单次多图与预览图片展示", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let requests = 0;
    await page.route("**/api/canvas/images/generations", async (route) => {
        requests++;
        expect(route.request().headers().authorization).toBe("Bearer canvas-session");
        expect(route.request().postDataJSON()).toEqual({ model: "gpt-image-2", prompt: "红色海报", n: 4, size: "1:3 2k", quality: "low", response_format: "b64_json", output_format: "png" });
        await route.fulfill({
            json: {
                success: true,
                data: [
                    { id: "m2-img-1", url: "https://s3.example.test/images/m2-img-1.png", width: 1, height: 1, bytes: 68, mime_type: "image/png" },
                    { id: "m2-img-2", url: "https://s3.example.test/images/m2-img-2.png", width: 1, height: 1, bytes: 68, mime_type: "image/png" },
                ],
            },
        });
    });
    const canvas = await openCanvas(page);
    await canvas.getByRole("button", { name: "图像设置", exact: true }).click();
    const settings = canvas.locator(".canvas-image-settings-popover");
    await expect(settings.getByText("透明背景", { exact: true })).toHaveCount(0);
    await expect(settings.getByText("尺寸", { exact: true })).toHaveCount(0);
    await settings.getByRole("button", { name: "2K", exact: true }).click();
    await settings.getByRole("button", { name: "1:3", exact: true }).click();
    await settings.getByRole("button", { name: "4 张", exact: true }).click();
    await canvas.getByRole("button", { name: "图像设置", exact: true }).click();
    await canvas.locator('[contenteditable="true"]').fill("红色海报");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();
    await expect(canvas.getByText("已返回 2 张图片，少于请求的 4 张")).toBeVisible();
    await expect.poll(() => canvas.locator('section img[src^="blob:"], section img[src*="example.test"]').count()).toBeGreaterThan(0);
    expect(requests).toBe(1);
    await page.screenshot({ path: "/tmp/new-api-canvas-m2-desktop.png", fullPage: true });
    expect(errors).toEqual([]);
});

test("不可用模型禁止发送", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/canvas/images/generations", async (route) => {
        requests++;
        await route.abort();
    });
    const canvas = await openCanvas(page, ["unknown-model"]);
    await expect(canvas.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
    await expect(canvas.getByText("模型 gpt-image-2 当前不可用，请重新选择")).toBeVisible();
    expect(requests).toBe(0);
});

test("上游失败可明确重试，停止后不接收晚到图片", async ({ page }) => {
    let attempts = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route("**/api/canvas/images/generations", async (route) => {
        attempts++;
        if (attempts === 1) await route.fulfill({ status: 403, json: { error: { message: "测试额度不足" } } });
        else {
            await pending;
            await route.fulfill({
                json: {
                    success: true,
                    data: [{ id: "m2-retry", url: "https://s3.example.test/images/m2-retry.png", width: 1, height: 1, bytes: 68, mime_type: "image/png" }],
                },
            }).catch(() => {});
        }
    });
    const canvas = await openCanvas(page);
    await canvas.locator('[contenteditable="true"]').fill("红色海报");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();
    await expect(canvas.getByText("测试额度不足").first()).toBeVisible();
    await canvas.getByRole("button", { name: "重试", exact: true }).first().click();
    await expect.poll(() => attempts).toBe(2);
    await canvas.getByRole("button", { name: "停止生成", exact: true }).click();
    await canvas
        .getByRole("dialog")
        .getByRole("button", { name: /^停\s*止$/ })
        .click();
    await expect(canvas.getByText("请求已取消").first()).toBeVisible();
    release();
    await expect(canvas.locator('section img[src^="blob:"], section img[src*="example.test"]')).toHaveCount(0);
    await expect(canvas.getByRole("button", { name: "生成", exact: true })).toBeEnabled();
    expect(attempts).toBe(2);
});

test("旧工程不静默修正，主动选择模型后明确调整不兼容设置", async ({ page }) => {
    const legacyNode = {
        id: "legacy-node-1",
        type: "image",
        title: "图片",
        position: { x: 100, y: 100 },
        width: 320,
        height: 240,
        metadata: {
            model: "removed-image-model",
            quality: "high",
            size: "1232x768",
            background: "transparent",
            count: 8,
        },
    };
    const initialProjects = [
        {
            id: "legacy-proj-id",
            user_id: 903,
            title: "无限画布 1",
            revision: 1,
            content: JSON.stringify({
                nodes: [legacyNode],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "lines",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
            }),
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
        },
    ];
    await mockCanvasProjectApi(page, initialProjects);
    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 903, username: "canvas-m2", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m2", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-image-2"] : user } });
    });
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');
    await canvas.getByRole("heading", { name: "无限画布 1", exact: true }).click();
    const node = canvas.locator("[data-node-id]").first();
    await node.dblclick();
    await expect(canvas.getByText("模型 removed-image-model 当前不可用，请重新选择").first()).toBeVisible();
    await expect(canvas.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
    await canvas.getByRole("combobox", { name: "removed-image-model" }).click();
    await canvas.getByRole("option", { name: "gpt-image-2", exact: true }).click();
    await expect(canvas.getByText(/已按所选模型调整/)).toBeVisible();
    await canvas.getByRole("button", { name: "图像设置", exact: true }).click();
    const settings = canvas.locator(".canvas-image-settings-popover");
    await expect(settings.getByRole("button", { name: "1K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(settings.getByRole("button", { name: "1:1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(settings.getByRole("button", { name: "1 张", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(settings.getByRole("alert")).toHaveCount(0);
});
