import { expect, test, type Page } from "@playwright/test";

async function setupM5Page(page: Page, initialProjects: any[] = []) {
    let projectList = [...initialProjects];
    let latestRevision = 1;
    let putRequests: any[] = [];
    let conflictMode = false;
    let delayPutMs = 0;

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 905, username: "canvas-m5", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-m5-token",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m5-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-image-2"] : user } });
        }
    });

    await page.route("**/api/canvas/projects**", async (route) => {
        const method = route.request().method();
        const url = route.request().url();

        if (method === "GET") {
            if (url.includes("/api/canvas/projects/")) {
                const id = url.split("/api/canvas/projects/")[1].split("?")[0];
                const found = projectList.find((p) => p.id === id);
                if (found) {
                    await route.fulfill({ json: { success: true, data: found } });
                } else {
                    await route.fulfill({ status: 404, json: { success: false, message: "Not found" } });
                }
            } else {
                await route.fulfill({
                    json: {
                        success: true,
                        data: projectList.map((p) => ({
                            id: p.id,
                            user_id: p.user_id,
                            title: p.title,
                            revision: p.revision,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        })),
                    },
                });
            }
        } else if (method === "POST") {
            const body = route.request().postDataJSON() || {};
            latestRevision = 1;
            const newProj = {
                id: body.id || `m5-proj-${Date.now()}`,
                user_id: 905,
                title: body.title || "无限画布 1",
                revision: latestRevision,
                content: body.content || "{}",
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
            };
            projectList.unshift(newProj);
            await route.fulfill({ json: { success: true, data: newProj } });
        } else if (method === "PUT") {
            const body = route.request().postDataJSON() || {};
            putRequests.push(body);
            const urlParts = url.split("/api/canvas/projects/")[1].split("?")[0];
            const found = projectList.find((p) => p.id === urlParts);

            if (delayPutMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayPutMs));
            }

            if (conflictMode) {
                await route.fulfill({
                    status: 409,
                    json: {
                        success: false,
                        message: "工程已被其他端更新，存在版本冲突",
                        data: { revision: latestRevision + 1 },
                    },
                });
                return;
            }

            if (!found) {
                await route.fulfill({ status: 404, json: { success: false, message: "Not found" } });
                return;
            }

            latestRevision = (body.revision || 1) + 1;
            found.revision = latestRevision;
            if (body.title) found.title = body.title;
            if (body.content) found.content = body.content;
            found.updated_at = Math.floor(Date.now() / 1000);

            await route.fulfill({ json: { success: true, data: found } });
        } else if (method === "DELETE") {
            const id = url.split("/api/canvas/projects/")[1].split("?")[0];
            projectList = projectList.filter((p) => p.id !== id);
            await route.fulfill({ json: { success: true, message: "Deleted" } });
        } else {
            await route.continue();
        }
    });

    return {
        getProjectList: () => projectList,
        getPutRequests: () => putRequests,
        setConflictMode: (val: boolean) => {
            conflictMode = val;
        },
        setDelayPutMs: (ms: number) => {
            delayPutMs = ms;
        },
    };
}

test("M5 即时创建工程、带分配 ID 导航与彻底切除 IndexedDB canvas_store", async ({ page }) => {
    const helper = await setupM5Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    // 观测到工程列表页面有“新建画布”
    const createBtn = canvas.getByRole("button", { name: "新建画布", exact: true }).first();
    await expect(createBtn).toBeVisible();

    // 点击“新建画布”，向服务端发送 POST /api/canvas/projects 并导航
    await createBtn.click();

    // 验证成功进入画布页面，顶部存在工程标题与保存状态
    await expect(canvas.getByRole("button", { name: "已保存", exact: false }).or(canvas.getByText("已保存"))).toBeVisible();

    // 验证 helper 中记录了一个新建的云端工程
    const list = helper.getProjectList();
    expect(list.length).toBe(1);
    expect(list[0].revision).toBe(1);

    // 验证 IndexedDB 中无 canvas_store 持久化键
    const child = page.frames().find((frame) => frame.parentFrame())!;
    const hasCanvasStore = await child.evaluate(() => {
        return new Promise<boolean>((resolve) => {
            const req = indexedDB.open("infinite-canvas");
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("app_state")) {
                    db.close();
                    return resolve(false);
                }
                const tx = db.transaction("app_state", "readonly");
                const read = tx.objectStore("app_state").get("infinite-canvas:canvas_store:905");
                read.onsuccess = () => {
                    resolve(Boolean(read.result));
                    db.close();
                };
                read.onerror = () => {
                    resolve(false);
                    db.close();
                };
            };
            req.onerror = () => resolve(false);
        });
    });
    expect(hasCanvasStore).toBe(false);
});

test("M5 节点内容变动触发未保存状态、显式保存与快捷键保存立即生效", async ({ page }) => {
    const helper = await setupM5Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 添加一个文本节点
    await canvas.getByLabel("文本", { exact: true }).click();

    // 状态立即切换为“未保存”
    await expect(canvas.getByText("未保存")).toBeVisible();

    // 验证显式保存按钮可用，点击“保存”立即发起保存
    const saveBtn = canvas.getByRole("button", { name: /保\s*存/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // 验证保存成功后状态变为“已保存”
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 验证后端接收到了 revision=1 的更新，并已升级为 revision=2
    const puts = helper.getPutRequests();
    expect(puts.length).toBe(1);
    expect(puts[0].revision).toBe(1);
    expect(helper.getProjectList()[0].revision).toBe(2);

    // 再次添加一个节点作为二次修改
    await canvas.getByLabel("文本", { exact: true }).click();

    // 状态再次变为“未保存”
    await expect(canvas.getByText("未保存")).toBeVisible();

    // 测试快捷键 Ctrl+S / Cmd+S 显式保存
    await page.keyboard.press("ControlOrMeta+s");
    await expect(canvas.getByText("已保存")).toBeVisible();
    expect(helper.getPutRequests().length).toBe(2);
    expect(helper.getPutRequests()[1].revision).toBe(2);
    expect(helper.getProjectList()[0].revision).toBe(3);
});

test("M5 纯视口变换（缩放、平移）不标记为脏，不触发保存", async ({ page }) => {
    const helper = await setupM5Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 缩放画布（通过缩放控制器按钮）
    const zoomInBtn = canvas.getByRole("button", { name: "放大/缩小画布", exact: false }).first();
    if (await zoomInBtn.isVisible()) {
        await zoomInBtn.click();
    }

    // 等待 1 秒确认状态依旧是“已保存”，未发起任何 PUT 保存请求
    await page.waitForTimeout(1000);
    await expect(canvas.getByText("已保存")).toBeVisible();
    expect(helper.getPutRequests().length).toBe(0);
});

test("M5 传输中并发编辑保护：保存期间新改动不被误判为已保存", async ({ page }) => {
    const helper = await setupM5Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 开启 1000ms 的网络延迟模拟
    helper.setDelayPutMs(1000);

    // 添加文本节点触发未保存
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();

    // 点击保存，进入“保存中...”传输状态
    await canvas.getByRole("button", { name: /保\s*存/ }).click();
    await expect(canvas.getByText("保存中...")).toBeVisible();

    // 在传输期间继续编辑节点
    await canvas.getByLabel("文本", { exact: true }).click();

    // 等待保存请求完成
    // 关键校验：因为传输期间有新编辑，状态不能变成“已保存”，必须保持“未保存”！
    await expect(canvas.getByText("未保存")).toBeVisible({ timeout: 5000 });

    // 恢复正常延迟后再次保存
    helper.setDelayPutMs(0);
    await canvas.getByRole("button", { name: /保\s*存/ }).click();
    await expect(canvas.getByText("已保存")).toBeVisible();
});

test("M5 409 Conflict 冲突模态阻断与双分支处置（另存为 vs 放弃）", async ({ page }) => {
    const helper = await setupM5Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 触发改动
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();

    // 开启 409 冲突模式
    helper.setConflictMode(true);

    // 点击保存触发冲突
    await canvas.getByRole("button", { name: /保\s*存/ }).click();

    // 验证弹出工程版本冲突模态对话框
    await expect(canvas.getByText("工程版本冲突")).toBeVisible();
    await expect(canvas.getByText(/云端工程已被其他端更新/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: /放弃本地修改/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /另存为新工程/ })).toBeVisible();

    // 测试分支一：点击“放弃本地修改”，对话框关闭，画布重载并恢复“已保存”
    helper.setConflictMode(false);
    await canvas.getByRole("button", { name: /放弃本地修改/ }).click();
    await expect(canvas.getByText("工程版本冲突")).toBeHidden();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 再次触发冲突并测试分支二：“另存为新工程”
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();
    helper.setConflictMode(true);
    await canvas.getByRole("button", { name: /保\s*存/ }).click();
    await expect(canvas.getByText("工程版本冲突")).toBeVisible();

    helper.setConflictMode(false);
    const initialCount = helper.getProjectList().length;
    await canvas.getByRole("button", { name: /另存为新工程/ }).click();

    // 验证创建了新工程副本
    await expect
        .poll(() => helper.getProjectList().length)
        .toBe(initialCount + 1);
    expect(helper.getProjectList()[0].title).toContain("副本");
});
