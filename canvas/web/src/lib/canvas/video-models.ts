import i18n from "@/i18n";
import type { AiConfig } from "@/stores/use-config-store";

export const DEFAULT_CANVAS_VIDEO_MODEL = "minimax_h3_zm_u24";

export type CanvasVideoProtocol = "autodl" | "standard";

export type CanvasVideoModelDefinition = {
    model: string;
    protocol?: CanvasVideoProtocol;
    resolutions: Record<string, Record<string, string>>;
    maxDuration: number;
    maxPrompt: number;
    maxImages: number;
    minAudio: number;
    maxAudio: number;
};

export const canvasVideoModels: CanvasVideoModelDefinition[] = [
    {
        model: "wan3.0-video",
        protocol: "standard",
        maxDuration: 30, maxPrompt: 20000, maxImages: 10, minAudio: 0, maxAudio: 5,
        resolutions: {
            "480": { "16:9": "480P", "9:16": "480P", "1:1": "480P", "4:3": "480P", "3:4": "480P", "adaptive": "480P" },
            "720": { "16:9": "720P", "9:16": "720P", "1:1": "720P", "4:3": "720P", "3:4": "720P", "adaptive": "720P" },
            "1080": { "16:9": "1080P", "9:16": "1080P", "1:1": "1080P", "4:3": "1080P", "3:4": "1080P", "adaptive": "1080P" },
        },
    },
    {
        model: "wan3.0-video-prime",
        protocol: "standard",
        maxDuration: 30, maxPrompt: 20000, maxImages: 10, minAudio: 0, maxAudio: 5,
        resolutions: {
            "480": { "16:9": "480P", "9:16": "480P", "1:1": "480P", "4:3": "480P", "3:4": "480P", "adaptive": "480P" },
            "720": { "16:9": "720P", "9:16": "720P", "1:1": "720P", "4:3": "720P", "3:4": "720P", "adaptive": "720P" },
            "1080": { "16:9": "1080P", "9:16": "1080P", "1:1": "1080P", "4:3": "1080P", "3:4": "1080P", "adaptive": "1080P" },
        },
    },
    {
        model: DEFAULT_CANVAS_VIDEO_MODEL,
        protocol: "autodl",
        maxDuration: 15, maxPrompt: 10000, maxImages: 9, minAudio: 0, maxAudio: 3,
        resolutions: {
            "480": { "16:9": "480p横", "9:16": "480p竖", "1:1": "480p1:1" },
            "768": { "16:9": "768p横", "9:16": "768p竖", "1:1": "768p1:1" },
        },
    },
    {
        model: "minimax_h3_lightx2v_v5",
        maxDuration: 10, maxPrompt: 500000, maxImages: 9, minAudio: 0, maxAudio: 0,
        resolutions: {
            "480": { "16:9": "480p横", "9:16": "480p竖", "1:1": "480p(1:1)" },
            "768": { "16:9": "768p横", "9:16": "768p竖", "1:1": "768p(1:1)" },
            "1080": { "16:9": "1080p横", "9:16": "1080p竖", "1:1": "1080p(1:1)" },
        },
    },
    {
        model: "minimax_h3_b99_003_12s",
        maxDuration: 12, maxPrompt: 10000, maxImages: 9, minAudio: 0, maxAudio: 0,
        resolutions: {
            "736": { "16:9": "736p横", "9:16": "736p竖", "1:1": "736p(1:1)" },
        },
    },
    {
        model: "minimax_h3_z0901",
        maxDuration: 15, maxPrompt: 10000, maxImages: 0, minAudio: 0, maxAudio: 0,
        resolutions: {
            "480": { "16:9": "480p横(864*480)", "9:16": "480p竖(480*864)" },
            "768": { "16:9": "768p横(1344*768)", "9:16": "768p竖(768*1344)" },
            "1088": { "16:9": "1088p横(1920*1088)", "9:16": "1088p竖(1088*1920)" },
            "1440": { "16:9": "1440p横(2560*1440)", "9:16": "1440p竖(1440*2560)" },
        },
    },
    {
        model: "minimax_h3_z0903",
        maxDuration: 15, maxPrompt: 10000, maxImages: 6, minAudio: 1, maxAudio: 3,
        resolutions: {
            "480": { "16:9": "480p横(864*480)", "9:16": "480p竖(480*864)" },
            "768": { "16:9": "768p横(1376*768)", "9:16": "768p竖(768*1376)" },
            "1088": { "16:9": "1088p横(1920*1088)", "9:16": "1088p竖(1088*1920)" },
            "1440": { "16:9": "1440p横(2560*1440)", "9:16": "1440p竖(1440*2560)" },
        },
    },
];

export function getCanvasVideoModel(model: string) {
    return canvasVideoModels.find((item) => item.model === model);
}

export type VideoSettings = {
    model: string;
    seconds: string;
    vquality: string;
    size: string;
};

export function switchVideoModel(current: { seconds?: string; vquality?: string; size?: string }, model: string) {
    const def = getCanvasVideoModel(model);
    if (!def) return { settings: { ...current, model }, adjusted: [] as string[] };
    const settings = {
        model,
        seconds: current.seconds || defaultVideoSettings.seconds,
        vquality: current.vquality || defaultVideoSettings.vquality,
        size: current.size || defaultVideoSettings.size,
    };
    const adjusted: string[] = [];
    const availableQualities = Object.keys(def.resolutions);
    if (!availableQualities.includes(settings.vquality)) {
        const curNum = Number(settings.vquality);
        if (Number.isFinite(curNum)) {
            let closest = availableQualities[0] || "768";
            let minDiff = Math.abs(Number(closest) - curNum);
            for (const q of availableQualities) {
                const diff = Math.abs(Number(q) - curNum);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = q;
                }
            }
            settings.vquality = closest;
        } else {
            settings.vquality = availableQualities[0] || "768";
        }
        adjusted.push("quality");
    }
    const availableSizes = def.resolutions[settings.vquality] ? Object.keys(def.resolutions[settings.vquality]) : ["16:9"];
    if (!availableSizes.includes(settings.size)) {
        settings.size = availableSizes[0] || "16:9";
        adjusted.push("size");
    }
    const minDuration = def.protocol === "standard" ? 2 : 1;
    const seconds = Number(settings.seconds);
    if (!Number.isInteger(seconds) || seconds < minDuration || seconds > def.maxDuration) {
        settings.seconds = String(Math.min(def.maxDuration, Math.max(minDuration, seconds || 5)));
        adjusted.push("seconds");
    }
    return { settings, adjusted };
}

export const defaultVideoSettings = {
    model: DEFAULT_CANVAS_VIDEO_MODEL,
    seconds: "5",
    vquality: "768",
    size: "16:9",
};

export function videoConfigPatch(key: string, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "vquality") return { vquality: value };
    if (key === "size") return { size: value };
    if (key === "negativePrompt" || key === "videoNegativePrompt") return { negativePrompt: value };
    if (key === "generateAudio" || key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

export function filterCanvasVideoModels(available: readonly string[]) {
    return canvasVideoModels.filter((item) => available.includes(item.model)).map((item) => item.model);
}

export type VideoReferenceCounts = {
    imageCount?: number;
    audioCount?: number;
    videoCount?: number;
    prompt?: string;
};

export function videoSettingsIssues(config: AiConfig, available: readonly string[], counts: VideoReferenceCounts = {}): string[] {
    const { imageCount = 0, audioCount = 0, videoCount = 0, prompt } = counts;
    const issues: string[] = [];
    const model = (config.model || config.videoModel || "").trim();
    const def = getCanvasVideoModel(model);
    if (!def || !available.includes(model)) {
        return [i18n.t("integration.modelUnavailable", { model: model || "unknown" })];
    }

    if (def.protocol === "standard") {
        if (imageCount === 0) {
            if (prompt !== undefined && !prompt.trim()) {
                issues.push(i18n.t("integration.videoPromptRequired"));
            }
            if (config.size === "adaptive") {
                issues.push(i18n.t("integration.videoAdaptiveRequiresImage"));
            }
        } else if (imageCount === 1 || (imageCount === 2 && config.videoMode !== "reference")) {
            // 首尾帧过渡模式与音频互斥
            if (audioCount > 0) {
                issues.push(i18n.t("integration.videoFrameAudioConflict"));
            }
        }
    } else {
        if (def.maxImages > 0 && imageCount < 1) {
            issues.push(i18n.t("integration.videoReferenceRequired"));
        }
    }

    if (imageCount > def.maxImages) {
        issues.push(i18n.t("integration.videoImageLimit", { max: def.maxImages }));
    }
    if (audioCount < def.minAudio || audioCount > def.maxAudio) {
        issues.push(i18n.t("integration.videoAudioLimit", { min: def.minAudio, max: def.maxAudio }));
    }
    if (videoCount > 0) issues.push(i18n.t("integration.videoReferencesUnsupported"));

    const minDuration = def.protocol === "standard" ? 2 : 1;
    const seconds = Number(config.videoSeconds);
    if (!Number.isInteger(seconds) || seconds < minDuration || seconds > def.maxDuration) {
        issues.push(i18n.t("integration.invalidSettings", { fields: i18n.t("settingsPanels.video.seconds") }));
    }
    if (!def.resolutions[config.vquality]?.[config.size]) {
        issues.push(i18n.t("integration.invalidSettings", { fields: `${i18n.t("settingsPanels.video.quality")} / ${i18n.t("settingsPanels.video.size")}` }));
    }
    return issues;
}
