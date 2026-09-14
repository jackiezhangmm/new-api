import { test } from "node:test";
import assert from "node:assert/strict";
import {
    auxiliaryTextIssues,
    buildCanvasImageEditRequest,
    buildCanvasImageRequest,
    DEFAULT_AUXILIARY_TEXT_MODEL,
    defaultImageEditSettings,
    defaultImageSettings,
    filterCanvasAuxiliaryTextModels,
    filterCanvasImageModels,
    imageSettingsIssues,
    resolveAuxiliaryTextModel,
    resolveImageSettings,
    switchImageModel,
} from "../image-models";

test("受控模型交集与 image2 语义尺寸请求，不发送透明背景或旧渠道配置", () => {
    assert.deepEqual(filterCanvasImageModels(["gpt-image-2", "gpt-image-2", "nano-banana-2", "nano-banana-2-lite", "grok-imagine-image-2.0", "unknown"]), [
        "gpt-image-2",
        "nano-banana-2",
        "nano-banana-2-lite",
        "grok-imagine-image-2.0",
    ]);
    assert.deepEqual(filterCanvasImageModels(["unknown-model"]), []);
    assert.deepEqual(buildCanvasImageRequest({ ...defaultImageSettings, resolution: "2k", aspectRatio: "1:3", count: "4" }, " 海报 ", ["gpt-image-2"]), {
        model: "gpt-image-2",
        prompt: "海报",
        size: "1:3 2k",
        quality: "low",
        n: 4,
        response_format: "b64_json",
        output_format: "png",
    });
});

test("拒绝旧工程失效参数与非法数量，不修改输入、不静默换模型", () => {
    for (const patch of [
        { model: "default::gpt-image-2" },
        { quality: "high" },
        { background: "transparent" },
        { size: "1024x1024" },
        { aspectRatio: "1:8" },
        { resolution: "512" },
        ...["0", "-1", "1.5", "5", "NaN", "Infinity"].map((count) => ({ count })),
    ]) {
        const settings = { ...defaultImageSettings, ...patch };
        const snapshot = { ...settings };
        assert.throws(() => buildCanvasImageRequest(settings, "prompt", ["gpt-image-2"]));
        assert.deepEqual(settings, snapshot);
    }
    assert.throws(() => buildCanvasImageRequest(defaultImageSettings, "prompt", []));
    assert.throws(() => buildCanvasImageRequest(defaultImageSettings, "  ", ["gpt-image-2"]));
    assert.ok(imageSettingsIssues(defaultImageSettings, ["gpt-image-2"], "edit").length);
    const legacy = resolveImageSettings(defaultImageSettings, { model: "removed-model", size: "1536x1024", count: 0 });
    assert.equal(legacy.model, "removed-model");
    assert.equal(legacy.count, "0");
    assert.equal(legacy.size, "1536x1024");
    assert.equal(legacy.resolution, undefined);
    assert.equal(legacy.aspectRatio, undefined);
    const resolvedLegacySupported = resolveImageSettings(defaultImageSettings, { model: "gpt-image-2", size: "1024x1024" });
    assert.equal(resolvedLegacySupported.model, "gpt-image-2");
    assert.equal(resolvedLegacySupported.size, "");
    assert.equal(resolvedLegacySupported.resolution, "1k");
    assert.equal(resolvedLegacySupported.aspectRatio, "1:1");
    assert.equal(imageSettingsIssues(resolvedLegacySupported, ["gpt-image-2"]).length, 0);
});

test("主动切换保留兼容选择，调整无效值并列出调整字段", () => {
    const original = { ...defaultImageSettings, model: "old-model", resolution: "2k", aspectRatio: "1:8", quality: "high", background: "transparent", count: "8" };
    const result = switchImageModel(original, "gpt-image-2");
    assert.deepEqual(result.settings, { ...defaultImageSettings, resolution: "2k" });
    assert.deepEqual(result.adjusted, ["aspectRatio", "quality", "background", "count"]);
    assert.equal(original.aspectRatio, "1:8");
    assert.throws(() => switchImageModel(original, "unknown"));
});

test("M8 编辑操作受控校验：默认 auto 1k、支持 1~3 张参考图、阻断超限与非法参数", () => {
    assert.deepEqual(buildCanvasImageEditRequest(defaultImageEditSettings, " 修改图片 ", ["gpt-image-2"], 1), {
        model: "gpt-image-2",
        prompt: "修改图片",
        size: "auto 1k",
        quality: "low",
        n: 1,
        response_format: "b64_json",
        output_format: "png",
    });

    assert.deepEqual(buildCanvasImageEditRequest({ ...defaultImageEditSettings, resolution: "2k", aspectRatio: "16:9", count: "2" }, "换风格", ["gpt-image-2"], 3), {
        model: "gpt-image-2",
        prompt: "换风格",
        size: "16:9 2k",
        quality: "low",
        n: 2,
        response_format: "b64_json",
        output_format: "png",
    });

    for (const count of [1, 2, 3]) {
        assert.equal(imageSettingsIssues(defaultImageEditSettings, ["gpt-image-2"], "edit", count).length, 0);
    }

    for (const count of [0, 4, -1]) {
        assert.throws(() => buildCanvasImageEditRequest(defaultImageEditSettings, "修改", ["gpt-image-2"], count));
        const issues = imageSettingsIssues(defaultImageEditSettings, ["gpt-image-2"], "edit", count);
        assert.ok(issues.length > 0);
        assert.ok(issues.some((msg) => msg.includes("参考图")));
    }

    assert.throws(() => buildCanvasImageEditRequest({ ...defaultImageEditSettings, aspectRatio: "1:8" }, "修改", ["gpt-image-2"], 1));
    assert.throws(() => buildCanvasImageEditRequest(defaultImageEditSettings, "  ", ["gpt-image-2"], 1));

    const resolvedEdit = resolveImageSettings(defaultImageSettings, {}, "edit");
    assert.equal(resolvedEdit.aspectRatio, "auto");
    assert.equal(resolvedEdit.resolution, "1k");
    assert.equal(imageSettingsIssues(resolvedEdit, ["gpt-image-2"], "edit", 1).length, 0);
});

test("M9 辅助文本受控候选名单固定为 gpt-5.6-terra，支持权限交集与可用性探测", () => {
    assert.equal(DEFAULT_AUXILIARY_TEXT_MODEL, "gpt-5.6-terra");
    assert.deepEqual(filterCanvasAuxiliaryTextModels(["gpt-5.6-terra", "gpt-4o", "other"]), ["gpt-5.6-terra"]);
    assert.deepEqual(filterCanvasAuxiliaryTextModels(["gpt-image-2"]), []);
    assert.equal(resolveAuxiliaryTextModel(["gpt-5.6-terra", "gpt-image-2"]), "gpt-5.6-terra");
    assert.equal(resolveAuxiliaryTextModel(["other-model"]), undefined);
    assert.deepEqual(auxiliaryTextIssues(["gpt-5.6-terra"]), []);
    assert.ok(auxiliaryTextIssues(["gpt-image-2"]).length > 0);
    assert.ok(auxiliaryTextIssues([]).some((msg) => msg.includes("gpt-5.6-terra")));
});

test("新模型能力规格与参数纠偏校验：nano-banana-2, nano-banana-2-lite, grok-imagine-image-2.0", () => {
    const allModels = ["gpt-image-2", "nano-banana-2", "nano-banana-2-lite", "grok-imagine-image-2.0"];

    // 1. nano-banana-2
    const bananaSettings = {
        model: "nano-banana-2",
        resolution: "2k",
        aspectRatio: "16:9",
        quality: "",
        size: "",
        background: "",
        count: "1",
    };
    assert.equal(imageSettingsIssues(bananaSettings, allModels).length, 0);
    // nano-banana-2 不支持 quality
    assert.ok(imageSettingsIssues({ ...bananaSettings, quality: "low" }, allModels).length > 0);
    // nano-banana-2 最多生成 1 张
    assert.ok(imageSettingsIssues({ ...bananaSettings, count: "2" }, allModels).length > 0);
    // nano-banana-2 支持 512, 1k, 2k, 4k
    for (const res of ["512", "1k", "2k", "4k"]) {
        assert.equal(imageSettingsIssues({ ...bananaSettings, resolution: res }, allModels).length, 0);
    }
    // nano-banana-2 宽高比 1:4 支持，但不支持 1:3
    assert.equal(imageSettingsIssues({ ...bananaSettings, aspectRatio: "1:4" }, allModels).length, 0);
    assert.ok(imageSettingsIssues({ ...bananaSettings, aspectRatio: "1:3" }, allModels).length > 0);
    // nano-banana-2 编辑支持最多 14 张参考图
    assert.equal(imageSettingsIssues({ ...bananaSettings, aspectRatio: "auto" }, allModels, "edit", 14).length, 0);
    assert.ok(imageSettingsIssues({ ...bananaSettings, aspectRatio: "auto" }, allModels, "edit", 15).length > 0);

    // 2. nano-banana-2-lite
    const liteSettings = {
        model: "nano-banana-2-lite",
        resolution: "1k",
        aspectRatio: "1:1",
        quality: "",
        size: "",
        background: "",
        count: "1",
    };
    assert.equal(imageSettingsIssues(liteSettings, allModels).length, 0);
    // lite 仅支持 1k 分辨率，不支持 2k 或 4k
    assert.ok(imageSettingsIssues({ ...liteSettings, resolution: "2k" }, allModels).length > 0);
    assert.ok(imageSettingsIssues({ ...liteSettings, resolution: "4k" }, allModels).length > 0);

    // 3. grok-imagine-image-2.0
    const grokSettings = {
        model: "grok-imagine-image-2.0",
        resolution: "2k",
        aspectRatio: "16:9",
        quality: "medium",
        size: "",
        background: "",
        count: "10",
    };
    assert.equal(imageSettingsIssues(grokSettings, allModels).length, 0);
    // grok 最多支持 10 张出图，11 张超限
    assert.ok(imageSettingsIssues({ ...grokSettings, count: "11" }, allModels).length > 0);
    // grok 支持 1k, 2k，不支持 4k
    assert.ok(imageSettingsIssues({ ...grokSettings, resolution: "4k" }, allModels).length > 0);
    // grok 编辑最多 3 张参考图，4 张超限
    assert.equal(imageSettingsIssues({ ...grokSettings, aspectRatio: "auto" }, allModels, "edit", 3).length, 0);
    assert.ok(imageSettingsIssues({ ...grokSettings, aspectRatio: "auto" }, allModels, "edit", 4).length > 0);

    // 4. switchImageModel 自动纠偏
    // 切换到 nano-banana-2-lite 时，原有 2k 分辨率自动纠偏为 1k
    const switchedToLite = switchImageModel({ ...defaultImageSettings, resolution: "2k", count: "4" }, "nano-banana-2-lite");
    assert.equal(switchedToLite.settings.resolution, "1k");
    assert.equal(switchedToLite.settings.quality, "");
    assert.equal(switchedToLite.settings.count, "1");
    assert.ok(switchedToLite.adjusted.includes("resolution"));
    assert.ok(switchedToLite.adjusted.includes("quality"));
    assert.ok(switchedToLite.adjusted.includes("count"));

    // 切换到 nano-banana-2 时，原有 4 张出图自动纠偏为 1 张，quality 自动清空
    const switchedToBanana = switchImageModel({ ...defaultImageSettings, resolution: "4k", quality: "medium", count: "4" }, "nano-banana-2");
    assert.equal(switchedToBanana.settings.resolution, "4k");
    assert.equal(switchedToBanana.settings.quality, "");
    assert.equal(switchedToBanana.settings.count, "1");
    assert.ok(switchedToBanana.adjusted.includes("quality"));
    assert.ok(switchedToBanana.adjusted.includes("count"));
});

