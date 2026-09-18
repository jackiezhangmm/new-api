import { expect, test } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

test("主站认证刷新、账号隔离和首期入口封闭", async ({ page }) => {
    const userProjects: Record<string, any[]> = {
        a: [],
        b: [],
    };
    const userAssets: Record<string, any[]> = { a: [], b: [] };
    let nextAssetId = 1;
    let account = "a";

    await page.route("**/api/digital-assets/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "POST") {
            const body = request.postDataJSON() || {};
            const asset = {
                id: nextAssetId++,
                user_id: account === "a" ? 901 : 902,
                asset_type: body.asset_type || "text",
                title: body.title || "",
                content: body.content || "",
                is_favorite: false,
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                tags: [],
            };
            userAssets[account].unshift(asset);
            await route.fulfill({ json: { success: true, data: asset } });
            return;
        }
        if (request.method() === "GET") {
            const isTags = url.pathname.endsWith("/tags");
            const items = userAssets[account];
            await route.fulfill({ json: { success: true, data: isTags ? [] : { page: 1, page_size: 50, total: items.length, items } } });
            return;
        }
        await route.continue();
    });

    await page.route("**/api/canvas/projects**", async (route) => {
        const currentUserId = account === "a" ? 901 : 902;
        const currentList = userProjects[account] || [];
        if (route.request().method() === "POST") {
            const body = route.request().postDataJSON() || {};
            const proj = {
                id: body.id || `proj-${Date.now()}`,
                user_id: currentUserId,
                title: body.title || "无限画布 1",
                revision: 1,
                content: body.content || "{}",
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
            };
            userProjects[account].push(proj);
            await route.fulfill({ json: { success: true, data: proj } });
        } else if (route.request().method() === "GET") {
            const url = route.request().url();
            if (url.includes("/api/canvas/projects/")) {
                const id = url.split("/api/canvas/projects/")[1].split("?")[0];
                const found = currentList.find((p) => p.id === id);
                if (found) {
                    await route.fulfill({ json: { success: true, data: found } });
                } else {
                    await route.fulfill({ status: 404, json: { success: false, message: "Not found" } });
                }
            } else {
                await route.fulfill({ json: { success: true, data: currentList } });
            }
        } else if (route.request().method() === "PUT") {
            const body = route.request().postDataJSON() || {};
            const url = route.request().url();
            const id = url.split("/api/canvas/projects/")[1].split("?")[0];
            const found = currentList.find((p) => p.id === id);
            if (found) {
                found.title = body.title || found.title;
                found.revision = (body.revision || 1) + 1;
                found.content = body.content || found.content;
                found.updated_at = Math.floor(Date.now() / 1000);
                await route.fulfill({ json: { success: true, data: found } });
            } else {
                await route.fulfill({ status: 404, json: { success: false, message: "Not found" } });
            }
        } else {
            await route.continue();
        }
    });
    let refreshes = 0;
    const modelHeaders: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: account === "a" ? 901 : 902, username: `canvas-test-${account}`, role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            refreshes++;
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: `test-${account}-${refreshes}`,
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + (refreshes === 1 ? 20 : 600),
                        user,
                        session: { sid: `session-${account}`, current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else if (path === "/api/user/models") {
            modelHeaders.push(route.request().headers().authorization);
            await route.fulfill({ json: { success: true, data: ["gpt-image-2"] } });
        } else {
            await route.fulfill({ json: { success: true, data: user } });
        }
    });
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');
    await expect(canvas.getByRole("button", { name: "新建画布", exact: true }).first()).toBeVisible();
    expect(refreshes).toBeGreaterThanOrEqual(2);
    expect(modelHeaders).toContain("Bearer test-a-2");
    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByRole("button", { name: "文本", exact: true })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "生成配置", exact: true }).first()).toBeVisible();
    // 当前视频、音频、提示词库功能均已开放，不再隐藏入口
    await canvas.getByRole("button", { name: "文本", exact: true }).click();
    await canvas.getByText("双击编辑文字", { exact: true }).dblclick();
    await canvas.locator("textarea").fill("A-private-asset");
    await canvas.locator("textarea").press("Escape");
    await canvas.locator("section").getByText("A-private-asset", { exact: true }).hover();
    await canvas.getByRole("button", { name: "加入我的资产", exact: true }).click();
    await canvas.getByRole("button", { name: "资产", exact: true }).click();
    await expect(canvas.locator('[data-node-id]').getByText("A-private-asset", { exact: true })).toBeVisible();
    await expect(canvas.locator('[title="A-private-asset"]')).toBeVisible();
    await canvas.getByTitle("双击修改画布名称").dblclick();
    await canvas.getByRole("textbox", { name: "双击修改画布名称" }).fill("A-private-project");
    await canvas.getByRole("textbox", { name: "双击修改画布名称" }).press("Enter");
    await expect.poll(() => userAssets.a.some((asset) => asset.title === "A-private-asset")).toBe(true);
    await page.screenshot({ path: "/tmp/new-api-canvas-m1-desktop.png", fullPage: true });
    account = "b";
    await page.reload();
    await expect(canvas.getByRole("button", { name: "新建画布", exact: true }).first()).toBeVisible();
    await expect(canvas.getByText("A-private-project")).toHaveCount(0);
    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await canvas.getByRole("button", { name: "资产", exact: true }).click();
    await expect(canvas.getByText("A-private-asset", { exact: true })).toHaveCount(0);
    account = "a";
    await page.reload();
    await expect(canvas.getByText("A-private-project")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "导出", exact: true })).toHaveCount(0);
    await expect(canvas.getByRole("link", { name: "提示词库", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/new-api-canvas-m1-mobile.png", fullPage: true });
    await page.getByRole("button", { name: "C", exact: true }).click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator('iframe[title="Infinite Canvas"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("独立打开子应用不能读取本地工程", async ({ page }) => {
    await page.goto("/canvas/");
    await expect(page.getByText("请从主站的无限画布入口打开")).toBeVisible();
    await expect(page.getByRole("button", { name: "新建画布", exact: true })).toHaveCount(0);
});
