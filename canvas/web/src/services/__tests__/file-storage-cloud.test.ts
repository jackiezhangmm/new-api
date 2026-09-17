import { test } from "node:test";
import assert from "node:assert/strict";
import { useUserStore } from "@/stores/use-user-store";
import { uploadMediaFile, resolveMediaUrl } from "../file-storage";

test("canvas media storage: 上传视频/音频 Blob 到后端 /api/media 并返回云端 URL 与 ID", async () => {
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
                    id: "uuid-media-12345",
                    url: "https://s3.example.com/media/100/uuid-media-12345.mp4",
                    bytes: 1048576,
                    mime_type: "video/mp4",
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const blob = new Blob(["fake-video-binary"], { type: "video/mp4" });
        const result = await uploadMediaFile(blob, "video");

        assert.equal(sentUrl, "/api/media");
        assert.equal(sentMethod, "POST");
        assert.equal(sentHeaders.Authorization, "Bearer canvas-token");
        assert.ok(sentFormData && sentFormData instanceof FormData);
        assert.ok(sentFormData.get("file") instanceof Blob);

        assert.equal(result.storageKey, "uuid-media-12345");
        assert.equal(result.url, "https://s3.example.com/media/100/uuid-media-12345.mp4");
        assert.equal(result.bytes, 1048576);
        assert.equal(result.mimeType, "video/mp4");
    } finally {
        globalThis.window = originalWindow;
        globalThis.fetch = originalFetch;
    }
});

test("canvas media storage: resolveMediaUrl 直接返回合法网络/相对路径，不依赖本地 IndexedDB", async () => {
    const s3Url = "https://s3.example.com/media/100/vid.mp4";
    assert.equal(await resolveMediaUrl(s3Url, ""), s3Url);

    const relativeUrl = "/v1/videos/task-123/content";
    assert.equal(await resolveMediaUrl(relativeUrl, ""), relativeUrl);

    const fallback = "/v1/videos/task-fallback/content";
    assert.equal(await resolveMediaUrl("", fallback), fallback);
});
