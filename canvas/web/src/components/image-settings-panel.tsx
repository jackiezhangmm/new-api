import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ConfigProvider, Switch, Tooltip } from "antd";
import i18n from "@/i18n";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { getCanvasImageModel, imageSettingsIssues, type ImageSettings } from "@/lib/canvas/image-models";
import type { AiConfig } from "@/stores/use-config-store";

export const imageQualityOptions = ["low", "medium"].map((value) => ({
    value,
    get label() {
        return imageQualityLabel(value);
    },
}));
export const imageAspectOptions = getCanvasImageModel("gpt-image-2")!.operations.generation!.sizing.aspectRatios.map((value) => ({ value, label: imageAspectLabel(value) }));
export const imageScaleOptions = getCanvasImageModel("gpt-image-2")!.operations.generation!.sizing.resolutions.map((value) => ({ value, label: value.toUpperCase() }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: keyof ImageSettings, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "space-y-4" }: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const modelDef = getCanvasImageModel(config.model);
    const operation = modelDef?.operations.generation;
    const isMidjourney = modelDef?.protocol === "midjourney";
    const issues = imageSettingsIssues(config, config.models);
    const count = Number(config.count) || 1;

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-2">
                    {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : <span />}
                    {operation ? (
                        <Tooltip title={t("integration.resetSettings")}>
                            <Button
                                type="text"
                                size="small"
                                className="!h-7 !w-7 !p-0"
                                aria-label={t("integration.resetSettings")}
                                icon={<RotateCcw className="size-4" />}
                                onClick={() => {
                                    for (const [key, value] of Object.entries(operation.defaults)) {
                                        if (key !== "model") onConfigChange(key as keyof ImageSettings, value || "");
                                    }
                                }}
                            />
                        </Tooltip>
                    ) : null}
                </div>
                {issues.length ? (
                    <div role="alert" className="text-xs leading-5 text-red-600 dark:text-red-400">
                        {issues.join("\n")}
                    </div>
                ) : null}
                {operation ? (
                    <>
                        {operation.qualities ? (
                            <div className="space-y-2.5">
                                <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.quality")}</SettingTitle>
                                <div className="grid grid-cols-2 gap-2.5">
                                    {operation.qualities.map((value) => (
                                        <OptionPill key={value} selected={config.quality === value} theme={theme} onClick={() => onConfigChange("quality", value)}>
                                            {imageQualityLabel(value)}
                                        </OptionPill>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {operation.sizing.resolutions.length > 0 ? (
                            <div className="space-y-2.5">
                                <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.resolution")}</SettingTitle>
                                <div className="grid grid-cols-3 gap-2.5">
                                    {operation.sizing.resolutions.map((value) => (
                                        <OptionPill key={value} selected={config.resolution === value} theme={theme} onClick={() => onConfigChange("resolution", value)}>
                                            {value.toUpperCase()}
                                        </OptionPill>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <div className="space-y-2.5">
                            <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.aspectRatio")}</SettingTitle>
                            <div className="grid grid-cols-4 gap-2.5">
                                {operation.sizing.aspectRatios.map((value) => (
                                    <OptionPill key={value} selected={config.aspectRatio === value} theme={theme} onClick={() => onConfigChange("aspectRatio", value)}>
                                        {imageAspectLabel(value)}
                                    </OptionPill>
                                ))}
                            </div>
                        </div>
                        {operation.backgrounds?.includes("transparent") ? (
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-0.5">
                                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.transparent")}</SettingTitle>
                                    <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                        {t("settingsPanels.image.transparentHint")}
                                    </div>
                                </div>
                                <span onMouseDown={(event) => event.stopPropagation()}>
                                    <Switch size="small" checked={config.background === "transparent"} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                                </span>
                            </div>
                        ) : null}
                        <div className="space-y-2.5">
                            <SettingTitle color={theme.node.muted}>
                                {isMidjourney ? t("settingsPanels.image.countGroup") : t("settingsPanels.image.count")}
                            </SettingTitle>
                            <div className={isMidjourney ? "flex gap-2.5" : "grid grid-cols-4 gap-2.5"}>
                                {Array.from({ length: operation.maxOutputs }, (_, index) => index + 1).map((value) => (
                                    <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                        {isMidjourney
                                            ? t("settingsPanels.image.groups", { count: value })
                                            : t("settingsPanels.image.images", { count: value })}
                                    </OptionPill>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: {
                    Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text },
                    Slider: { railBg: theme.node.stroke, railHoverBg: theme.node.stroke, trackBg: theme.node.activeStroke, handleColor: theme.node.text, handleActiveColor: theme.node.text },
                },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            className="h-9 cursor-pointer rounded-full border px-3 text-sm transition hover:opacity-80"
            style={{ borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text, background: selected ? theme.node.fill : "transparent" }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

const qualityLabels: Record<string, string> = { auto: "自动", high: "高", medium: "中", low: "低" };

export function imageQualityLabel(value: string | undefined) {
    return (value && qualityLabels[value]) || value || "";
}

export function imageAspectLabel(value: string | undefined) {
    if (!value) return "";
    return value === "auto" ? "自动" : value;
}

export const imageSizeLabel = imageAspectLabel;
