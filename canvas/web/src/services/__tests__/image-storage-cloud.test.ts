import { test } from "node:test";
import assert from "node:assert/strict";
import { useUserStore } from "@/stores/use-user-store";
import { uploadImage } from "../image-storage";

test("canvas image storage: 上传 Blob 到后端 /api/images 并返回云端 UUID 作为 storageKey", async () => {
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;

    useUserStore.setState({ user: { id: "100", username: "test-user", displayName: "Test User", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: "100" }),
                getAuthHeaders: async () => ({ Authorization: "Bearer canvas-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    let sentUrl = "";
    let sentMethod = "";
    let sentHeaders: Record<string, string> = {};
    let sentFormData: unknown = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        sentUrl = String(input);
        sentMethod = init?.method || "GET";
        sentHeaders = (init?.headers as Record<string, string>) || {};
        sentFormData = init?.body;

        return new Response(
            JSON.stringify({
                success: true,
                data: {
                    id: "uuid-img-12345",
                    url: "https://s3.example.com/images/100/uuid-img-12345.png",
                    width: 800,
                    height: 600,
                    bytes: 1024,
                    mime_type: "image/png",
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const blob = new Blob(["fake-image-binary"], { type: "image/png" });
        const result = await uploadImage(blob);

        assert.equal(sentUrl, "/api/images");
        assert.equal(sentMethod, "POST");
        assert.equal(sentHeaders.Authorization, "Bearer canvas-token");
        assert.ok(sentFormData && sentFormData instanceof FormData);
        assert.ok(sentFormData.get("file") instanceof Blob);

        assert.equal(result.storageKey, "uuid-img-12345");
        assert.equal(result.url, "https://s3.example.com/images/100/uuid-img-12345.png");
        assert.equal(result.width, 800);
        assert.equal(result.height, 600);
        assert.equal(result.bytes, 1024);
        assert.equal(result.mimeType, "image/png");
    } finally {
        globalThis.window = originalWindow;
        globalThis.fetch = originalFetch;
    }
});

test("canvas image storage: 当服务端返回错误时抛出异常且不生成假身份", async () => {
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;

    useUserStore.setState({ user: { id: "100", username: "test-user", displayName: "Test User", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: "100" }),
                getAuthHeaders: async () => ({ Authorization: "Bearer canvas-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    globalThis.fetch = (async () => {
        return new Response(
            JSON.stringify({
                success: false,
                message: "无效或损坏的图片文件",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const blob = new Blob(["invalid-text"], { type: "text/plain" });
        await assert.rejects(async () => {
            await uploadImage(blob);
        }, /无效或损坏的图片文件/);
    } finally {
        globalThis.window = originalWindow;
        globalThis.fetch = originalFetch;
    }
});
