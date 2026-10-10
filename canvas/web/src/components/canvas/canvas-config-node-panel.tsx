import type { CSSProperties } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Play, Settings2, Square, Video } from "lucide-react";
import { Button, Segmented } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { auxiliaryTextIssues, DEFAULT_AUXILIARY_TEXT_MODEL, imageSettingsIssues } from "@/lib/canvas/image-models";
import { DEFAULT_CANVAS_VIDEO_MODEL, videoConfigPatch, videoSettingsIssues } from "@/lib/canvas/video-models";
import { canvasCapabilities } from "@/lib/canvas/canvas-capabilities";
import { useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();
    const effectiveConfig = useEffectiveConfig();
    const mode: CanvasGenerationMode = (node.metadata?.generationMode as CanvasGenerationMode) || "image";
    const isText = mode === "text";
    const isVideo = mode === "video";
    const config = buildGenerationConfig(effectiveConfig, node, mode);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const issues = isText ? auxiliaryTextIssues(effectiveConfig.models, DEFAULT_AUXILIARY_TEXT_MODEL) : isVideo ? videoSettingsIssues(config, config.models, { imageCount: inputSummary.imageCount, audioCount: inputSummary.audioCount, videoCount: inputSummary.videoCount }) : imageSettingsIssues(config, config.models);
    const hasPrompt = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim()) || inputSummary.textCount > 0;

    const isPromptRequired = !(isVideo && inputSummary.imageCount > 0);
    const canSubmit = isRunning || (!issues.length && (!isPromptRequired || hasPrompt));

    if (!canvasCapabilities.generation) return null;

    const modeOptions = [
        {
            value: "image",
            label: (
                <span className="inline-flex items-center gap-1">
                    <ImageIcon className="size-3.5" />
                    {t("canvas.configNode.image")}
                </span>
            ),
        },
        ...(canvasCapabilities.video
            ? [
                  {
                      value: "video",
                      label: (
                          <span className="inline-flex items-center gap-1">
                              <Video className="size-3.5" />
                              {t("canvas.configNode.video")}
                          </span>
                      ),
                  },
              ]
            : []),
        ...(canvasCapabilities.auxiliaryText
            ? [
                  {
                      value: "text",
                      label: (
                          <span className="inline-flex items-center gap-1">
                              <MessageSquare className="size-3.5" />
                              {t("canvas.configNode.text")}
                          </span>
                      ),
                  },
              ]
            : []),
    ];

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{t("canvas.configNode.title")}</div>
                {modeOptions.length > 1 ? (
                    <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                        <Segmented
                            size="small"
                            className="canvas-config-mode !rounded-md !p-0.5"
                            value={mode}
                            onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode, model: value === "text" ? DEFAULT_AUXILIARY_TEXT_MODEL : value === "video" ? DEFAULT_CANVAS_VIDEO_MODEL : undefined })}
                            options={modeOptions}
                        />
                    </div>
                ) : null}
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
                <InputChip label={t("canvas.configNode.prompt")} value={t("canvas.configNode.items", { count: inputSummary.textCount })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.references")} value={t("canvas.configNode.images", { count: inputSummary.imageCount })} style={chipStyle} />
                {inputSummary.videoCount > 0 ? (
                    <InputChip label={t("canvas.configNode.videoReferences")} value={t("canvas.configNode.items", { count: inputSummary.videoCount })} style={chipStyle} />
                ) : null}
                {inputSummary.audioCount > 0 ? (
                    <InputChip label={t("canvas.configNode.audioReferences")} value={t("canvas.configNode.items", { count: inputSummary.audioCount })} style={chipStyle} />
                ) : null}
                <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    <Settings2 className="size-3.5" />
                    {t("canvas.configNode.compose")}
                </button>
            </div>

            {issues.length ? (
                <div role="alert" className="mb-2 max-h-16 overflow-auto text-xs text-red-600">
                    {issues.join("\n")}
                </div>
            ) : null}

            <div className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px] items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker
                    className="canvas-compact-control h-10"
                    config={config}
                    value={isText ? DEFAULT_AUXILIARY_TEXT_MODEL : isVideo ? (config.model || DEFAULT_CANVAS_VIDEO_MODEL) : config.model}
                    onChange={(model) => onConfigChange(node.id, { model })}
                    capability={mode}
                    fullWidth
                />
                {isText ? (
                    <CanvasTextSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                    />
                ) : isVideo ? (
                    <CanvasVideoSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        imageCount={inputSummary.imageCount}
                        audioCount={inputSummary.audioCount}
                        onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                    />
                ) : (
                    <CanvasImageSettingsPopover
                        config={config}
                        placement="topRight"
                        autoAdjustOverflow={false}
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                    />
                )}
            </div>

            <Button
                type="primary"
                className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
                danger={isRunning}
                disabled={!canSubmit}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <Square className="size-3.5 fill-current" />
                            <span>{t("canvas.configNode.stop")}</span>
                        </>
                    ) : (
                        <>
                            <Play className="size-4" />
                            <span>{t("canvas.configNode.generate")}</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}
