import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

async function openCanvas(page: Page, models = ["gpt-image-2"]) {
    await mockCanvasProjectApi(page);
    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 903, username: "canvas-m4", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-session",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m4", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? models : user } });
        }
    });
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');
    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    return canvas;
}

test("M4 出图直接转存上云，元数据持有 S3 URL 与 UUID，零二次上传", async ({ page }) => {
    let uploadRequests = 0;
    let generationRequests = 0;

    // 监听 /api/images 二次上传，出图全链路中此数量必须为 0
    await page.route("**/api/images", async (route) => {
        if (route.request().method() === "POST") {
            uploadRequests++;
        }
        await route.continue();
    });

    const s3ImageUrl = "https://s3.example.test/images/903/m4-cloud-uuid-9999.png";
    await page.route("**/api/canvas/images/generations", async (route) => {
        generationRequests++;
        expect(route.request().headers().authorization).toBe("Bearer canvas-session");
        await route.fulfill({
            json: {
                success: true,
                data: [
                    {
                        id: "m4-cloud-uuid-9999",
                        url: s3ImageUrl,
                        width: 800,
                        height: 600,
                        bytes: 2048,
                        mime_type: "image/png",
                    },
                ],
            },
        });
    });

    const canvas = await openCanvas(page);
    await canvas.getByRole("button", { name: "图片", exact: true }).click();
    await canvas.locator('[contenteditable="true"]').fill("未来科技城市");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();

    // 验证生成请求已触发
    await expect.poll(() => generationRequests).toBe(1);

    // 验证节点图片渲染，使用直接返回的 S3 URL
    const imgNode = canvas.locator(`img[src="${s3ImageUrl}"]`).first();
    await expect(imgNode).toBeVisible({ timeout: 10_000 });

    // 验证完全没有发往 /api/images 的二次上传请求
    expect(uploadRequests).toBe(0);
});

test("M4 生成中删除节点不会发生崩溃，迟到结果不插回画布", async ({ page }) => {
    let releaseGeneration!: () => void;
    const generationHold = new Promise<void>((resolve) => {
        releaseGeneration = resolve;
    });

    const s3ImageUrl = "https://s3.example.test/images/903/late-arrival.png";
    await page.route("**/api/canvas/images/generations", async (route) => {
        await generationHold;
        await route.fulfill({
            json: {
                success: true,
                data: [
                    {
                        id: "late-id",
                        url: s3ImageUrl,
                        width: 400,
                        height: 300,
                        bytes: 1000,
                        mime_type: "image/png",
                    },
                ],
            },
        }).catch(() => {});
    });

    const canvas = await openCanvas(page);
    await canvas.getByRole("button", { name: "图片", exact: true }).click();
    await canvas.locator('[contenteditable="true"]').fill("即将被删除的任务");
    await canvas.getByRole("button", { name: "生成", exact: true }).click();

    // 等待正在生成的占位节点显示
    await expect(canvas.getByText(/生成中|正在生成/).first()).toBeVisible();

    // 找到生成节点并在工具栏点击移除（或通过快捷键删除）
    const deleteBtn = canvas.locator('button[aria-label="移除节点"], button[title="移除节点"]').first();
    if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
    } else {
        await page.keyboard.press("Backspace");
    }

    // 确保占位节点已从画布上消失
    await expect(canvas.getByText("正在生成")).toHaveCount(0);

    // 释放迟到的出图请求
    releaseGeneration();
    await page.waitForTimeout(500);

    // 迟到结果绝不重新插回画布
    await expect(canvas.locator(`img[src="${s3ImageUrl}"]`)).toHaveCount(0);
    await expect(canvas.getByText("正在生成")).toHaveCount(0);
});

test("M4 本地产生源在后端 500 时严格阻断，弹出提示且不产生无身份节点", async ({ page }) => {
    await page.route("**/api/images", async (route) => {
        if (route.request().method() === "POST") {
            await route.fulfill({
                status: 500,
                json: {
                    success: false,
                    message: "上传对象存储失败（模拟后端错误）",
                },
            });
            return;
        }
        await route.continue();
    });

    const canvas = await openCanvas(page);

    // 尝试上传图片文件
    const fileInput = canvas.locator('input[type="file"][accept*="image"]');
    await fileInput.setInputFiles({
        name: "failing-upload.png",
        mimeType: "image/png",
        buffer: pngBuffer,
    });

    // 验证弹出错误 Toast
    await expect(canvas.getByText("上传对象存储失败（模拟后端错误）")).toBeVisible({ timeout: 5000 });

    // 验证画布上没有创建损坏的图片节点
    await expect(canvas.locator("section.canvas-node, div[data-node-id]")).toHaveCount(0);
});

test("M4 IndexedDB 中无 image_files 数据库持久化残留", async ({ page }) => {
    await openCanvas(page);

    // 检查浏览器的 IndexedDB 数据库列表
    const dbNames = await page.evaluate(async () => {
        if (!("indexedDB" in window) || !window.indexedDB.databases) return [];
        const dbs = await window.indexedDB.databases();
        return dbs.map((d) => d.name || "");
    });

    // 确保无单独的 image_files 数据库生成
    expect(dbNames).not.toContain("image_files");
});
