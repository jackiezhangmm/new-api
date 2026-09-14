import i18n from "@/i18n";

export type ImageSettings = {
    model: string;
    resolution?: string;
    aspectRatio?: string;
    quality: string;
    size: string;
    background: string;
    count: string;
};

export type ImageOperation = {
    sizing: { kind: "resolution-ratio"; resolutions: readonly string[]; aspectRatios: readonly string[] };
    qualities?: readonly string[];
    backgrounds?: readonly string[];
    maxOutputs: number;
    maxReferences?: number;
    defaults: ImageSettings;
};

export type CanvasImageModel = {
    model: string;
    protocol: "openai-image" | "gemini";
    supportsMaskEdit?: boolean;
    supportsOutputFormat?: boolean;
    operations: { generation?: ImageOperation; edit?: ImageOperation };
};

export const DEFAULT_AUXILIARY_TEXT_MODEL = "gpt-5.6-terra";
export const canvasAuxiliaryTextModels: readonly string[] = ["gpt-5.6-terra"];

export function filterCanvasAuxiliaryTextModels(available: readonly string[]) {
    return canvasAuxiliaryTextModels.filter((item) => available.includes(item));
}

export function resolveAuxiliaryTextModel(available: readonly string[]) {
    return filterCanvasAuxiliaryTextModels(available)[0];
}

export function auxiliaryTextIssues(available: readonly string[], model = DEFAULT_AUXILIARY_TEXT_MODEL): string[] {
    if (!available.includes(model)) {
        return [i18n.t("integration.modelUnavailable", { model })];
    }
    return [];
}

export const defaultImageSettings: ImageSettings = {
    model: "gpt-image-2",
    resolution: "1k",
    aspectRatio: "1:1",
    quality: "low",
    size: "",
    background: "",
    count: "1",
};

export const defaultImageEditSettings: ImageSettings = {
    model: "gpt-image-2",
    resolution: "1k",
    aspectRatio: "auto",
    quality: "low",
    size: "",
    background: "",
    count: "1",
};

const NANO_BANANA_ASPECT_RATIOS = ["1:1", "1:4", "4:1", "1:8", "8:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const GROK_IMAGINE_ASPECT_RATIOS = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1"] as const;

// 此处仅维护已接入的画布模型，不继承作图广场名单或上游渠道配置。
export const canvasImageModels: readonly CanvasImageModel[] = [
    {
        model: "gpt-image-2",
        protocol: "openai-image",
        supportsMaskEdit: true,
        supportsOutputFormat: true,
        operations: {
            generation: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["1k", "2k", "4k"],
                    aspectRatios: ["auto", "1:1", "1:3", "3:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"],
                },
                qualities: ["low", "medium"],
                maxOutputs: 4,
                defaults: defaultImageSettings,
            },
            edit: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["1k", "2k", "4k"],
                    aspectRatios: ["auto", "1:1", "1:3", "3:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"],
                },
                qualities: ["low", "medium"],
                maxOutputs: 4,
                maxReferences: 3,
                defaults: defaultImageEditSettings,
            },
        },
    },
    {
        model: "nano-banana-2",
        protocol: "gemini",
        supportsMaskEdit: false,
        operations: {
            generation: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["512", "1k", "2k", "4k"],
                    aspectRatios: NANO_BANANA_ASPECT_RATIOS,
                },
                maxOutputs: 1,
                defaults: {
                    model: "nano-banana-2",
                    resolution: "1k",
                    aspectRatio: "1:1",
                    quality: "",
                    size: "",
                    background: "",
                    count: "1",
                },
            },
            edit: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["512", "1k", "2k", "4k"],
                    aspectRatios: ["auto", ...NANO_BANANA_ASPECT_RATIOS],
                },
                maxOutputs: 1,
                maxReferences: 14,
                defaults: {
                    model: "nano-banana-2",
                    resolution: "1k",
                    aspectRatio: "auto",
                    quality: "",
                    size: "",
                    background: "",
                    count: "1",
                },
            },
        },
    },
    {
        model: "nano-banana-2-lite",
        protocol: "gemini",
        supportsMaskEdit: false,
        operations: {
            generation: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["1k"],
                    aspectRatios: NANO_BANANA_ASPECT_RATIOS,
                },
                maxOutputs: 1,
                defaults: {
                    model: "nano-banana-2-lite",
                    resolution: "1k",
                    aspectRatio: "1:1",
                    quality: "",
                    size: "",
                    background: "",
                    count: "1",
                },
            },
            edit: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["1k"],
                    aspectRatios: ["auto", ...NANO_BANANA_ASPECT_RATIOS],
                },
                maxOutputs: 1,
                maxReferences: 14,
                defaults: {
                    model: "nano-banana-2-lite",
                    resolution: "1k",
                    aspectRatio: "auto",
                    quality: "",
                    size: "",
                    background: "",
                    count: "1",
                },
            },
        },
    },
    {
        model: "grok-imagine-image-2.0",
        protocol: "openai-image",
        supportsMaskEdit: false,
        operations: {
            generation: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["1k", "2k"],
                    aspectRatios: GROK_IMAGINE_ASPECT_RATIOS,
                },
                qualities: ["low", "medium"],
                maxOutputs: 10,
                defaults: {
                    model: "grok-imagine-image-2.0",
                    resolution: "1k",
                    aspectRatio: "1:1",
                    quality: "low",
                    size: "",
                    background: "",
                    count: "1",
                },
            },
            edit: {
                sizing: {
                    kind: "resolution-ratio",
                    resolutions: ["1k", "2k"],
                    aspectRatios: GROK_IMAGINE_ASPECT_RATIOS,
                },
                maxOutputs: 10,
                maxReferences: 3,
                defaults: {
                    model: "grok-imagine-image-2.0",
                    resolution: "1k",
                    aspectRatio: "auto",
                    quality: "",
                    size: "",
                    background: "",
                    count: "1",
                },
            },
        },
    },
];

export function getCanvasImageModel(model: string) {
    return canvasImageModels.find((item) => item.model === model);
}

export function filterCanvasImageModels(available: readonly string[]) {
    return canvasImageModels.filter((item) => available.includes(item.model)).map((item) => item.model);
}

export function imageSettingsIssues(settings: ImageSettings, available: readonly string[], operation: "generation" | "edit" = "generation", referenceCount?: number) {
    const issues: string[] = [];
    const model = getCanvasImageModel(settings.model);
    if (!model || !available.includes(settings.model)) issues.push(i18n.t("integration.modelUnavailable", { model: settings.model }));
    const capability = model?.operations[operation];
    if (!capability) {
        if (model) issues.push(i18n.t("integration.unavailable"));
        return issues;
    }
    const invalid: string[] = [];
    if (operation === "edit") {
        const maxRefs = capability.maxReferences ?? 3;
        if (referenceCount === undefined || !Number.isInteger(referenceCount) || referenceCount < 1 || referenceCount > maxRefs) {
            invalid.push(i18n.t("integration.settings.references"));
        }
    }
    if (!capability.sizing.resolutions.includes(settings.resolution || "")) invalid.push(i18n.t("settingsPanels.image.resolution"));
    if (!capability.sizing.aspectRatios.includes(settings.aspectRatio || "")) invalid.push(i18n.t("settingsPanels.image.aspectRatio"));
    if (settings.size) invalid.push(i18n.t("settingsPanels.image.size"));
    if (capability.qualities ? !capability.qualities.includes(settings.quality) : Boolean(settings.quality)) invalid.push(i18n.t("settingsPanels.image.quality"));
    if (settings.background && !capability.backgrounds?.includes(settings.background)) invalid.push(i18n.t("settingsPanels.image.transparent"));
    const count = Number(settings.count);
    if (!Number.isInteger(count) || count < 1 || count > capability.maxOutputs) invalid.push(i18n.t("settingsPanels.image.count"));
    if (invalid.length) issues.push(i18n.t("integration.invalidSettings", { fields: invalid.join("、") }));
    return issues;
}

export function resolveImageSettings(global: ImageSettings, node?: Partial<Omit<ImageSettings, "count">> & { count?: number | string }, operation: "generation" | "edit" = "generation"): ImageSettings {
    const model = node?.model ?? global.model;
    const canvasModel = getCanvasImageModel(model);
    const capability = canvasModel?.operations[operation] ?? canvasModel?.operations.generation;
    const defaults = capability?.defaults ?? (operation === "edit" ? defaultImageEditSettings : defaultImageSettings);
    const isSupported = Boolean(capability);
    const legacySize = Boolean(node?.size && !node.resolution && !node.aspectRatio);

    if (isSupported && capability) {
        const resolution = node?.resolution ?? (operation === "edit" && !node?.resolution ? defaults.resolution : global.resolution);
        const aspectRatio = node?.aspectRatio ?? (operation === "edit" && !node?.aspectRatio ? defaults.aspectRatio : global.aspectRatio);
        const quality = node?.quality ?? global.quality;
        const count = Number(node?.count ?? global.count);

        return {
            model,
            resolution: capability.sizing.resolutions.includes(resolution || "") ? resolution : defaults.resolution,
            aspectRatio: capability.sizing.aspectRatios.includes(aspectRatio || "") ? aspectRatio : defaults.aspectRatio,
            quality: capability.qualities ? (capability.qualities.includes(quality) ? quality : defaults.quality) : defaults.quality,
            size: "",
            background: capability.backgrounds?.includes(node?.background ?? "") ? (node?.background ?? "") : capability.backgrounds?.includes(global.background) ? global.background : "",
            count: Number.isInteger(count) && count >= 1 && count <= capability.maxOutputs ? String(count) : defaults.count,
        };
    }

    return {
        model,
        resolution: node?.resolution ?? (legacySize ? undefined : operation === "edit" ? defaults.resolution : global.resolution),
        aspectRatio: node?.aspectRatio ?? (legacySize ? undefined : operation === "edit" ? defaults.aspectRatio : global.aspectRatio),
        quality: node?.quality ?? global.quality,
        size: node?.size ?? global.size ?? "",
        background: node?.background ?? global.background,
        count: String(node?.count ?? global.count),
    };
}

export function switchImageModel(current: ImageSettings, model: string) {
    const capability = getCanvasImageModel(model)?.operations.generation;
    if (!capability) throw new Error(i18n.t("integration.modelUnavailable", { model }));
    const settings = { ...current, model };
    const adjusted: (keyof ImageSettings)[] = [];
    const allowed: Partial<Record<keyof ImageSettings, readonly string[]>> = {
        resolution: capability.sizing.resolutions,
        aspectRatio: capability.sizing.aspectRatios,
        quality: capability.qualities || [""],
        background: capability.backgrounds ? ["", ...capability.backgrounds] : [""],
        size: [""],
    };
    for (const key of Object.keys(allowed) as (keyof typeof allowed)[]) {
        if (!allowed[key]!.includes(current[key] ?? "")) {
            settings[key] = capability.defaults[key] as string;
            adjusted.push(key);
        }
    }
    if (!Number.isInteger(Number(current.count)) || Number(current.count) < 1 || Number(current.count) > capability.maxOutputs) {
        settings.count = capability.defaults.count;
        adjusted.push("count");
    }
    return { settings, adjusted };
}

export function buildCanvasImageRequest(settings: ImageSettings, prompt: string, available: readonly string[]) {
    const issues = imageSettingsIssues(settings, available);
    if (issues.length) throw new Error(issues.join("\n"));
    if (!prompt.trim()) throw new Error(i18n.t("integration.promptRequired"));
    const modelDef = getCanvasImageModel(settings.model);
    const supportsOutputFormat = Boolean(modelDef?.supportsOutputFormat ?? (modelDef?.model === "gpt-image-2"));
    return {
        model: settings.model,
        prompt: prompt.trim(),
        n: Number(settings.count),
        size: `${settings.aspectRatio} ${settings.resolution}`,
        ...(settings.quality ? { quality: settings.quality } : {}),
        ...(settings.background ? { background: settings.background } : {}),
        response_format: "b64_json",
        ...(supportsOutputFormat ? { output_format: "png" } : {}),
    };
}

export function buildCanvasImageEditRequest(settings: ImageSettings, prompt: string, available: readonly string[], referenceCount: number) {
    const issues = imageSettingsIssues(settings, available, "edit", referenceCount);
    if (issues.length) throw new Error(issues.join("\n"));
    if (!prompt.trim()) throw new Error(i18n.t("integration.promptRequired"));
    const aspectRatio = settings.aspectRatio || "auto";
    const resolution = settings.resolution || "1k";
    const modelDef = getCanvasImageModel(settings.model);
    const supportsOutputFormat = Boolean(modelDef?.supportsOutputFormat ?? (modelDef?.model === "gpt-image-2"));
    return {
        model: settings.model,
        prompt: prompt.trim(),
        n: Number(settings.count || 1),
        size: `${aspectRatio} ${resolution}`,
        ...(settings.quality ? { quality: settings.quality } : {}),
        response_format: "b64_json",
        ...(supportsOutputFormat ? { output_format: "png" } : {}),
    };
}
