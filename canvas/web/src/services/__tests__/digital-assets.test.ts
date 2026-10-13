import { test } from "node:test";
import assert from "node:assert/strict";
import { useUserStore } from "@/stores/use-user-store";
import {
    fetchDigitalAssets,
    fetchDigitalAssetTags,
    createDigitalAsset,
    deleteDigitalAsset,
    DIGITAL_ASSETS_QUERY_KEY,
    DIGITAL_ASSET_TAGS_QUERY_KEY,
} from "@/services/api/digital-assets";

function setupHostAuth(userId = "user-m11") {
    useUserStore.setState({ user: { id: userId, username: "m11-tester", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: userId }),
                getAuthHeaders: async () => ({ Authorization: "Bearer test-m11-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;
}

test("fetchDigitalAssets 参数组装、尾部斜杠、认证头传递与成功返回", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    setupHostAuth();

    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: {
                    page: 1,
                    page_size: 20,
                    total: 1,
                    items: [
                        {
                            id: 101,
                            user_id: 1,
                            asset_type: "text",
                            title: "测试资产",
                            content: "测试资产正文",
                            is_favorite: false,
                            created_at: 1726000000,
                            updated_at: 1726000000,
                            tags: [{ id: 1, user_id: 1, name: "画布", created_at: 1726000000, updated_at: 1726000000 }],
                        },
                    ],
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const result = await fetchDigitalAssets({
            page: 1,
            pageSize: 20,
            search: "测试",
            tagIds: [1, 2],
        });

        assert.ok(requestedUrl.startsWith("/api/digital-assets/?"));
        assert.ok(requestedUrl.includes("p=1"));
        assert.ok(requestedUrl.includes("page_size=20"));
        assert.ok(requestedUrl.includes("search=%E6%B5%8B%E8%AF%95") || requestedUrl.includes("search=测试"));
        assert.ok(requestedUrl.includes("tag_id=1"));
        assert.ok(requestedUrl.includes("tag_id=2"));
        assert.equal(requestedHeaders.Authorization, "Bearer test-m11-token");
        assert.equal(result.total, 1);
        assert.equal(result.items[0].title, "测试资产");
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.getState().clearSession();
    }
});

test("fetchDigitalAssets 接口报错时阻断并抛出异常", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    setupHostAuth();

    globalThis.fetch = (async () => {
        return new Response(
            JSON.stringify({
                success: false,
                message: "拉取资产失败",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        await assert.rejects(async () => {
            await fetchDigitalAssets({});
        }, /拉取资产失败/);
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.getState().clearSession();
    }
});

test("fetchDigitalAssetTags 正常拉取标签并在异常时抛出错误", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    setupHostAuth();

    let requestedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: [
                    { id: 1, user_id: 1, name: "画布", created_at: 1726000000, updated_at: 1726000000 },
                    { id: 2, user_id: 1, name: "人物", created_at: 1726000000, updated_at: 1726000000 },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const tags = await fetchDigitalAssetTags();
        assert.equal(requestedUrl, "/api/digital-assets/tags");
        assert.equal(tags.length, 2);
        assert.equal(tags[0].name, "画布");
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.getState().clearSession();
    }
});

test("createDigitalAsset 正确发送 POST 载荷并返回资产", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    setupHostAuth();

    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method || "GET";
        requestedBody = String(init?.body || "");
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: {
                    id: 102,
                    user_id: 1,
                    asset_type: "text",
                    title: "存入的文本",
                    content: "正文内容",
                    is_favorite: false,
                    created_at: 1726000000,
                    updated_at: 1726000000,
                    tags: [{ id: 1, user_id: 1, name: "画布", created_at: 1726000000, updated_at: 1726000000 }],
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const asset = await createDigitalAsset({
            asset_type: "text",
            title: "存入的文本",
            content: "正文内容",
            tags: ["画布"],
        });

        assert.equal(requestedUrl, "/api/digital-assets/");
        assert.equal(requestedMethod, "POST");
        const parsed = JSON.parse(requestedBody);
        assert.deepEqual(parsed, {
            asset_type: "text",
            title: "存入的文本",
            content: "正文内容",
            tags: ["画布"],
        });
        assert.equal(asset.id, 102);
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.getState().clearSession();
    }
});

test("createDigitalAsset 正确发送图片资产 POST 载荷并返回资产", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    setupHostAuth();

    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method || "GET";
        requestedBody = String(init?.body || "");
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: {
                    id: 103,
                    user_id: 1,
                    asset_type: "image",
                    title: "画布图片",
                    content: "风景提示词",
                    image_id: "img-storage-key-1",
                    image: {
                        id: "img-storage-key-1",
                        url: "https://example.com/asset.png",
                        width: 1024,
                        height: 1024,
                        mime_type: "image/png",
                    },
                    is_favorite: false,
                    created_at: 1726000000,
                    updated_at: 1726000000,
                    tags: [{ id: 1, user_id: 1, name: "画布", created_at: 1726000000, updated_at: 1726000000 }],
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const asset = await createDigitalAsset({
            asset_type: "image",
            image_id: "img-storage-key-1",
            title: "画布图片",
            content: "风景提示词",
            tags: ["画布"],
        });

        assert.equal(requestedUrl, "/api/digital-assets/");
        assert.equal(requestedMethod, "POST");
        const parsed = JSON.parse(requestedBody);
        assert.deepEqual(parsed, {
            asset_type: "image",
            image_id: "img-storage-key-1",
            title: "画布图片",
            content: "风景提示词",
            tags: ["画布"],
        });
        assert.equal(asset.id, 103);
        assert.equal(asset.asset_type, "image");
        assert.equal(asset.image?.url, "https://example.com/asset.png");
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.getState().clearSession();
    }
});

test("deleteDigitalAsset 发起指定 ID 的 DELETE 请求", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    setupHostAuth();

    let requestedUrl = "";
    let requestedMethod = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method || "GET";
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        await deleteDigitalAsset(102);
        assert.equal(requestedUrl, "/api/digital-assets/102");
        assert.equal(requestedMethod, "DELETE");
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.getState().clearSession();
    }
});
