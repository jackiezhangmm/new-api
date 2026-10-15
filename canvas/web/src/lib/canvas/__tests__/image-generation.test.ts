import { test } from "node:test";
import assert from "node:assert/strict";
import { runCanvasImageGeneration, runCanvasTextGeneration } from "../image-generation";
import {
    hasResumableMjTask,
    hasResumableVideoTask,
    hasResumableTask,
    hasUnresumableInFlightTask,
    resetInterruptedGeneration,
} from "../canvas-generation-helpers";
import { buildNodeResponseMessages } from "@/components/canvas/canvas-node-generation";
import { MIDJOURNEY_POLISH_TEMPLATE } from "@/services/api/prompts";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("一次多图生成保留执行期间的节点修改，不自动补图", async () => {
    let nodes: CanvasNodeData[] = [{ id: "source", type: CanvasNodeType.Image, title: "original", position: { x: 1, y: 2 }, width: 340, height: 240, metadata: {} }];
    let complete!: (images: { id: string; dataUrl: string }[]) => void;
    const response = new Promise<{ id: string; dataUrl: string }[]>((resolve) => {
        complete = resolve;
    });
    let calls = 0;
    const running = runCanvasImageGeneration(
        {
            sourceId: "source",
            prompt: "poster",
            config: { ...defaultConfig, models: ["gpt-image-2"], count: "4" },
            signal: new AbortController().signal,
            getNodes: () => nodes,
            setNodes: (update) => {
                nodes = update(nodes);
            },
            addConnection: () => {},
        },
        {
            generate: async (config) => {
                calls++;
                assert.equal(config.count, "4");
                return response;
            },
            store: async (url) => {
                assert.equal(typeof url, "string");
                return { url: url as string, width: 100, height: 100, bytes: 10, mimeType: "image/png" };
            },
        },
    );
    nodes = nodes.map((node) => ({ ...node, title: "edited", position: { x: 400, y: 500 } }));
    complete([
        { id: "one", dataUrl: "one" },
        { id: "two", dataUrl: "two" },
    ]);
    const result = await running;
    assert.equal(calls, 1);
    assert.equal(result.received, 2);
    assert.equal(nodes[0].title, "edited");
    assert.deepEqual(nodes[0].position, { x: 400, y: 500 });
    assert.equal(nodes[0].metadata?.images?.length, 2);
    assert.equal(nodes[0].metadata?.status, "success");
});

test("停止后即使请求晚到也不回写，删除目标不会重新插入", async () => {
    for (const cancel of [true, false]) {
        let nodes: CanvasNodeData[] = [{ id: "source", type: CanvasNodeType.Image, title: "original", position: { x: 1, y: 2 }, width: 340, height: 240, metadata: {} }];
        let complete!: (images: { id: string; dataUrl: string }[]) => void;
        const response = new Promise<{ id: string; dataUrl: string }[]>((resolve) => {
            complete = resolve;
        });
        const controller = new AbortController();
        const running = runCanvasImageGeneration(
            {
                sourceId: "source",
                prompt: "poster",
                config: { ...defaultConfig, models: ["gpt-image-2"] },
                signal: controller.signal,
                getNodes: () => nodes,
                setNodes: (update) => {
                    nodes = update(nodes);
                },
                addConnection: () => {},
            },
            {
                generate: () => response,
                store: async () => {
                    throw new Error("不得读取已作废结果");
                },
            },
        );
        if (cancel) controller.abort();
        else nodes = [];
        complete([{ id: "late", dataUrl: "late" }]);
        await assert.rejects(running, { name: "AbortError" });
        assert.equal(nodes[0]?.metadata?.content, undefined);
        if (!cancel) assert.equal(nodes.length, 0);
    }
});

test("同一节点请求替换后旧结果不能覆盖新结果", async () => {
    let nodes: CanvasNodeData[] = [{ id: "source", type: CanvasNodeType.Image, title: "original", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: {} }];
    let completeOld!: (images: { id: string; dataUrl: string }[]) => void;
    const oldResponse = new Promise<{ id: string; dataUrl: string }[]>((resolve) => {
        completeOld = resolve;
    });
    const run = {
        sourceId: "source",
        prompt: "poster",
        config: { ...defaultConfig, models: ["gpt-image-2"] },
        signal: new AbortController().signal,
        getNodes: () => nodes,
        setNodes: (update: (value: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodes = update(nodes);
        },
        addConnection: () => {},
    };
    const old = runCanvasImageGeneration(run, {
        generate: () => oldResponse,
        store: async () => {
            throw new Error("不得读取已替换结果");
        },
    });
    await runCanvasImageGeneration(run, { generate: async () => [{ id: "new", dataUrl: "new" }], store: async () => ({ url: "new", width: 100, height: 100, bytes: 10, mimeType: "image/png" }) });
    completeOld([{ id: "old", dataUrl: "old" }]);
    await assert.rejects(old, { name: "AbortError" });
    assert.equal(nodes[0].metadata?.content, "new");
    assert.equal(nodes[0].metadata?.status, "success");
});

test("单图重试保留其他图片、批次数量和主图，失败后允许明确重试", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "source",
            type: CanvasNodeType.Image,
            title: "original",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "one",
                count: 2,
                primaryImageId: "one",
                generationType: "generation",
                images: [
                    { id: "one", content: "one", status: "success", naturalWidth: 100, naturalHeight: 100, bytes: 10, mimeType: "image/png" },
                    { id: "two", content: "", status: "error", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" },
                ],
            },
        },
    ];
    const run = {
        sourceId: "source",
        prompt: "poster",
        config: { ...defaultConfig, models: ["gpt-image-2"] },
        retry: { imageId: "two" },
        signal: new AbortController().signal,
        getNodes: () => nodes,
        setNodes: (update: (value: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodes = update(nodes);
        },
        addConnection: () => {},
    };
    await assert.rejects(
        runCanvasImageGeneration(run, {
            generate: async () => {
                throw new Error("quota exhausted");
            },
            store: async () => {
                throw new Error("不得读取失败结果");
            },
        }),
        /quota exhausted/,
    );
    assert.equal(nodes[0].metadata?.images?.[1].status, "error");
    assert.equal(nodes[0].metadata?.content, "one");
    await runCanvasImageGeneration(run, {
        generate: async (settings) => {
            assert.equal(settings.count, "1");
            return [{ id: "new", dataUrl: "two" }];
        },
        store: async () => ({ url: "two", width: 100, height: 100, bytes: 10, mimeType: "image/png" }),
    });
    assert.equal(nodes[0].metadata?.count, 2);
    assert.equal(nodes[0].metadata?.content, "one");
    assert.equal(nodes[0].metadata?.primaryImageId, "one");
    assert.deepEqual(
        nodes[0].metadata?.images?.map((image) => [image.id, image.content, image.status]),
        [
            ["one", "one", "success"],
            ["two", "two", "success"],
        ],
    );
});

test("已有图像节点原位重新生成，直接覆盖当前节点，不派生新节点与连线", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "source-node",
            type: CanvasNodeType.Image,
            title: "ref image",
            position: { x: 100, y: 100 },
            width: 300,
            height: 200,
            metadata: {
                content: "https://example.com/ref.png",
                storageKey: "ref-uuid-1",
                naturalWidth: 300,
                naturalHeight: 200,
            },
        },
    ];
    let connections: Array<{ sourceId: string; targetId: string }> = [];
    let editCalled = false;
    let generateCalled = false;

    const refImage = {
        id: "source-node",
        name: "ref.png",
        type: "image/png",
        dataUrl: "https://example.com/ref.png",
        storageKey: "ref-uuid-1",
    };

    const run = {
        sourceId: "source-node",
        prompt: "oil painting style",
        config: { ...defaultConfig, models: ["gpt-image-2"], count: "2" },
        signal: new AbortController().signal,
        references: [refImage],
        getNodes: () => nodes,
        setNodes: (update: (value: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodes = update(nodes);
        },
        addConnection: (sourceId: string, targetId: string) => {
            connections.push({ sourceId, targetId });
        },
    };

    const result = await runCanvasImageGeneration(run, {
        generate: async () => {
            generateCalled = true;
            return [];
        },
        edit: async (cfg, prompt, refs) => {
            editCalled = true;
            assert.equal(prompt, "oil painting style");
            assert.equal(refs.length, 1);
            assert.equal(refs[0].storageKey, "ref-uuid-1");
            return [
                { id: "out-1", storageKey: "out-uuid-1", url: "https://example.com/out-1.png", dataUrl: "https://example.com/out-1.png", width: 300, height: 200, bytes: 5000, mimeType: "image/png" },
                { id: "out-2", storageKey: "out-uuid-2", url: "https://example.com/out-2.png", dataUrl: "https://example.com/out-2.png", width: 300, height: 200, bytes: 6000, mimeType: "image/png" },
            ];
        },
        store: async () => ({ url: "", width: 0, height: 0, bytes: 0, mimeType: "" }),
    });

    assert.equal(editCalled, true);
    assert.equal(generateCalled, false);
    assert.equal(result.received, 2);

    // 验证原位重新生成：目标 ID 为源节点本身，不派生新节点，不创建连线
    assert.equal(result.targetId, "source-node");
    assert.equal(nodes.length, 1);
    assert.equal(connections.length, 0);

    // 验证节点在原位被新内容覆写
    const targetNode = nodes[0];
    assert.equal(targetNode.metadata?.generationType, "edit");
    assert.deepEqual(targetNode.metadata?.references, ["ref-uuid-1"]);
    assert.equal(targetNode.metadata?.status, "success");
    assert.equal(targetNode.metadata?.content, "https://example.com/out-1.png");
    assert.equal(targetNode.metadata?.storageKey, "out-uuid-1");
    assert.equal(targetNode.metadata?.images?.length, 2);
    assert.equal(targetNode.metadata?.images?.[0].storageKey, "out-uuid-1");
});

test("Config 节点生成向右派生新节点并建立连线", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "config-node",
            type: CanvasNodeType.Config,
            title: "生成配置",
            position: { x: 100, y: 100 },
            width: 300,
            height: 200,
            metadata: {
                composerContent: "a blue bird",
            },
        },
    ];
    let connections: Array<{ sourceId: string; targetId: string }> = [];

    const run = {
        sourceId: "config-node",
        prompt: "a blue bird",
        config: { ...defaultConfig, models: ["gpt-image-2"], count: "1" },
        signal: new AbortController().signal,
        getNodes: () => nodes,
        setNodes: (update: (value: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodes = update(nodes);
        },
        addConnection: (sourceId: string, targetId: string) => {
            connections.push({ sourceId, targetId });
        },
    };

    const result = await runCanvasImageGeneration(run, {
        generate: async () => [
            { id: "out-1", storageKey: "out-uuid-1", url: "https://example.com/bird.png", dataUrl: "https://example.com/bird.png", width: 300, height: 200, bytes: 5000, mimeType: "image/png" },
        ],
        store: async () => ({ url: "", width: 0, height: 0, bytes: 0, mimeType: "" }),
    });

    assert.notEqual(result.targetId, "config-node");
    assert.equal(nodes.length, 2);
    assert.equal(connections.length, 1);
    assert.equal(connections[0].sourceId, "config-node");
    assert.equal(connections[0].targetId, result.targetId);
});

test("已有文本节点生成原位流式改写当前节点，不派生新节点与连线", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "text-orig",
            type: CanvasNodeType.Text,
            title: "原始文本",
            position: { x: 100, y: 100 },
            width: 340,
            height: 240,
            metadata: {
                content: "一只可爱的赛博猫咪",
                prompt: "一只可爱的赛博猫咪",
                status: "success",
            },
        },
    ];
    let connections: Array<{ sourceId: string; targetId: string }> = [];

    const running = runCanvasTextGeneration(
        {
            sourceId: "text-orig",
            prompt: "扩充细节",
            config: { ...defaultConfig, models: ["gpt-5.6-terra"], model: "gpt-5.6-terra" },
            signal: new AbortController().signal,
            messages: [{ role: "user", content: "扩充细节" }],
            getNodes: () => nodes,
            setNodes: (update) => {
                nodes = update(nodes);
            },
            addConnection: (sourceId, targetId) => {
                connections.push({ sourceId, targetId });
            },
        },
        {
            question: async (_cfg, _msgs, onDelta) => {
                onDelta("赛博猫咪，身披机械外骨骼");
                return "赛博猫咪，身披机械外骨骼";
            },
        },
    );

    const result = await running;
    assert.equal(result.targetId, "text-orig");
    assert.equal(nodes.length, 1);
    assert.equal(connections.length, 0);
    assert.equal(nodes[0].metadata?.content, "赛博猫咪，身披机械外骨骼");
    assert.equal(nodes[0].metadata?.status, "success");
});

test("M8 编辑节点单图重试保留原有参考图 UUID 清单与 edit 类型", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "edit-node",
            type: CanvasNodeType.Image,
            title: "edited image",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "https://example.com/out-1.png",
                count: 2,
                primaryImageId: "out-1",
                generationType: "edit",
                references: ["ref-uuid-1", "ref-uuid-2"],
                prompt: "vintage look",
                images: [
                    { id: "out-1", content: "https://example.com/out-1.png", storageKey: "out-uuid-1", status: "success", naturalWidth: 100, naturalHeight: 100, bytes: 10, mimeType: "image/png" },
                    { id: "out-2", content: "", status: "error", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" },
                ],
            },
        },
    ];

    const refImages = [
        { id: "r1", name: "r1.png", type: "image/png", dataUrl: "https://example.com/r1.png", storageKey: "ref-uuid-1" },
        { id: "r2", name: "r2.png", type: "image/png", dataUrl: "https://example.com/r2.png", storageKey: "ref-uuid-2" },
    ];

    let editCalled = false;
    const run = {
        sourceId: "edit-node",
        prompt: "vintage look",
        config: { ...defaultConfig, models: ["gpt-image-2"] },
        retry: { imageId: "out-2" },
        references: refImages,
        signal: new AbortController().signal,
        getNodes: () => nodes,
        setNodes: (update: (value: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodes = update(nodes);
        },
        addConnection: () => {},
    };

    await runCanvasImageGeneration(run, {
        edit: async (cfg, prompt, refs) => {
            editCalled = true;
            assert.equal(refs.length, 2);
            return [{ id: "out-2", storageKey: "out-uuid-2-retry", url: "https://example.com/out-2-new.png", dataUrl: "https://example.com/out-2-new.png", width: 100, height: 100, bytes: 10, mimeType: "image/png" }];
        },
        store: async () => ({ url: "", width: 0, height: 0, bytes: 0, mimeType: "" }),
    });

    assert.equal(editCalled, true);
    assert.equal(nodes[0].metadata?.generationType, "edit");
    assert.deepEqual(nodes[0].metadata?.references, ["ref-uuid-1", "ref-uuid-2"]);
    assert.equal(nodes[0].metadata?.images?.[1].status, "success");
    assert.equal(nodes[0].metadata?.images?.[1].content, "https://example.com/out-2-new.png");
});

test("M9 文本生成向右派生文本节点、建立连线并流式打字输出内容", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "cfg-1",
            type: CanvasNodeType.Config,
            title: "反推提示词配置",
            position: { x: 100, y: 100 },
            width: 340,
            height: 240,
            metadata: { generationMode: "text" },
        },
    ];
    const connections: Array<{ from: string; to: string }> = [];
    let targetNodeId = "";

    const running = runCanvasTextGeneration(
        {
            sourceId: "cfg-1",
            prompt: "反推生图提示词",
            config: { ...defaultConfig, models: ["gpt-5.6-terra"] },
            signal: new AbortController().signal,
            messages: [{ role: "user", content: "反推指令" }],
            getNodes: () => nodes,
            setNodes: (update) => {
                nodes = update(nodes);
            },
            addConnection: (from, to) => {
                connections.push({ from, to });
            },
            onTarget: (id) => {
                targetNodeId = id;
            },
        },
        {
            question: async (_cfg, _msgs, onDelta) => {
                onDelta("赛博");
                onDelta("赛博猫咪");
                onDelta("赛博猫咪，霓虹光影");
                return "赛博猫咪，霓虹光影";
            },
        },
    );

    const result = await running;
    assert.equal(result.content, "赛博猫咪，霓虹光影");
    assert.equal(nodes.length, 2);
    const targetNode = nodes.find((n) => n.id === targetNodeId);
    assert.ok(targetNode);
    assert.equal(targetNode.type, CanvasNodeType.Text);
    assert.equal(targetNode.position.x, 100 + 340 + 96);
    assert.equal(targetNode.position.y, 100);
    assert.equal(targetNode.metadata?.status, "success");
    assert.equal(targetNode.metadata?.content, "赛博猫咪，霓虹光影");
    assert.deepEqual(connections, [{ from: "cfg-1", to: targetNodeId }]);
});

test("M9 文本流式生成中断（Cancel）保留已输出文字且不标记报错", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "txt-src",
            type: CanvasNodeType.Text,
            title: "源提示词",
            position: { x: 50, y: 50 },
            width: 340,
            height: 240,
            metadata: { content: "一只猫" },
        },
    ];
    const controller = new AbortController();
    let targetNodeId = "";

    const running = runCanvasTextGeneration(
        {
            sourceId: "txt-src",
            prompt: "扩充细节",
            config: { ...defaultConfig, models: ["gpt-5.6-terra"] },
            signal: controller.signal,
            messages: [{ role: "user", content: "扩充细节" }],
            getNodes: () => nodes,
            setNodes: (update) => {
                nodes = update(nodes);
            },
            addConnection: () => {},
            onTarget: (id) => {
                targetNodeId = id;
            },
        },
        {
            question: async (_cfg, _msgs, onDelta, options) => {
                onDelta("一只赛博风格的猫");
                controller.abort();
                options?.signal?.throwIfAborted();
                return "不会到达";
            },
        },
    );

    await assert.rejects(running, { name: "AbortError" });
    const targetNode = nodes.find((n) => n.id === targetNodeId);
    assert.ok(targetNode);
    // 中断时保留了已流式写入的文本
    assert.equal(targetNode.metadata?.content, "一只赛博风格的猫");
    // 且未被错误态覆盖
    assert.notEqual(targetNode.metadata?.status, "error");
});

test("M9 文本生成失败时将目标节点置为错误状态并记录错误详情，支持重试更新", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "cfg-fail",
            type: CanvasNodeType.Config,
            title: "配置节点",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: { generationMode: "text" },
        },
    ];
    let targetNodeId = "";

    await assert.rejects(
        runCanvasTextGeneration(
            {
                sourceId: "cfg-fail",
                prompt: "测试失败",
                config: { ...defaultConfig, models: ["gpt-5.6-terra"] },
                signal: new AbortController().signal,
                messages: [{ role: "user", content: "fail" }],
                getNodes: () => nodes,
                setNodes: (update) => {
                    nodes = update(nodes);
                },
                addConnection: () => {},
                onTarget: (id) => {
                    targetNodeId = id;
                },
            },
            {
                question: async () => {
                    throw new Error("用户额度不足");
                },
            },
        ),
        /用户额度不足/,
    );

    let targetNode = nodes.find((n) => n.id === targetNodeId);
    assert.ok(targetNode);
    assert.equal(targetNode.metadata?.status, "error");
    assert.equal(targetNode.metadata?.errorDetails, "用户额度不足");

    // 重试直接复用 targetId 更新
    await runCanvasTextGeneration(
        {
            sourceId: "cfg-fail",
            prompt: "测试失败",
            config: { ...defaultConfig, models: ["gpt-5.6-terra"] },
            signal: new AbortController().signal,
            messages: [{ role: "user", content: "retry-ok" }],
            retry: { targetId: targetNodeId },
            getNodes: () => nodes,
            setNodes: (update) => {
                nodes = update(nodes);
            },
            addConnection: () => {},
        },
        {
            question: async (_cfg, _msgs, onDelta) => {
                onDelta("重试成功的内容");
                return "重试成功的内容";
            },
        },
    );

    targetNode = nodes.find((n) => n.id === targetNodeId);
    assert.ok(targetNode);
    assert.equal(targetNode.metadata?.status, "success");
    assert.equal(targetNode.metadata?.content, "重试成功的内容");
    assert.equal(targetNode.metadata?.errorDetails, undefined);
});

test("Midjourney 异步任务生命周期：mjTaskId 与 progress 实时注入，成功后填充 4 图批次并清理临时标识", async () => {
    let nodes: CanvasNodeData[] = [
        { id: "source-mj", type: CanvasNodeType.Image, title: "source", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: {} },
    ];
    let capturedTargetId = "";

    const mjConfig = {
        ...defaultConfig,
        model: "mj_imagine",
        models: ["mj_imagine"],
        count: "1",
        resolution: "",
        quality: "",
        aspectRatio: "16:9",
    };

    let triggerTaskId!: (taskId: string) => void;
    let triggerProgress!: (progress: string) => void;
    let completeTask!: (images: any[]) => void;

    const taskPromise = new Promise<any[]>((resolve) => {
        completeTask = resolve;
    });

    const runPromise = runCanvasImageGeneration(
        {
            sourceId: "source-mj",
            prompt: "cyberpunk skyline",
            config: mjConfig,
            signal: new AbortController().signal,
            getNodes: () => nodes,
            setNodes: (update) => {
                nodes = update(nodes);
            },
            addConnection: () => {},
            onTarget: (targetId) => {
                capturedTargetId = targetId;
            },
        },
        {
            generate: (async (_config: any, _prompt: any, options: any) => {
                triggerTaskId = options?.onTaskId;
                triggerProgress = options?.onProgress;
                return taskPromise;
            }) as any,
            store: (async () => ({ url: "", storageKey: "", width: 0, height: 0, bytes: 0, mimeType: "" })) as any,
        },
    );

    // 1. 验证生成初始状态
    assert.ok(capturedTargetId);
    let targetNode = nodes.find((n) => n.id === capturedTargetId);
    assert.ok(targetNode);
    assert.equal(targetNode.metadata?.status, "loading");
    assert.equal(targetNode.metadata?.images?.length, 1);

    // 2. 模拟上游返回 taskId，节点 metadata.mjTaskId 实时写入
    triggerTaskId("task-mj-async-999");
    targetNode = nodes.find((n) => n.id === capturedTargetId);
    assert.equal(targetNode?.metadata?.mjTaskId, "task-mj-async-999");

    // 3. 模拟轮询汇报进度，节点 metadata.progress 实时更新
    triggerProgress("45%");
    targetNode = nodes.find((n) => n.id === capturedTargetId);
    assert.equal(targetNode?.metadata?.progress, "45%");

    // 4. 模拟出图完成（切分出 4 张独立图）
    completeTask([
        { id: "img-1", storageKey: "key-1", url: "https://example.com/1.png", width: 1024, height: 1024, bytes: 100, mimeType: "image/png" },
        { id: "img-2", storageKey: "key-2", url: "https://example.com/2.png", width: 1024, height: 1024, bytes: 100, mimeType: "image/png" },
        { id: "img-3", storageKey: "key-3", url: "https://example.com/3.png", width: 1024, height: 1024, bytes: 100, mimeType: "image/png" },
        { id: "img-4", storageKey: "key-4", url: "https://example.com/4.png", width: 1024, height: 1024, bytes: 100, mimeType: "image/png" },
    ]);

    await runPromise;

    targetNode = nodes.find((n) => n.id === capturedTargetId);
    assert.ok(targetNode);
    assert.equal(targetNode.metadata?.status, "success");
    assert.equal(targetNode.metadata?.mjTaskId, undefined);
    assert.equal(targetNode.metadata?.progress, undefined);
    assert.equal(targetNode.metadata?.images?.length, 4);
    assert.equal(targetNode.metadata?.primaryImageId, "img-1");
    assert.equal(targetNode.metadata?.storageKey, "key-1");
    assert.equal(targetNode.metadata?.content, "https://example.com/1.png");
});

test("Midjourney 断点保护：resetInterruptedGeneration 保护在途 mjTaskId 节点不被重置为错误", () => {
    const regularLoadingNode: CanvasNodeData = {
        id: "node-regular-loading",
        type: CanvasNodeType.Image,
        title: "regular loading",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            status: "loading",
            model: "gpt-image-2",
        },
    };

    const inFlightMjNode: CanvasNodeData = {
        id: "node-mj-in-flight",
        type: CanvasNodeType.Image,
        title: "midjourney in flight",
        position: { x: 100, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            status: "loading",
            model: "mj_imagine",
            mjTaskId: "task-resumable-123",
        },
    };

    const completedMjNode: CanvasNodeData = {
        id: "node-mj-completed",
        type: CanvasNodeType.Image,
        title: "midjourney completed",
        position: { x: 200, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            status: "loading",
            model: "mj_imagine",
            mjTaskId: "task-completed-456",
            content: "https://example.com/already-have-image.png",
        },
    };

    // 1. hasResumableMjTask 判定
    assert.equal(hasResumableMjTask(inFlightMjNode), true);
    assert.equal(hasResumableMjTask(regularLoadingNode), false);
    assert.equal(hasResumableMjTask(completedMjNode), false); // 已有 content 的不再重复轮询

    // 2. resetInterruptedGeneration 行为
    const resetNodes = resetInterruptedGeneration([regularLoadingNode, inFlightMjNode, completedMjNode]);

    // 普通 loading 节点因离开页面而被置为 error
    const resetRegular = resetNodes.find((n) => n.id === "node-regular-loading");
    assert.equal(resetRegular?.metadata?.status, "error");

    // 在途 Midjourney 任务节点受到保护，保持 loading 状态供页面挂载后静默续接
    const protectedMj = resetNodes.find((n) => n.id === "node-mj-in-flight");
    assert.equal(protectedMj?.metadata?.status, "loading");
    assert.equal(protectedMj?.metadata?.mjTaskId, "task-resumable-123");
});

test("Wan3.0 视频与异步任务断点保护：videoTaskId 判定、落盘过滤与重载恢复", () => {
    const inFlightVideoNode: CanvasNodeData = {
        id: "node-video-in-flight",
        type: CanvasNodeType.Video,
        title: "wan3.0 video generating",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            status: "loading",
            model: "wan3.0-video",
            videoTaskId: "task_V3xZDr7UIdEemQgO6fntdPkoy0vLWfkc",
        },
    };

    const regularLoadingVideoNode: CanvasNodeData = {
        id: "node-video-loading",
        type: CanvasNodeType.Video,
        title: "creating video task",
        position: { x: 100, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            status: "loading",
            model: "wan3.0-video",
        },
    };

    const completedVideoNode: CanvasNodeData = {
        id: "node-video-completed",
        type: CanvasNodeType.Video,
        title: "video completed",
        position: { x: 200, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            status: "success",
            model: "wan3.0-video",
            videoTaskId: "task_V3xZDr7UIdEemQgO6fntdPkoy0vLWfkc",
            content: "https://example.com/video.mp4",
        },
    };

    const inFlightRegularImageNode: CanvasNodeData = {
        id: "node-image-loading",
        type: CanvasNodeType.Image,
        title: "regular image generating",
        position: { x: 300, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            images: [
                {
                    id: "img-loading",
                    status: "loading",
                    content: "",
                    naturalWidth: 0,
                    naturalHeight: 0,
                    bytes: 0,
                    mimeType: "",
                },
            ],
        },
    };

    // 1. hasResumableVideoTask 判定
    assert.equal(hasResumableVideoTask(inFlightVideoNode), true);
    assert.equal(hasResumableVideoTask(regularLoadingVideoNode), false);
    assert.equal(hasResumableVideoTask(completedVideoNode), false);
    assert.equal(hasResumableTask(inFlightVideoNode), true);

    // 2. hasUnresumableInFlightTask 判定（决定是否阻断自动保存落盘）
    // 已取得 videoTaskId 的异步在途任务属于可恢复任务，不阻断工程保存
    assert.equal(hasUnresumableInFlightTask(inFlightVideoNode), false);
    // 尚未拿到 taskId 的初始 loading 节点或普通单图在途节点属于瞬态在途，必须阻断草稿落盘
    assert.equal(hasUnresumableInFlightTask(regularLoadingVideoNode), true);
    assert.equal(hasUnresumableInFlightTask(inFlightRegularImageNode), true);
    assert.equal(hasUnresumableInFlightTask(completedVideoNode), false);

    // 3. resetInterruptedGeneration 行为
    const resetNodes = resetInterruptedGeneration([regularLoadingVideoNode, inFlightVideoNode, completedVideoNode]);

    // 未拿到 taskId 的初始 loading 节点在刷新重载时置为 error
    const resetRegular = resetNodes.find((n) => n.id === "node-video-loading");
    assert.equal(resetRegular?.metadata?.status, "error");

    // 持有 videoTaskId 的视频任务节点受保护，维持 loading 状态以供挂载后静默轮询恢复
    const protectedVideo = resetNodes.find((n) => n.id === "node-video-in-flight");
    assert.equal(protectedVideo?.metadata?.status, "loading");
    assert.equal(protectedVideo?.metadata?.videoTaskId, "task_V3xZDr7UIdEemQgO6fntdPkoy0vLWfkc");
});

test("提示词润色模板动态装配：当活动模型为 mj_imagine 时，文本生成消息自动注入 Midjourney 专用提示词改写模板", () => {
    const context = {
        prompt: "cyberpunk warrior girl",
        referenceImages: [],
        referenceVideos: [],
        referenceAudios: [],
        textCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
    };

    // 1. 普通模型无额外系统提示词
    const regularMessages = buildNodeResponseMessages(context, { model: "gpt-image-2" });
    assert.equal(regularMessages.length, 1);
    assert.equal(regularMessages[0].role, "user");
    assert.equal(regularMessages[0].content, "cyberpunk warrior girl");

    // 2. 当模型为 mj_imagine 时，自动装配 MIDJOURNEY_POLISH_TEMPLATE 为 system 消息
    const mjMessages = buildNodeResponseMessages(context, { model: "mj_imagine" });
    assert.equal(mjMessages.length, 2);
    assert.equal(mjMessages[0].role, "system");
    assert.equal(mjMessages[0].content, MIDJOURNEY_POLISH_TEMPLATE);
    assert.equal(mjMessages[1].role, "user");
    assert.equal(mjMessages[1].content, "cyberpunk warrior girl");
});

