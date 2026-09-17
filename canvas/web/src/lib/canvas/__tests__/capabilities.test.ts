import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { requestGeneration, requestEdit, requestImageQuestion, fetchImageModels } from "@/services/api/image";
import { createVideoGenerationTask, pollVideoGenerationTask } from "@/services/api/video";
import { requestAudioGeneration } from "@/services/api/audio";
import { runModelPlugin } from "@/services/api/model-plugin";
import { discoverAgentConfig } from "@/services/api/canvas-agent";
import { testWebdavConnection } from "@/services/webdav-sync";
import { activatePlugin, installPluginFromUrl } from "@/lib/canvas/plugin-loader";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { assertCanvasNodesAllowed, canvasCapabilities } from "@/lib/canvas/canvas-capabilities";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

const config = { ...defaultConfig, apiKey: "legacy-key", baseUrl: "https://invalid.example" };

test("开放精选词库与视频能力，启用音频节点，仍拒绝外部源、插件与外部服务调用", async () => {
    assert.equal(canvasCapabilities.promptLibrary, true);
    assert.equal(canvasCapabilities.externalPrompts, false);
    assert.equal(canvasCapabilities.video, true);
    assert.equal(canvasCapabilities.audio, true);
    const requests = [
        () => fetchImageModels(config),
        () => requestAudioGeneration(config, "prompt"),
        () => runModelPlugin({ capability: "image", script: "throw new Error('script executed')", config, prompt: "prompt" }),
        () => installPluginFromUrl("https://invalid.example/plugin.js"),
        () => discoverAgentConfig("https://invalid.example"),
        () => testWebdavConnection({ url: "https://invalid.example", username: "a", password: "legacy", directory: "", lastSyncedAt: "" }),
        () => exportCanvasProjects([]),
    ];
    await assert.rejects(() => requestGeneration(config, "prompt"), /当前不可用/);
    await assert.rejects(() => requestEdit(config, "prompt", []), /当前不可用/);
    for (const request of requests) await assert.rejects(request, /此功能尚未开放/);
    assert.throws(() => activatePlugin({ id: "legacy", name: "legacy", version: "1", nodes: [] }), /此功能尚未开放/);
    assert.throws(() => useCanvasStore.getState().importProject({ nodes: [] }), /此功能尚未开放/);
    assert.throws(() => useConfigStore.getState().importChannelCredentials({ baseUrl: config.baseUrl, apiKey: config.apiKey }), /此功能尚未开放/);
});

test("放行图片、文本、视频和音频节点，放行文本与视频生成模式，拒绝音频生成与插件", () => {
    const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 });
    const text = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 });
    const video = createCanvasNode(CanvasNodeType.Video, { x: 0, y: 0 });
    const audio = createCanvasNode(CanvasNodeType.Audio, { x: 0, y: 0 });
    assert.doesNotThrow(() => assertCanvasNodesAllowed([image, text, video, audio]));
    assert.doesNotThrow(() => assertCanvasNodesAllowed([{ ...image, metadata: { generationMode: "image" } }]));
    assert.doesNotThrow(() => assertCanvasNodesAllowed([{ ...image, metadata: { generationMode: "text" } }]));
    assert.doesNotThrow(() => assertCanvasNodesAllowed([{ ...image, metadata: { generationMode: "video" } }]));
    for (const type of ["legacy-plugin"]) {
        assert.throws(() => createCanvasNode(type, { x: 0, y: 0 }));
        assert.throws(() => assertCanvasNodesAllowed([{ ...image, type }]));
    }
    assert.throws(() => assertCanvasNodesAllowed([{ ...image, metadata: { generationMode: "audio" } }]));
});
