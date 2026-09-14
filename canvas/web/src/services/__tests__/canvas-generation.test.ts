import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { defaultConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { defaultImageEditSettings } from "@/lib/canvas/image-models";
import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";

test("生成通过宿主认证调用本站，一次请求保留全部返回图片", async () => {
    const fetchBefore = globalThis.fetch;
    const postBefore = axios.post;
    const windowBefore = globalThis.window;
    let account = "901";
    useUserStore.setState({ user: { id: account, username: "test", displayName: "", avatarUrl: "" } });
    globalThis.window = { parent: { newApiCanvasHost: { getUser: () => ({ id: account }), getAuthHeaders: async () => ({ Authorization: "Bearer session", Secret: "must-not-forward" }), subscribe: () => () => {} } } } as unknown as Window &
        typeof globalThis;
    globalThis.fetch = (async (url, init) => {
        assert.equal(url, "/api/user/models");
        assert.deepEqual(init?.headers, { Authorization: "Bearer session" });
        return new Response(JSON.stringify({ success: true, data: ["gpt-image-2"] }));
    }) as typeof fetch;
    let posts = 0;
    const controller = new AbortController();
    axios.post = (async (url: unknown, body: unknown, options: unknown) => {
        posts++;
        assert.equal(url, "/api/canvas/images/generations");
        assert.deepEqual(body, { model: "gpt-image-2", prompt: "poster", size: "1:3 2k", quality: "low", n: 4, response_format: "b64_json", output_format: "png" });
        assert.deepEqual(options, { headers: { Authorization: "Bearer session" }, signal: controller.signal });
        return {
            data: {
                success: true,
                data: [
                    { id: "gen-1", url: "https://example.test/image1.png", width: 800, height: 600, bytes: 1000, mime_type: "image/png" },
                    { id: "gen-2", url: "https://example.test/image2.png", width: 800, height: 600, bytes: 2000, mime_type: "image/png" },
                ],
            },
        };
    }) as typeof axios.post;
    try {
        const settings = { ...defaultConfig, resolution: "2k", aspectRatio: "1:3", count: "4", apiKey: "legacy", baseUrl: "https://invalid.example", models: ["gpt-image-2"] };
        const images = await requestGeneration(settings, "poster", { signal: controller.signal });
        assert.deepEqual(
            images.map((image) => image.url),
            ["https://example.test/image1.png", "https://example.test/image2.png"],
        );
        assert.deepEqual(
            images.map((image) => image.storageKey),
            ["gen-1", "gen-2"],
        );
        assert.equal(posts, 1);
        assert.notEqual(images[0].id, images[1].id);
        for (const payload of [{ data: [] }, { data: [null] }, { error: { message: "quota exhausted" } }, "not-json"]) {
            axios.post = (async () => ({ data: payload })) as typeof axios.post;
            await assert.rejects(requestGeneration(settings, "poster"));
        }
        const lateController = new AbortController();
        axios.post = (async () => {
            lateController.abort();
            return { data: { success: true, data: [{ id: "gen-3", url: "https://example.test/image3.png", width: 100, height: 100, bytes: 10, mime_type: "image/png" }] } };
        }) as typeof axios.post;
        await assert.rejects(requestGeneration(settings, "poster", { signal: lateController.signal }), { name: "AbortError" });
        controller.abort();
        await assert.rejects(requestGeneration(settings, "poster", { signal: controller.signal }), { name: "AbortError" });
        assert.equal(posts, 1);
        account = "902";
        await assert.rejects(requestGeneration(settings, "poster"), /登录会话已失效/);
        assert.equal(posts, 1);
    } finally {
        globalThis.fetch = fetchBefore;
        axios.post = postBefore;
        globalThis.window = windowBefore;
        useUserStore.setState({ user: null });
    }
});

test("M8 编辑请求通过宿主认证调用 /api/canvas/images/edits，组装表单且失败不降级", async () => {
    const fetchBefore = globalThis.fetch;
    const postBefore = axios.post;
    const windowBefore = globalThis.window;
    const account = "901";
    useUserStore.setState({ user: { id: account, username: "test", displayName: "", avatarUrl: "" } });
    globalThis.window = { parent: { newApiCanvasHost: { getUser: () => ({ id: account }), getAuthHeaders: async () => ({ Authorization: "Bearer session" }), subscribe: () => () => {} } } } as unknown as Window & typeof globalThis;

    globalThis.fetch = (async (url) => {
        if (url === "/api/user/models") {
            return new Response(JSON.stringify({ success: true, data: ["gpt-image-2"] }));
        }
        if (typeof url === "string" && url.includes("ref-ok.png")) {
            return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "content-type": "image/png" } });
        }
        return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    let editPosts = 0;
    let postedFormData: FormData | null = null;
    axios.post = (async (url: unknown, body: unknown, options: unknown) => {
        editPosts++;
        assert.equal(url, "/api/canvas/images/edits");
        postedFormData = body as FormData;
        return {
            data: {
                success: true,
                data: [{ id: "edit-1", url: "https://example.test/edited.png", width: 512, height: 512, bytes: 5000, mime_type: "image/png" }],
            },
        };
    }) as typeof axios.post;

    try {
        const settings = { ...defaultConfig, ...defaultImageEditSettings, models: ["gpt-image-2"], apiKey: "legacy", baseUrl: "https://invalid.example" };
        const refImage = { id: "ref-1", name: "ref-ok.png", type: "image/png", dataUrl: "https://example.test/ref-ok.png", url: "https://example.test/ref-ok.png", storageKey: "ref-uuid-1" };

        const images = await requestEdit(settings, "make it cyber", [refImage]);
        assert.equal(editPosts, 1);
        assert.equal(images.length, 1);
        assert.equal(images[0].url, "https://example.test/edited.png");
        assert.equal(images[0].storageKey, "edit-1");

        assert.ok(postedFormData);
        const form = postedFormData as FormData;
        assert.equal(form.get("model"), "gpt-image-2");
        assert.equal(form.get("size"), "auto 1k");
        assert.ok((form.get("prompt") as string).includes("make it cyber"));
        assert.ok((form.get("prompt") as string).includes("参考图片编号"));

        // 参考图拉取失败时严格阻断，绝不调用出图接口
        const badRefImage = { id: "ref-bad", name: "bad.png", type: "image/png", dataUrl: "https://example.test/ref-bad.png", url: "https://example.test/ref-bad.png" };
        await assert.rejects(() => requestEdit(settings, "make it cyber", [badRefImage]), /参考图读取失败/);
        assert.equal(editPosts, 1, "参考图拉取失败不得发起接口调用");
    } finally {
        globalThis.fetch = fetchBefore;
        axios.post = postBefore;
        globalThis.window = windowBefore;
        useUserStore.setState({ user: null });
    }
});

test("M9 辅助文本调用通过宿主认证直连 /v1/chat/completions 流式输出，校验受控模型与 SSE 解析", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    let account = "909";
    useUserStore.setState({ user: { id: account, username: "test-m9", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: account }),
                getAuthHeaders: async () => ({ Authorization: "Bearer session-token-m9" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    let chatCalls = 0;
    let postedBody: any = null;
    let postedHeaders: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr === "/api/user/models") {
            return new Response(JSON.stringify({ success: true, data: ["gpt-5.6-terra", "gpt-image-2"] }));
        }
        if (urlStr === "/v1/chat/completions") {
            chatCalls++;
            postedHeaders = init?.headers;
            postedBody = JSON.parse(String(init?.body || "{}"));

            const sseStream = new ReadableStream({
                start(controller) {
                    const chunks = [
                        'data: {"choices":[{"delta":{"content":"赛博"}}]}\n\n',
                        'data: {"choices":[{"delta":{"content":"猫咪"}}]}\n\n',
                        'data: {"choices":[{"delta":{"content":"特写"}}]}\n\n',
                        "data: [DONE]\n\n",
                    ];
                    for (const chunk of chunks) {
                        controller.enqueue(new TextEncoder().encode(chunk));
                    }
                    controller.close();
                },
            });
            return new Response(sseStream, {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
            });
        }
        return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    try {
        const deltas: string[] = [];
        const result = await requestImageQuestion(
            defaultConfig,
            [{ role: "user", content: "赛博猫咪" }],
            (delta) => deltas.push(delta),
        );
        assert.equal(chatCalls, 1);
        assert.equal(postedHeaders.Authorization, "Bearer session-token-m9");
        assert.equal(postedBody.model, "gpt-5.6-terra");
        assert.equal(postedBody.stream, true);
        assert.deepEqual(postedBody.messages, [{ role: "user", content: "赛博猫咪" }]);
        assert.deepEqual(deltas, ["赛博", "赛博猫咪", "赛博猫咪特写"]);
        assert.equal(result, "赛博猫咪特写");

        // 402 额度不足异常抛出
        globalThis.fetch = (async (url: string | URL | Request) => {
            if (String(url) === "/api/user/models") {
                return new Response(JSON.stringify({ success: true, data: ["gpt-5.6-terra"] }));
            }
            if (String(url) === "/v1/chat/completions") {
                return new Response(JSON.stringify({ error: { message: "用户额度不足" } }), { status: 402, headers: { "Content-Type": "application/json" } });
            }
            return new Response("Not Found", { status: 404 });
        }) as typeof fetch;

        await assert.rejects(
            () => requestImageQuestion(defaultConfig, [{ role: "user", content: "test" }], () => {}),
            /用户额度不足/,
        );

        // 模型未分配权限时拒绝
        globalThis.fetch = (async (url: string | URL | Request) => {
            if (String(url) === "/api/user/models") {
                return new Response(JSON.stringify({ success: true, data: ["other-model"] }));
            }
            return new Response("Not Found", { status: 404 });
        }) as typeof fetch;

        await assert.rejects(
            () => requestImageQuestion(defaultConfig, [{ role: "user", content: "test" }], () => {}),
            /gpt-5.6-terra/,
        );

        // AbortSignal 中止测试
        const abortCtrl = new AbortController();
        abortCtrl.abort();
        await assert.rejects(
            () => requestImageQuestion(defaultConfig, [{ role: "user", content: "test" }], () => {}, { signal: abortCtrl.signal }),
            { name: "AbortError" },
        );
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        useUserStore.setState({ user: null });
    }
});

test("多协议服务端分流：nano-banana-2 路由至 Gemini 端点，grok 路由至 OpenAI 端点，且支持安全审查拦截提示", async () => {
    const fetchBefore = globalThis.fetch;
    const postBefore = axios.post;
    const windowBefore = globalThis.window;
    const account = "903";
    useUserStore.setState({ user: { id: account, username: "test-multimodel", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: account }),
                getAuthHeaders: async () => ({ Authorization: "Bearer session-token-multi" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;

    globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr === "/api/user/models") {
            return new Response(JSON.stringify({ success: true, data: ["nano-banana-2", "nano-banana-2-lite", "grok-imagine-image-2.0", "gpt-image-2"] }));
        }
        return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    let postedUrl = "";
    let postedBody: any = null;
    let postedHeaders: any = null;

    axios.post = (async (url: unknown, body: unknown, options: unknown) => {
        postedUrl = String(url);
        postedBody = body;
        postedHeaders = (options as any)?.headers;
        return {
            data: {
                success: true,
                data: [{ id: "res-gemini-1", url: "https://example.test/gemini-out.png", width: 1024, height: 1024, bytes: 5000, mime_type: "image/png" }],
            },
        };
    }) as typeof axios.post;

    try {
        // 1. nano-banana-2 文生图调用 -> /api/canvas/images/gemini/models/nano-banana-2:generateContent
        const bananaConfig = {
            ...defaultConfig,
            model: "nano-banana-2",
            resolution: "2k",
            aspectRatio: "16:9",
            quality: "",
            count: "1",
            models: ["nano-banana-2"],
        };
        const bananaResult = await requestGeneration(bananaConfig, "banana in space");
        assert.equal(postedUrl, "/api/canvas/images/gemini/models/nano-banana-2:generateContent");
        assert.equal(postedHeaders?.Authorization, "Bearer session-token-multi");
        assert.deepEqual(postedBody.contents, [{ parts: [{ text: "banana in space" }] }]);
        assert.deepEqual(postedBody.generationConfig, {
            responseModalities: ["IMAGE"],
            imageConfig: {
                aspectRatio: "16:9",
                imageSize: "2K",
            },
        });
        assert.equal(bananaResult[0].url, "https://example.test/gemini-out.png");
        assert.equal(bananaResult[0].storageKey, "res-gemini-1");

        // 2. nano-banana-2 图生图编辑调用 -> 组装多图 parts 并在 Gemini 端点调用
        const refImage1 = { id: "ref-b1", name: "b1.png", type: "image/png", dataUrl: "data:image/png;base64,QUJDRA==", storageKey: "ref-b1" };
        const refImage2 = { id: "ref-b2", name: "b2.png", type: "image/png", dataUrl: "data:image/png;base64,RUZHSA==", storageKey: "ref-b2" };
        const bananaEditResult = await requestEdit(
            { ...bananaConfig, aspectRatio: "auto" },
            "blend two images",
            [refImage1, refImage2],
        );
        assert.equal(postedUrl, "/api/canvas/images/gemini/models/nano-banana-2:generateContent");
        assert.equal(postedBody.contents[0].parts.length, 3);
        assert.ok(postedBody.contents[0].parts[0].text.includes("blend two images"));
        assert.ok(postedBody.contents[0].parts[0].text.includes("图片1"));
        assert.deepEqual(postedBody.contents[0].parts[1], { inlineData: { mimeType: "image/png", data: "QUJDRA==" } });
        assert.deepEqual(postedBody.contents[0].parts[2], { inlineData: { mimeType: "image/png", data: "RUZHSA==" } });
        assert.equal(bananaEditResult.length, 1);

        // 3. grok-imagine-image-2.0 调用 -> /api/canvas/images/generations
        const grokConfig = {
            ...defaultConfig,
            model: "grok-imagine-image-2.0",
            resolution: "2k",
            aspectRatio: "16:9",
            quality: "medium",
            count: "5",
            models: ["grok-imagine-image-2.0"],
        };
        await requestGeneration(grokConfig, "grok art");
        assert.equal(postedUrl, "/api/canvas/images/generations");
        assert.equal(postedBody.model, "grok-imagine-image-2.0");
        assert.equal(postedBody.n, 5);
        assert.equal(postedBody.quality, "medium");
        assert.equal(postedBody.output_format, undefined);

        // 3.1 grok-imagine-image-2.0 图生图编辑调用 -> /api/canvas/images/edits
        // FormData 中严禁包含 output_format 和 quality
        await requestEdit(
            { ...grokConfig, aspectRatio: "auto", quality: "" },
            "grok edit",
            [refImage1],
        );
        assert.equal(postedUrl, "/api/canvas/images/edits");
        assert.ok(postedBody instanceof FormData);
        assert.equal((postedBody as FormData).get("model"), "grok-imagine-image-2.0");
        assert.equal((postedBody as FormData).get("output_format"), null);
        assert.equal((postedBody as FormData).get("quality"), null);

        // 4. Gemini 上游安全审查拦截拦截（返回 promptFeedback.blockReason）
        axios.post = (async () => ({
            data: {
                promptFeedback: { blockReason: "SAFETY" },
            },
        })) as typeof axios.post;

        await assert.rejects(
            () => requestGeneration(bananaConfig, "sensitive prompt"),
            /安全审查拦截：SAFETY/,
        );

        // 5. Gemini 候选回复文本拒绝（candidates finishReason SAFETY）
        axios.post = (async () => ({
            data: {
                candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "无法生成包含敏感信息的图片" }] } }],
            },
        })) as typeof axios.post;

        await assert.rejects(
            () => requestGeneration(bananaConfig, "sensitive prompt 2"),
            /无法生成包含敏感信息的图片/,
        );
    } finally {
        globalThis.fetch = fetchBefore;
        axios.post = postBefore;
        globalThis.window = windowBefore;
        useUserStore.setState({ user: null });
    }
});

