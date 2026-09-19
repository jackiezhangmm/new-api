import { test } from "node:test";
import assert from "node:assert/strict";
import {
    defaultVideoSettings,
    getCanvasVideoModel,
    switchVideoModel,
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
