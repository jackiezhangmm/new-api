import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { defaultConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { createVideoGenerationTask, pollVideoGenerationTask } from "@/services/api/video";

test("createVideoGenerationTask 序列化 JSON 载荷并通过会话头调用 /v1/videos", async () => {
    const postBefore = axios.post;
    let account = "902";
    useUserStore.setState({ user: { id: account, username: "test", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: account }),
                getAuthHeaders: async () => ({ Authorization: "Bearer test-session-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    let calledUrl = "";
    let calledBody: any = null;
    let calledHeaders: any = null;

    axios.post = (async (url: string, body: any, options: any) => {
        calledUrl = url;
        calledBody = body;
        calledHeaders = options?.headers;
        return { data: { id: "video-task-123" } };
    }) as typeof axios.post;

    try {
        const config = {
            ...defaultConfig,
            model: "minimax_h3_zm_u24",
            videoSeconds: "5",
            vquality: "768",
        };
        const task = await createVideoGenerationTask(config, "draw a river", [
            { id: "img-1", name: "ref.png", type: "image/png", dataUrl: "https://example.com/ref.png" },
        ]);

        assert.equal(task.id, "video-task-123");
        assert.equal(task.provider, "openai");
        assert.equal(task.model, "minimax_h3_zm_u24");
        assert.equal(calledUrl, "/v1/videos");
        assert.equal(calledHeaders?.Authorization, "Bearer test-session-token");
        assert.equal(calledBody?.model, "minimax_h3_zm_u24");
        assert.equal(calledBody?.prompt, "draw a river");
        assert.equal(calledBody?.image, "https://example.com/ref.png");
        assert.equal(calledBody?.duration, 5);
        assert.equal(calledBody?.metadata?.resolution, "768p");

        // Missing reference image rejects
        await assert.rejects(
            () => createVideoGenerationTask(config, "no ref image", []),
            /必须提供至少一张参考图片/,
        );

        // Invalid duration rejects
        await assert.rejects(
            () =>
                createVideoGenerationTask(
                    { ...config, videoSeconds: "20" },
                    "duration out of bounds",
                    [{ id: "img-1", name: "ref.png", type: "image/png", dataUrl: "https://example.com/ref.png" }],
                ),
            /秒数/,
        );
    } finally {
        axios.post = postBefore;
    }
});

test("pollVideoGenerationTask 通过会话头轮询 /v1/videos/:id 并返回结果", async () => {
    const getBefore = axios.get;
    let account = "902";
    useUserStore.setState({ user: { id: account, username: "test", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: account }),
                getAuthHeaders: async () => ({ Authorization: "Bearer test-session-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    let queriedUrl = "";
    axios.get = (async (url: string) => {
        queriedUrl = url;
        if (url.includes("/content")) {
            return { data: new Blob(["fake-mp4"], { type: "video/mp4" }) };
        }
        return {
            data: {
                id: "video-task-123",
                status: "completed",
                video_url: "https://example.com/output.mp4",
            },
        };
    }) as typeof axios.get;

    try {
        const config = { ...defaultConfig, model: "minimax_h3_zm_u24" };
        const task = { id: "video-task-123", provider: "openai" as const, model: "minimax_h3_zm_u24" };
        const state = await pollVideoGenerationTask(config, task);
        assert.equal(state.status, "completed");
        assert.equal(queriedUrl, "https://example.com/output.mp4");
    } finally {
        axios.get = getBefore;
    }
});

test("AbortSignal 触发时中断视频生成与轮询", async () => {
    const postBefore = axios.post;
    let account = "902";
    useUserStore.setState({ user: { id: account, username: "test", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: account }),
                getAuthHeaders: async () => ({ Authorization: "Bearer test-session-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    axios.post = (async (_url: string, _body: any, options: any) => {
        if (options?.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        return new Promise((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
            });
        });
    }) as typeof axios.post;

    try {
        const controller = new AbortController();
        const config = { ...defaultConfig, model: "minimax_h3_zm_u24" };
        const promise = createVideoGenerationTask(
            config,
            "aborted prompt",
            [{ id: "img-1", name: "ref.png", type: "image/png", dataUrl: "https://example.com/ref.png" }],
            { signal: controller.signal },
        );
        controller.abort();
        await assert.rejects(promise, (err: any) => err.name === "AbortError" || /Aborted|取消/.test(err.message));
    } finally {
        axios.post = postBefore;
    }
});
