import i18n from "@/i18n";
import type { AiConfig } from "@/stores/use-config-store";

export const DEFAULT_CANVAS_VIDEO_MODEL = "minimax_h3_zm_u24";

export type CanvasVideoModelDefinition = {
    model: string;
    label: string;
    resolutions: string[];
    minDuration: number;
    maxDuration: number;
    defaultDuration: number;
    requiresReferenceImage: boolean;
};

export const canvasVideoModels: CanvasVideoModelDefinition[] = [
    {
        model: "minimax_h3_zm_u24",
        label: "MiniMax H3 (AutoDL)",
        resolutions: ["480p", "768p"],
        minDuration: 1,
        maxDuration: 15,
        defaultDuration: 5,
        requiresReferenceImage: true,
    },
];

export function getCanvasVideoModel(model: string) {
    return canvasVideoModels.find((item) => item.model === model);
}

export const defaultVideoSettings = {
    model: DEFAULT_CANVAS_VIDEO_MODEL,
    seconds: "5",
    vquality: "768",
    videoMode: "frames",
    generateAudio: "true",
    watermark: "false",
};

export function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

export function filterCanvasVideoModels(available: readonly string[]) {
    return canvasVideoModels.filter((item) => available.includes(item.model)).map((item) => item.model);
}

export function videoSettingsIssues(config: AiConfig, available: readonly string[], referenceCount = 0): string[] {
    const issues: string[] = [];
    const model = (config.model || config.videoModel || "").trim();
    if (!model || !available.includes(model)) {
        issues.push(i18n.t("integration.modelUnavailable", { model: model || "unknown" }));
        return issues;
    }
    const def = getCanvasVideoModel(model);
    if (def?.requiresReferenceImage && referenceCount < 1) {
        issues.push(i18n.t("integration.videoReferenceRequired"));
    }
    const seconds = Number(config.videoSeconds) || 5;
    if (def && (seconds < def.minDuration || seconds > def.maxDuration)) {
        issues.push(i18n.t("integration.invalidSettings", { fields: i18n.t("settingsPanels.video.seconds") }));
    }
    return issues;
}
