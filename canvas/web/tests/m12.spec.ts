import { expect, test, type Page } from "@playwright/test";
import { mockCanvasProjectApi } from "./mock-canvas-project";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
const pngBuffer = Buffer.from(pngBase64, "base64");

type MockTag = {
    id: number;
    user_id: number;
    name: string;
    created_at: number;
    updated_at: number;
};

type MockAsset = {
    id: number;
    user_id: number;
    asset_type: "text" | "image";
    title: string;
    content: string;
    image_id?: string;
    image?: {
        id: string;
        url: string;
        width: number;
        height: number;
        mime_type: string;
    };
    is_favorite: boolean;
    created_at: number;
    updated_at: number;
    tags: MockTag[];
};

const defaultMockTags: MockTag[] = [
    { id: 1, user_id: 910, name: "画布", created_at: 1726000000, updated_at: 1726000000 },
    { id: 2, user_id: 910, name: "人物", created_at: 1726000000, updated_at: 1726000000 },
    { id: 3, user_id: 910, name: "风景", created_at: 1726000000, updated_at: 1726000000 },
];

const defaultMockAssets: MockAsset[] = [
    {
        id: 201,
        user_id: 910,
        asset_type: "text",
        title: "赛博朋克文本",
        content: "赛博朋克霓虹街道详细设定正文",
        is_favorite: false,
        created_at: 1726000000,
        updated_at: 1726000000,
        tags: [
            { id: 1, user_id: 910, name: "画布", created_at: 1726000000, updated_at: 1726000000 },
            { id: 2, user_id: 910, name: "人物", created_at: 1726000000, updated_at: 1726000000 },
        ],
    },
    {
        id: 202,
        user_id: 910,
        asset_type: "image",
        title: "江南水乡画作",
        content: "烟雨江南水墨群山风景描写",
        image_id: "img-storage-m12-1",
        image: {
            id: "img-storage-m12-1",
            url: "https://assets.test/water-town.png",
            width: 800,
            height: 600,
            mime_type: "image/png",
        },
        is_favorite: false,
        created_at: 1726000100,
        updated_at: 1726000100,
        tags: [{ id: 3, user_id: 910, name: "风景", created_at: 1726000000, updated_at: 1726000000 }],
    },
];

async function setupM12Env(
    page: Page,
    initialProjects: any[] = [],
    options: {
        user?: { id: number; username: string; role: number; group: string };
        initialAssets?: MockAsset[];
        initialTags?: MockTag[];
        failUploadImage?: boolean;
    } = {},
) {
    page.on("pageerror", (err) => console.error(`[PAGE ERROR]`, err));

    let currentUser = options.user || { id: 910, username: "canvas-m12", role: 100, group: "default" };
    let assets = JSON.parse(JSON.stringify(options.initialAssets || defaultMockAssets)) as MockAsset[];
    const tags = JSON.parse(JSON.stringify(options.initialTags || defaultMockTags)) as MockTag[];
    const createdPayloads: any[] = [];
    const deletedIds: number[] = [];
    let uploadImageCallCount = 0;
    let nextAssetId = 300;

    const projectApi = await mockCanvasProjectApi(page, initialProjects);

    await page.route("**/api/user/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/user/auth/refresh") {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        access_token: `canvas-m12-session-${currentUser.id}`,
                        token_type: "Bearer",
                        access_expires_at: Math.floor(Date.now() / 1000) + 600,
                        user: currentUser,
                        session: { sid: "m12-sess", current: true, login_method: "password", ip: "", user_agent: "", created_at: 1, last_active_at: 1, expires_at: 4102444800 },
                    },
                },
            });
        } else {
            await route.fulfill({ json: { success: true, data: path === "/api/user/models" ? ["gpt-image-2", "gpt-5.6-terra"] : currentUser } });
        }
    });

    await page.route("**/api/images", async (route) => {
        if (options.failUploadImage) {
            await route.fulfill({ status: 500, json: { success: false, message: "Upload failed" } });
            return;
        }
        uploadImageCallCount += 1;
        await route.fulfill({
            json: {
                success: true,
                message: "",
                data: {
                    id: `uploaded-img-${uploadImageCallCount}`,
                    key: `uploads/img-${uploadImageCallCount}.png`,
                    url: `https://assets.test/uploaded-${uploadImageCallCount}.png`,
                    width: 512,
                    height: 512,
                    bytes: 1024,
                    mime_type: "image/png",
                },
            },
        });
    });

    await page.route("**/api/digital-assets/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const method = req.method();

        if (url.pathname === "/api/digital-assets/tags") {
            await route.fulfill({
                json: {
                    success: true,
                    message: "",
                    data: tags,
                },
            });
            return;
        }

        if (method === "DELETE") {
            const parts = url.pathname.replace(/\/$/, "").split("/");
            const id = Number(parts[parts.length - 1]);
            deletedIds.push(id);
            assets = assets.filter((a) => a.id !== id);
            await route.fulfill({ json: { success: true, message: "", data: null } });
            return;
        }

        if (method === "POST") {
            const body = req.postDataJSON();
            createdPayloads.push(body);
            const newAsset: MockAsset = {
                id: ++nextAssetId,
                user_id: currentUser.id,
                asset_type: body.asset_type || "text",
                title: body.title,
                content: body.content,
                image_id: body.image_id,
                image: body.image_id
                    ? {
                          id: body.image_id,
                          url: `https://assets.test/${body.image_id}.png`,
                          width: 800,
                          height: 600,
                          mime_type: "image/png",
                      }
                    : undefined,
                is_favorite: false,
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                tags: (body.tags || []).map((name: string, i: number) => ({
                    id: 10 + i,
                    user_id: currentUser.id,
                    name,
                    created_at: Math.floor(Date.now() / 1000),
                    updated_at: Math.floor(Date.now() / 1000),
                })),
            };
            assets.unshift(newAsset);
            await route.fulfill({ json: { success: true, message: "", data: newAsset } });
            return;
        }

        const search = (url.searchParams.get("search") || "").trim().toLowerCase();
        const tagIds = url.searchParams.getAll("tag_id").map(Number).filter(Boolean);
        const assetType = url.searchParams.get("asset_type");

        let filtered = assets.filter((a) => a.user_id === currentUser.id);
        if (assetType) {
            filtered = filtered.filter((a) => a.asset_type === assetType);
        }
        if (search) {
            filtered = filtered.filter((a) => a.title.toLowerCase().includes(search) || a.content.toLowerCase().includes(search));
        }
        if (tagIds.length > 0) {
            filtered = filtered.filter((a) => tagIds.every((tid) => a.tags.some((t) => t.id === tid)));
        }

        await route.fulfill({
            json: {
                success: true,
                message: "",
                data: {
                    page: 1,
                    page_size: 50,
                    total: filtered.length,
                    items: filtered,
                },
            },
        });
    });

    await page.route("https://assets.test/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: pngBuffer,
        });
    });

    return {
        projectApi,
        getCreatedPayloads: () => createdPayloads,
        getDeletedIds: () => deletedIds,
        getUploadImageCallCount: () => uploadImageCallCount,
    };
}

test("M12 图片节点工具栏“存入资产”，就绪时验证载荷包含 tags: ['画布']、asset_type: 'image'、image_id", async ({ page }) => {
    const initialProject = {
        id: "proj-m12-save-img-1",
        user_id: 910,
        title: "图片存资产测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "target-image-node",
                    type: "image",
                    title: "待存入画作",
                    position: { x: 200, y: 200 },
                    width: 320,
                    height: 240,
                    metadata: {
                        content: `data:image/png;base64,${pngBase64}`,
                        storageKey: "img-s3-key-ready",
                        prompt: "日落山脉画作提示词",
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

    const env = await setupM12Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("图片存资产测试工程").first().click();
    const imgNode = canvas.locator('[data-node-id="target-image-node"]');
    await expect(imgNode).toBeVisible({ timeout: 5000 });

    await imgNode.click();

    const saveAssetBtn = canvas.locator(".z-\\[70\\]").getByRole("button", { name: /存.*资产|加入我的资产/ }).first();
    await expect(saveAssetBtn).toBeVisible({ timeout: 5000 });
    await saveAssetBtn.click();

    await expect(canvas.getByText(/已加入我的资产/)).toBeVisible({ timeout: 5000 });

    const payloads = env.getCreatedPayloads();
    expect(payloads.length).toBe(1);
    expect(payloads[0].asset_type).toBe("image");
    expect(payloads[0].image_id).toBe("img-s3-key-ready");
    expect(payloads[0].tags).toEqual(["画布"]);
    expect(payloads[0].content).toBe("日落山脉画作提示词");
    expect(payloads[0].title).toBe("待存入画作");
});

test("M12 图片节点未就绪（无 storageKey 或 loading）时拦截存入并提示“图片尚未同步完成”", async ({ page }) => {
    const initialProject = {
        id: "proj-m12-save-img-pending",
        user_id: 910,
        title: "未就绪图片测试工程",
        revision: 1,
        content: JSON.stringify({
            nodes: [
                {
                    id: "pending-image-node",
                    type: "image",
                    title: "未同步图片",
                    position: { x: 200, y: 200 },
                    width: 320,
                    height: 240,
                    metadata: {
                        content: "https://assets.test/temp-pending.png",
                        // storageKey 缺失，模拟尚未完成云端同步
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

    const env = await setupM12Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("未就绪图片测试工程").first().click();
    const imgNode = canvas.locator('[data-node-id="pending-image-node"]');
    await expect(imgNode).toBeVisible({ timeout: 5000 });

    await imgNode.click();

    const saveAssetBtn = canvas.locator(".z-\\[70\\]").getByRole("button", { name: /存.*资产|加入我的资产/ }).first();
    await expect(saveAssetBtn).toBeVisible({ timeout: 5000 });
    await saveAssetBtn.click();

    // 验证出现拦截提示
    await expect(canvas.getByText(/图片尚未同步完成|Image is not ready yet/)).toBeVisible({ timeout: 5000 });

    // 验证未发送任何保存载荷
    expect(env.getCreatedPayloads().length).toBe(0);
});

test("M12 侧边栏资产列表呈现图片封面、点击插入图片节点且零重复上传（复用 storageKey）", async ({ page }) => {
    const initialProject = {
        id: "proj-m12-sidebar-img",
        user_id: 910,
        title: "图片侧边栏测试工程",
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

    const env = await setupM12Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("图片侧边栏测试工程").first().click();

    // 切换到“资产”Tab
    const assetsTabBtn = canvas.getByRole("button", { name: "资产" }).first();
    await expect(assetsTabBtn).toBeVisible({ timeout: 5000 });
    await assetsTabBtn.click();

    // 验证图片资产卡片呈现标题和缩略图
    await expect(canvas.getByText("江南水乡画作").first()).toBeVisible({ timeout: 5000 });
    const imgThumbnail = canvas.locator('img[src="https://assets.test/water-town.png"]');
    await expect(imgThumbnail).toBeVisible({ timeout: 5000 });

    // 悬停在图片资产卡片上，点击浮现的「+」插入按钮
    const assetCard = canvas.getByText("江南水乡画作").first().locator("xpath=ancestor::div[contains(@class, 'group')]");
    await assetCard.hover();
    const insertBtn = assetCard.locator('button[aria-label*="插入"], button[aria-label*="Insert"]').first();
    await expect(insertBtn).toBeVisible({ timeout: 5000 });
    await insertBtn.click();

    // 验证画布上生成了新的图片节点
    const insertedNode = canvas.locator("[data-node-id]").first();
    await expect(insertedNode).toBeVisible({ timeout: 5000 });

    // 验证零重复上传：uploadImage 绝未被再次调用（复用了 storageKey）
    expect(env.getUploadImageCallCount()).toBe(0);
});

test("M12 侧边栏资产顶栏「+」文件选择器上传图片并存入数字资产", async ({ page }) => {
    const initialProject = {
        id: "proj-m12-upload-asset",
        user_id: 910,
        title: "上传测试工程",
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

    const env = await setupM12Env(page, [initialProject]);
    await page.goto("/playground/canvas");
    const canvas = page.frameLocator('iframe[title="Infinite Canvas"]');

    await canvas.getByText("上传测试工程").first().click();

    // 切换到资产Tab
    const assetsTabBtn = canvas.getByRole("button", { name: "资产" }).first();
    await expect(assetsTabBtn).toBeVisible({ timeout: 5000 });
    await assetsTabBtn.click();

    // 找到并设置侧边栏文件输入
    const fileInput = canvas.getByRole("complementary").locator('input[type="file"]');
    await fileInput.setInputFiles({
        name: "test-landscape.png",
        mimeType: "image/png",
        buffer: pngBuffer,
    });

    // 验证上传并调用了 createDigitalAsset
    await expect(canvas.getByText(/已添加|Added/)).toBeVisible({ timeout: 5000 });

    const payloads = env.getCreatedPayloads();
    expect(payloads.length).toBe(1);
    expect(payloads[0].asset_type).toBe("image");
    expect(payloads[0].image_id).toBe("uploaded-img-1");
    expect(payloads[0].title).toBe("test-landscape");
});
