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
            size: "16:9",
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
        assert.equal(calledBody?.metadata?.resolution, "768p横");

        // 竖屏与 1:1 尺寸正确映射为 768p竖 / 480p1:1
        await createVideoGenerationTask({ ...config, size: "9:16" }, "vertical", [
            { id: "img-1", name: "ref.png", type: "image/png", dataUrl: "https://example.com/ref.png" },
        ]);
        assert.equal(calledBody?.metadata?.resolution, "768p竖");

        await createVideoGenerationTask({ ...config, size: "1:1", vquality: "480" }, "square", [
            { id: "img-1", name: "ref.png", type: "image/png", dataUrl: "https://example.com/ref.png" },
        ]);
        assert.equal(calledBody?.metadata?.resolution, "480p1:1");

        // 传入音频时正确序列化至 payload 与 metadata.ref_audio_*
        await createVideoGenerationTask(
            config,
            "with audio",
            [{ id: "img-1", name: "ref.png", type: "image/png", dataUrl: "https://example.com/ref.png" }],
            {
                audios: [
                    { id: "aud-1", name: "bgm.mp3", type: "audio/mpeg", url: "https://example.com/bgm.mp3" },
                    { id: "aud-2", name: "vocal.mp3", type: "audio/mpeg", url: "https://example.com/vocal.mp3", storageKey: "https://example.com/vocal.mp3" },
                ],
            },
        );
        assert.equal(calledBody?.audio, "https://example.com/bgm.mp3");
        assert.equal(calledBody?.audio_url, "https://example.com/bgm.mp3");
        assert.equal(calledBody?.metadata?.ref_audio_0, "https://example.com/bgm.mp3");
        assert.equal(calledBody?.metadata?.ref_audio_1, "https://example.com/vocal.mp3");

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

test("createVideoGenerationTask Wan3.0 协议分流、拓扑推导与顶级载荷序列化", async () => {
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

    let calledBody: any = null;
    axios.post = (async (_url: string, body: any) => {
        calledBody = body;
        return { data: { id: "wan-task-001" } };
    }) as typeof axios.post;

    try {
        const wanConfig = {
            ...defaultConfig,
            model: "wan3.0-video",
            videoSeconds: "6",
            vquality: "1080",
            size: "16:9",
            negativePrompt: "lowres, artifacts",
            videoGenerateAudio: "true",
        };

        // 1. 文生视频（0 张图片）
        const task1 = await createVideoGenerationTask(wanConfig, "cyberpunk city street", []);
        assert.equal(task1.id, "wan-task-001");
        assert.equal(task1.provider, "openai");
        assert.equal(task1.model, "wan3.0-video");
        assert.equal(calledBody.model, "wan3.0-video");
        assert.equal(calledBody.prompt, "cyberpunk city street");
        assert.equal(calledBody.negative_prompt, "lowres, artifacts");
        assert.equal(calledBody.resolution, "1080P");
        assert.equal(calledBody.size, "16:9");
        assert.equal(calledBody.duration, 6);
        assert.equal(calledBody.audio, true);
        assert.equal(calledBody.image, undefined);
        assert.equal(calledBody.image_with_roles, undefined);
        assert.equal(calledBody.image_urls, undefined);

        // 文生视频下无提示词应被拦截
        await assert.rejects(
            () => createVideoGenerationTask(wanConfig, "   ", []),
            /提示词/,
        );

        // 2. 单图图生视频（推导为首帧）且留空提示词允许生成
        await createVideoGenerationTask(wanConfig, "", [
            { id: "img-1", name: "1.png", type: "image/png", dataUrl: "https://example.com/1.png" },
        ]);
        assert.equal(calledBody.prompt, "");
        assert.equal(calledBody.generation_type, "frame");
        assert.deepEqual(calledBody.image_with_roles, [{ url: "https://example.com/1.png", role: "first_frame" }]);
        assert.deepEqual(calledBody.image_urls, ["https://example.com/1.png"]);

        // 3. 双图默认推导为首尾帧模式
        await createVideoGenerationTask(wanConfig, "smooth transition", [
            { id: "img-1", name: "1.png", type: "image/png", dataUrl: "https://example.com/1.png" },
            { id: "img-2", name: "2.png", type: "image/png", dataUrl: "https://example.com/2.png" },
        ]);
        assert.equal(calledBody.generation_type, "frame");
        assert.deepEqual(calledBody.image_with_roles, [
            { url: "https://example.com/1.png", role: "first_frame" },
            { url: "https://example.com/2.png", role: "last_frame" },
        ]);

        // 4. 双图在显式 reference 模式下推导为参考图模式
        await createVideoGenerationTask({ ...wanConfig, videoMode: "reference" }, "reference style", [
            { id: "img-1", name: "1.png", type: "image/png", dataUrl: "https://example.com/1.png" },
            { id: "img-2", name: "2.png", type: "image/png", dataUrl: "https://example.com/2.png" },
        ]);
        assert.equal(calledBody.generation_type, "reference");
        assert.deepEqual(calledBody.image_urls, ["https://example.com/1.png", "https://example.com/2.png"]);
        assert.equal(calledBody.image_with_roles, undefined);

        // 5. 三图自动推导为参考图模式，连入外部音频时禁用伴生音频并写入 audio_urls
        await createVideoGenerationTask(
            wanConfig,
            "multi reference with audio",
            [
                { id: "img-1", name: "1.png", type: "image/png", dataUrl: "https://example.com/1.png" },
                { id: "img-2", name: "2.png", type: "image/png", dataUrl: "https://example.com/2.png" },
                { id: "img-3", name: "3.png", type: "image/png", dataUrl: "https://example.com/3.png" },
            ],
            {
                audios: [
                    { id: "aud-1", name: "sound.mp3", type: "audio/mpeg", url: "https://example.com/sound.mp3" },
                ],
            },
        );
        assert.equal(calledBody.generation_type, "reference");
        assert.deepEqual(calledBody.image_urls, ["https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png"]);
        assert.deepEqual(calledBody.audio_urls, ["https://example.com/sound.mp3"]);
        assert.equal(calledBody.audio_url, "https://example.com/sound.mp3");
        assert.equal(calledBody.audio, false);
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
        const config = { ...defaultConfig, model: "minimax_h3_zm_u24", vquality: "768", size: "16:9", videoSeconds: "5" };
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
