import { expect, test, type Page } from "@playwright/test";

type MockCanvasProject = {
    id: string;
    user_id?: number;
    title: string;
    revision: number;
    content: string;
    created_at?: number;
    updated_at?: number;
};

async function setupM6M7Page(page: Page, initialProjects: MockCanvasProject[] = []) {
    let projectList: MockCanvasProject[] = [...initialProjects];
    let latestRevision = 1;
    const putRequests: Array<{ revision?: number; title?: string; content?: string }> = [];
    let conflictMode = false;
    let networkErrorMode = false;
    let delayPutMs = 0;

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const user = { id: 906, username: "canvas-m6m7", role: 100, group: "default" };
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: "canvas-m6m7-token",
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user,
                        session: { sid: "m6m7-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
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
                id: body.id || `m6m7-proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                user_id: 906,
                title: body.title || "无限画布 1",
                revision: latestRevision,
                content: body.content || "{}",
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
            };
            projectList.unshift(newProj);
            await route.fulfill({ json: { success: true, data: newProj } });
        } else if (method === "PUT") {
            if (networkErrorMode) {
                await route.abort("failed");
                return;
            }

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
                        data: { revision: (found?.revision || 1) + 1 },
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
        setNetworkErrorMode: (val: boolean) => {
            networkErrorMode = val;
        },
        setDelayPutMs: (ms: number) => {
            delayPutMs = ms;
        },
        updateRemoteProject: (id: string, patch: Partial<MockCanvasProject>) => {
            const proj = projectList.find((p) => p.id === id);
            if (proj) Object.assign(proj, patch);
        },
        deleteRemoteProject: (id: string) => {
            projectList = projectList.filter((p) => p.id !== id);
        },
    };
}

test("M6+M7 干净态跨端无感同步与视口保持", async ({ page }) => {
    const initialProject = {
        id: "proj-sync-1",
        user_id: 906,
        title: "无感同步测试",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "text-1",
                    type: "text",
                    title: "初始节点标题",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: { content: "旧内容", status: "idle" },
                },
            ],
            connections: [],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };

    const helper = await setupM6M7Page(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    // 打开既有工程
    await canvas.getByText("无感同步测试").first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();
    await expect(canvas.getByText("初始节点标题")).toBeVisible();

    // 调整视口坐标（缩放画布）
    const zoomInBtn = canvas.getByRole("button", { name: "放大/缩小画布", exact: false }).first();
    if (await zoomInBtn.isVisible()) {
        await zoomInBtn.click();
    }

    // 记录调整后的视口 transform
    const canvasLayer = canvas.locator("div.origin-top-left").first();
    await expect(canvasLayer).toBeAttached();
    const transformBefore = await canvasLayer.evaluate((el) => el.style.transform);
    expect(transformBefore).toBeTruthy();

    // 模拟远端在另一端更新了工程内容，推进 revision 到 2
    helper.updateRemoteProject("proj-sync-1", {
        revision: 2,
        content: JSON.stringify({
            nodes: [
                {
                    id: "text-1",
                    type: "text",
                    title: "远端更新后的标题",
                    position: { x: 100, y: 100 },
                    width: 340,
                    height: 240,
                    metadata: { content: "远端新内容", status: "idle" },
                },
            ],
            connections: [],
            chatSessions: [],
            viewport: { x: 999, y: 999, k: 0.5 }, // 远端视口与本地不同
        }),
    });

    // 切回标签页触发探活
    const childFrame = page.frames().find((f) => f.parentFrame())!;
    await childFrame.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
    });

    // 验证轻量 Toast 提示“已同步云端最新修改”
    await expect(canvas.getByText("已同步云端最新修改")).toBeVisible();

    // 验证节点标题已替换为远端新标题
    await expect(canvas.getByText("远端更新后的标题")).toBeVisible();

    // 验证视口绝对保持，未被重置为远端的 (999, 999, 0.5)
    const transformAfter = await canvasLayer.evaluate((el) => el.style.transform);
    expect(transformAfter).toBe(transformBefore);

    // 验证状态依旧是“已保存”，未发起 PUT 请求
    await expect(canvas.getByText("已保存")).toBeVisible();
    expect(helper.getPutRequests().length).toBe(0);
});

test("M6+M7 脏态跨端柔性预警与保存收敛", async ({ page }) => {
    const helper = await setupM6M7Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 添加文本节点使本地变为“脏态”（未保存）
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();

    const currentProjId = helper.getProjectList()[0].id;

    // 模拟远端在另一端更新了工程内容，推进 revision 到 2
    helper.updateRemoteProject(currentProjId, {
        revision: 2,
        content: JSON.stringify({
            nodes: [
                {
                    id: "remote-node-1",
                    type: "text",
                    title: "另一端的修改",
                    position: { x: 200, y: 200 },
                    width: 340,
                    height: 240,
                    metadata: { content: "remote text", status: "idle" },
                },
            ],
            connections: [],
            chatSessions: [],
            viewport: { x: 0, y: 0, k: 1 },
        }),
    });

    // 切回标签页触发探活
    const childFrame = page.frames().find((f) => f.parentFrame())!;
    await childFrame.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
    });

    // 验证绝不弹出打断思路的强阻断模态框
    await expect(canvas.getByText("工程版本冲突")).toBeHidden();

    // 验证顶部状态栏出现柔和警告：“云端已有新版本，保存时将提示冲突”
    await expect(canvas.getByText(/云端已有新版本，保存时将提示冲突/)).toBeVisible();

    // 开启 CAS 409 模式，模拟点击保存
    helper.setConflictMode(true);
    await canvas.getByRole("button", { name: /保\s*存/ }).click();

    // 验证成功截获 409 并弹出既有的版本冲突模态框
    await expect(canvas.getByText("工程版本冲突")).toBeVisible();
    await expect(canvas.getByRole("button", { name: /另存为新工程/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /放弃本地修改/ })).toBeVisible();
});

test("M6+M7 远端已被删除（404）的干净态与脏态分支", async ({ page }) => {
    const helper = await setupM6M7Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    // === 分支 1：干净态下远端被删除 ===
    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    const projId1 = helper.getProjectList()[0].id;
    // 模拟远端在其他设备将该工程删除
    helper.deleteRemoteProject(projId1);

    const childFrame = page.frames().find((f) => f.parentFrame())!;
    // 切回焦点触发探活
    await childFrame.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
    });

    // 验证轻提示工程已被删除
    await expect(canvas.getByText("该工程已在云端被删除")).toBeVisible();

    // 验证 1.5 秒后平滑导航回工程列表页
    await expect(canvas.getByRole("button", { name: "新建画布", exact: true }).first()).toBeVisible({ timeout: 5000 });

    // === 分支 2：脏态下远端被删除 ===
    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 添加文本节点使本地变为脏态
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();

    const projId2 = helper.getProjectList()[0].id;
    // 模拟远端删除
    helper.deleteRemoteProject(projId2);

    // 切回焦点触发探活或点击保存
    await childFrame.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
    });

    // 验证弹出工程已被删除的阻断对话框
    await expect(canvas.getByText("工程已被删除")).toBeVisible();
    await expect(canvas.getByRole("button", { name: /放弃并退出/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /另存为新工程/ })).toBeVisible();

    // 点击“另存为新工程”
    const projectCountBefore = helper.getProjectList().length;
    await canvas.getByRole("button", { name: /另存为新工程/ }).click();

    // 验证以全新 ID 创建了副本
    await expect.poll(() => helper.getProjectList().length).toBe(projectCountBefore + 1);
    const newestProject = helper.getProjectList()[0];
    expect(newestProject.id).not.toBe(projId2);
    expect(newestProject.title).toContain("副本");

    // 验证原本已删除的工程 ID 绝未被复活
    expect(helper.getProjectList().some((p) => p.id === projId2)).toBe(false);
});

test("M6+M7 在途任务落盘保护与即刻原子保存", async ({ page }) => {
    let releaseGeneration!: () => void;
    const generationPending = new Promise<void>((resolve) => {
        releaseGeneration = resolve;
    });

    // 模拟生图接口
    await page.route("**/api/canvas/images/generations", async (route) => {
        await generationPending;
        await route.fulfill({
            json: {
                success: true,
                data: [
                    {
                        id: "s3-uuid-persisted-key",
                        url: "https://s3.example.test/images/img-gen-done.png",
                        width: 100,
                        height: 100,
                        bytes: 2048,
                        mime_type: "image/png",
                    },
                ],
            },
        });
    });

    const helper = await setupM6M7Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 添加图片节点
    await canvas.getByRole("button", { name: "图片", exact: true }).click();
    await canvas.locator('[contenteditable="true"]').fill("太空堡垒");

    // 点击“生成”触发在途任务
    await canvas.getByRole("button", { name: "生成", exact: true }).click();

    // 等待 1 秒确认处于出图在途任务中
    await page.waitForTimeout(1000);

    // 关键校验 1：在途期间自动保存定时器不触发持久化
    expect(helper.getPutRequests().length).toBe(0);

    // 即使在在途期间手动按 Ctrl+S，也会被 executeSave 守卫拦截
    await page.keyboard.press("ControlOrMeta+s");
    expect(helper.getPutRequests().length).toBe(0);

    // 模拟出图完成并成功换取 S3 storageKey
    releaseGeneration();

    // 关键校验 2：生成完成并取得正式 S3 identity 后，立即自动触发一次原子 PUT 保存
    await expect.poll(() => helper.getPutRequests().length).toBe(1);
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 验证保存的云端包体包含了持久化身份 storageKey
    const putBody = helper.getPutRequests()[0];
    expect(putBody.content).toContain("s3-uuid-persisted-key");
});

test("M6+M7 离线恢复与点击重试", async ({ page }) => {
    const helper = await setupM6M7Page(page);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(canvas.getByText("已保存")).toBeVisible();

    // 添加文本节点触发未保存
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();

    // 开启网络故障模拟（PUT 请求断网失败）
    helper.setNetworkErrorMode(true);

    // 点击保存
    await canvas.getByRole("button", { name: /保\s*存/ }).click();

    // 验证状态切换为“保存失败”
    await expect(canvas.getByText(/保存失败/)).toBeVisible();

    // === 测试路径 A：恢复网络后，点击保存失败按钮立即手动重试 ===
    helper.setNetworkErrorMode(false);
    await canvas.getByText(/保存失败/).click();

    // 验证保存成功恢复“已保存”
    await expect(canvas.getByText("已保存")).toBeVisible();
    expect(helper.getPutRequests().length).toBe(1);

    // === 测试路径 B：恢复网络后，监听 window.online 自动重试补存 ===
    // 再次添加节点
    await canvas.getByLabel("文本", { exact: true }).click();
    await expect(canvas.getByText("未保存")).toBeVisible();

    // 再次断网
    helper.setNetworkErrorMode(true);
    await canvas.getByRole("button", { name: /保\s*存/ }).click();
    await expect(canvas.getByText(/保存失败/)).toBeVisible();

    // 恢复网络
    helper.setNetworkErrorMode(false);

    // 触发浏览器的 online 重新联网事件
    const childFrame = page.frames().find((f) => f.parentFrame())!;
    await childFrame.evaluate(() => {
        window.dispatchEvent(new Event("online"));
    });

    // 验证 online 事件自动发起补存并恢复为“已保存”
    await expect(canvas.getByText("已保存")).toBeVisible();
    expect(helper.getPutRequests().length).toBe(2);
});
