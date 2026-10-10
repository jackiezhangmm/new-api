import { test } from "node:test";
import assert from "node:assert/strict";
import {
    defaultVideoSettings,
    getCanvasVideoModel,
    switchVideoModel,
    videoSettingsIssues,
} from "../video-models";
import {
    defaultConfig,
    modelCapabilityOf,
    modelMatchesCapability,
    resolveModelForCapability,
    type AiConfig,
} from "@/stores/use-config-store";

test("视频模型主动切换保留兼容选择，调整无效值并列出调整字段", () => {
    // 切换到 minimax_h3_lightx2v_v5（maxDuration: 10），如果当前是 15s，秒数自动截断为 10
    const res1 = switchVideoModel({ seconds: "15", vquality: "768", size: "16:9" }, "minimax_h3_lightx2v_v5");
    assert.equal(res1.settings.model, "minimax_h3_lightx2v_v5");
    assert.equal(res1.settings.seconds, "10");
    assert.equal(res1.settings.vquality, "768");
    assert.equal(res1.settings.size, "16:9");
    assert.deepEqual(res1.adjusted, ["seconds"]);

    // 切换到 minimax_h3_b99_003_12s（只支持 736p），如果当前是 480p，清晰度自动调整为 736
    const res2 = switchVideoModel({ seconds: "5", vquality: "480", size: "16:9" }, "minimax_h3_b99_003_12s");
    assert.equal(res2.settings.model, "minimax_h3_b99_003_12s");
    assert.equal(res2.settings.vquality, "736");
    assert.deepEqual(res2.adjusted, ["quality"]);
});

test("本地/集成模式下正确识别内置视频模型能力并保留用户选择的模型", () => {
    const localConfig: AiConfig = {
        ...defaultConfig,
        channelMode: "local",
        channels: [],
        models: ["minimax_h3_zm_u24", "minimax_h3_lightx2v_v5"],
    };

    // 内置视频模型应被识别为 video 能力
    assert.equal(modelCapabilityOf(localConfig, "minimax_h3_lightx2v_v5"), "video");
    assert.equal(modelMatchesCapability(localConfig, "minimax_h3_lightx2v_v5", "video"), true);

    // resolveModelForCapability 应当保留用户选中的视频模型，而不是回退为 fallbackModel
    const resolved = resolveModelForCapability(localConfig, "minimax_h3_lightx2v_v5", "video");
    assert.equal(resolved, "minimax_h3_lightx2v_v5");
});

test("Wan3.0 视频模型注册、协议规格与最近邻纠偏", () => {
    const wan = getCanvasVideoModel("wan3.0-video");
    const wanPrime = getCanvasVideoModel("wan3.0-video-prime");
    assert.ok(wan);
    assert.ok(wanPrime);
    assert.equal(wan.protocol, "standard");
    assert.equal(wanPrime.protocol, "standard");
    assert.equal(wan.maxDuration, 30);
    assert.equal(wan.maxImages, 10);
    assert.equal(wan.minAudio, 0);
    assert.equal(wan.maxAudio, 5);

    // 纠偏：从 768p (AutoDL) 切换至 Wan3.0，最近邻收敛至 720p，保留 25s 时长
    const res1 = switchVideoModel({ seconds: "25", vquality: "768", size: "16:9" }, "wan3.0-video");
    assert.equal(res1.settings.model, "wan3.0-video");
    assert.equal(res1.settings.vquality, "720");
    assert.equal(res1.settings.seconds, "25");
    assert.deepEqual(res1.adjusted, ["quality"]);

    // 纠偏：从 Wan3.0 (30s, 720p, adaptive) 切换至 AutoDL (minimax_h3_zm_u24)，720p 最近邻收敛至 768p，adaptive 收敛至 16:9，秒数截断至 15s
    const res2 = switchVideoModel({ seconds: "30", vquality: "720", size: "adaptive" }, "minimax_h3_zm_u24");
    assert.equal(res2.settings.model, "minimax_h3_zm_u24");
    assert.equal(res2.settings.vquality, "768");
    assert.equal(res2.settings.size, "16:9");
    assert.equal(res2.settings.seconds, "15");
    assert.ok(res2.adjusted.includes("quality"));
    assert.ok(res2.adjusted.includes("size"));
    assert.ok(res2.adjusted.includes("seconds"));

    // 纠偏：Wan3.0 最小时长为 2 秒，1 秒向上钳位
    const res3 = switchVideoModel({ seconds: "1", vquality: "720", size: "16:9" }, "wan3.0-video");
    assert.equal(res3.settings.seconds, "2");
    assert.deepEqual(res3.adjusted, ["seconds"]);
});

test("Wan3.0 视频参数前置校验：文生视频、自适应比例与多模态互斥守卫", () => {
    const baseWanConfig: AiConfig = {
        ...defaultConfig,
        model: "wan3.0-video",
        videoModel: "wan3.0-video",
        vquality: "720",
        size: "16:9",
        videoSeconds: "5",
        models: ["wan3.0-video"],
    };

    // 1. 文生视频（0 张图片）允许生成，但需要提示词且禁用自适应比例
    const issuesTextOnlyOk = videoSettingsIssues(baseWanConfig, ["wan3.0-video"], { imageCount: 0, prompt: "sunset" });
    assert.deepEqual(issuesTextOnlyOk, []);

    const issuesNoPrompt = videoSettingsIssues(baseWanConfig, ["wan3.0-video"], { imageCount: 0, prompt: "" });
    assert.ok(issuesNoPrompt.some((msg: string) => msg.includes("提示词") || msg.includes("Prompt") || msg.includes("prompt")));

    const issuesAdaptiveNoImage = videoSettingsIssues({ ...baseWanConfig, size: "adaptive" }, ["wan3.0-video"], { imageCount: 0, prompt: "sunset" });
    assert.ok(issuesAdaptiveNoImage.some((msg: string) => msg.includes("自适应") || msg.includes("Adaptive") || msg.includes("adaptive")));

    // 2. 单张图片连入音频自动生效为参考图模式，不产生冲突
    const issuesSingleImageWithAudio = videoSettingsIssues(baseWanConfig, ["wan3.0-video"], { imageCount: 1, audioCount: 1, prompt: "test" });
    assert.deepEqual(issuesSingleImageWithAudio, []);

    // 3. 双张图片默认首尾帧模式，连入音频时前置报错拦截互斥
    const issuesDoubleImageWithAudio = videoSettingsIssues(baseWanConfig, ["wan3.0-video"], { imageCount: 2, audioCount: 1, prompt: "test" });
    assert.ok(issuesDoubleImageWithAudio.some((msg: string) => msg.includes("互斥") || msg.includes("首尾帧") || msg.includes("音频")));

    // 4. 双图在切换为参考图模式后允许连接音频
    const issuesRefModeWithAudio = videoSettingsIssues({ ...baseWanConfig, videoMode: "reference" }, ["wan3.0-video"], { imageCount: 2, audioCount: 1, prompt: "test" });
    assert.deepEqual(issuesRefModeWithAudio, []);

    const issuesMultiImageWithAudio = videoSettingsIssues(baseWanConfig, ["wan3.0-video"], { imageCount: 3, audioCount: 1, prompt: "test" });
    assert.deepEqual(issuesMultiImageWithAudio, []);

    // 5. 图片上限保护（最多 10 张）
    const issuesTooManyImages = videoSettingsIssues(baseWanConfig, ["wan3.0-video"], { imageCount: 11, prompt: "test" });
    assert.ok(issuesTooManyImages.some((msg: string) => msg.includes("10")));
});

test("仅开启 Wan3.0 渠道的环境中新建视频节点自动降级为可用模型", () => {
    const wanOnlyConfig: AiConfig = {
        ...defaultConfig,
        channelMode: "local",
        channels: [],
        videoModel: "minimax_h3_zm_u24", // 默认硬编码模型不在可用列表
        models: ["wan3.0-video", "wan3.0-video-prime"],
    };

    const resolved = resolveModelForCapability(wanOnlyConfig, undefined, "video");
    assert.equal(resolved, "wan3.0-video");
});
