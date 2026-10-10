import { useState, type ReactNode } from "react";
import { Slider, Switch } from "antd";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { getCanvasVideoModel } from "@/lib/canvas/video-models";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { boolConfig, type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "768", label: "768p" },
    { value: "1080", label: "1080p" },
];

export const videoRatioOptions = [
    { value: "16:9", labelKey: "landscape", width: 16, height: 9 },
    { value: "9:16", labelKey: "portrait", width: 9, height: 16 },
    { value: "1:1", labelKey: "square", width: 1, height: 1 },
    { value: "4:3", labelKey: "standardLandscape", width: 4, height: 3 },
    { value: "3:4", labelKey: "standardPortrait", width: 3, height: 4 },
    { value: "adaptive", labelKey: "adaptive", width: 0, height: 0 },
] as const;

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({
    value: item.value,
    get label() {
        return i18n.t(`settingsPanels.video.sizes.${item.labelKey}`);
    },
}));
export const videoSecondsRange = { min: 1, max: 30 };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    imageCount?: number;
    audioCount?: number;
};

export function VideoSettingsPanel({
    config,
    onConfigChange,
    theme,
    showTitle = true,
    className = "w-[300px] space-y-4 rounded-2xl px-1 py-0.5",
    imageCount,
    audioCount,
}: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const def = getCanvasVideoModel(config.model || config.videoModel);
    const minSeconds = def?.protocol === "standard" ? 2 : 1;
    const maxSeconds = def?.maxDuration || 15;
    const seconds = Number(config.videoSeconds) || 5;
    const resolution = config.vquality;
    const selectedRatio = config.size;
    const isAudioConnected = (audioCount ?? 0) > 0;
    const resolutions = def ? Object.keys(def.resolutions).map((value) => ({ value, label: `${value}p` })) : resolutionOptions;
    const resolutionForRatios = def && def.resolutions[config.vquality] ? config.vquality : def ? Object.keys(def.resolutions)[0] : "";
    const ratios = def ? videoRatioOptions.filter((item) => Boolean(def.resolutions[resolutionForRatios]?.[item.value])) : videoRatioOptions;

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {resolutions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {ratios.map((item) => {
                            const isAdaptiveDisabled = item.value === "adaptive" && imageCount === 0;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    disabled={isAdaptiveDisabled}
                                    title={isAdaptiveDisabled ? t("integration.videoAdaptiveRequiresImage") : undefined}
                                    className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
                                    style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", item.value)}
                                >
                                    <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                    <span>{t(`settingsPanels.video.sizes.${item.labelKey}`)}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="min-w-0 flex-1" min={minSeconds} max={maxSeconds} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        <SecondsInput min={minSeconds} max={maxSeconds} value={seconds} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                        <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>
                            s
                        </span>
                    </div>
                </SettingGroup>
                <div className="pt-1">
                    <button
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between text-xs font-medium transition hover:opacity-80"
                        style={{ color: theme.node.muted }}
                        onClick={() => setAdvancedOpen((v) => !v)}
                    >
                        <span>{t("settingsPanels.video.advanced")}</span>
                        {advancedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    {advancedOpen ? (
                        <div className="mt-2.5 space-y-3">
                            <SettingGroup title={t("settingsPanels.video.negativePrompt")} color={theme.node.muted}>
                                <textarea
                                    rows={2}
                                    value={config.negativePrompt || ""}
                                    placeholder={t("settingsPanels.video.negativePromptPlaceholder")}
                                    className="thin-scrollbar w-full resize-none rounded-xl border bg-transparent p-2 text-xs outline-none"
                                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                    onChange={(event) => onConfigChange("negativePrompt", event.target.value)}
                                    onMouseDown={(event) => event.stopPropagation()}
                                />
                            </SettingGroup>
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                        {t("settingsPanels.video.generateAudio")}
                                    </div>
                                    {isAudioConnected ? (
                                        <div className="text-[11px] text-amber-500">
                                            {t("settingsPanels.video.externalAudioConnectedHint")}
                                        </div>
                                    ) : null}
                                </div>
                                <Switch
                                    size="small"
                                    disabled={isAudioConnected}
                                    checked={isAudioConnected ? false : boolConfig(config.videoGenerateAudio, true)}
                                    onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))}
                                />
                            </div>
                            {imageCount === 2 ? (
                                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                                    <div className="grid grid-cols-2 gap-2">
                                        <OptionPill selected={config.videoMode !== "reference"} theme={theme} onClick={() => onConfigChange("videoMode", "frames")}>
                                            {t("settingsPanels.video.modes.frames")}
                                        </OptionPill>
                                        <OptionPill selected={config.videoMode === "reference"} theme={theme} onClick={() => onConfigChange("videoMode", "reference")}>
                                            {t("settingsPanels.video.modes.reference")}
                                        </OptionPill>
                                    </div>
                                </SettingGroup>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();
    return raw ? `${raw.replace(/p$/, "")}p` : "—";
}

export function videoSizeLabel(value: string) {
    const normalized = normalizeVideoSizeValue(value);
    if (normalized === "9:16") return i18n.t("settingsPanels.video.sizes.portrait");
    if (normalized === "1:1") return i18n.t("settingsPanels.video.sizes.square");
    if (normalized === "4:3") return i18n.t("settingsPanels.video.sizes.standardLandscape");
    if (normalized === "3:4") return i18n.t("settingsPanels.video.sizes.standardPortrait");
    if (normalized === "adaptive") return i18n.t("settingsPanels.video.sizes.adaptive");
    return i18n.t("settingsPanels.video.sizes.landscape");
}

export function videoSecondsLabel(value: string) {
    const seconds = Math.max(1, Math.min(30, Number(value) || 5));
    return `${seconds}s`;
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoSizeValue(value: string) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();
    if (raw === "9:16" || raw.includes("竖") || raw.includes("portrait")) return "9:16";
    if (raw === "1:1" || raw.includes("方") || raw.includes("square")) return "1:1";
    if (raw === "4:3") return "4:3";
    if (raw === "3:4") return "3:4";
    if (raw === "adaptive" || raw.includes("自适应")) return "adaptive";
    return "16:9";
}

export function normalizeVideoResolutionValue(value: string) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();
    if (raw.includes("1080")) return "1080";
    if (raw.includes("720")) return "720";
    if (raw.includes("480")) return "480";
    return "768";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SecondsInput({ value, min = 1, max, theme, onCommit }: { value: number; min?: number; max: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Math.max(min, Math.min(max, Math.floor(Number(input.value) || 5)));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={min}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) {
        return <span className="rounded-[3px] border-2 border-dashed" style={{ width: 22, height: 16, borderColor: color }} />;
    }
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
