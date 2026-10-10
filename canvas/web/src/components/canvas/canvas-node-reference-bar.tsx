import { ArrowLeftRight, FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function CanvasNodeReferenceBar({
    nodeId,
    nodes,
    connectedNodes,
    onDisconnect,
    onStartSelection,
    isVideo = false,
    videoMode,
    isFrameSwap = false,
    onToggleFrameSwap,
    onToggleVideoMode,
}: {
    nodeId: string;
    nodes: CanvasNodeData[];
    connectedNodes: CanvasNodeData[];
    onDisconnect?: (fromNodeId: string, toNodeId: string) => void;
    onStartSelection?: (nodeId: string) => void;
    isVideo?: boolean;
    videoMode?: string;
    isFrameSwap?: boolean;
    onToggleFrameSwap?: () => void;
    onToggleVideoMode?: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const references = connectedNodes.flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })));
    if (!references.length && !onStartSelection) return null;

    const isImageNode = (node: CanvasNodeData) => {
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        return resource?.kind === "image" || node.type === CanvasNodeType.Image;
    };

    const imageIndices: number[] = [];
    references.forEach((ref, index) => {
        if (isImageNode(ref.node)) {
            imageIndices.push(index);
        }
    });

    const isDoubleImageFrameMode = isVideo && imageIndices.length === 2 && videoMode !== "reference";
    const isSingleImageFrameMode = isVideo && imageIndices.length === 1;

    const badges: Record<number, string> = {};
    if (isDoubleImageFrameMode) {
        if (isFrameSwap) {
            badges[imageIndices[0]] = t("canvas.references.lastFrame");
            badges[imageIndices[1]] = t("canvas.references.firstFrame");
        } else {
            badges[imageIndices[0]] = t("canvas.references.firstFrame");
            badges[imageIndices[1]] = t("canvas.references.lastFrame");
        }
    } else if (isSingleImageFrameMode) {
        badges[imageIndices[0]] = t("canvas.references.firstFrame");
    }

    return (
        <div className="mb-2">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium" style={{ color: theme.node.muted }}>
                <span>{t("canvas.references.title")}</span>
                {isVideo && imageIndices.length === 2 ? (
                    <div className="flex items-center gap-2">
                        {videoMode !== "reference" ? (
                            <button
                                type="button"
                                className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition hover:opacity-80"
                                style={{ background: theme.toolbar.activeBg, color: theme.node.text }}
                                onClick={onToggleFrameSwap}
                                title={t("canvas.references.swapFrames")}
                            >
                                <ArrowLeftRight className="size-3" />
                                <span>{t("canvas.references.swapFrames")}</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition hover:opacity-80"
                            style={{ background: theme.toolbar.activeBg, color: theme.node.text }}
                            onClick={onToggleVideoMode}
                        >
                            <span>{videoMode === "reference" ? t("canvas.references.switchToFrames") : t("canvas.references.switchToReference")}</span>
                        </button>
                    </div>
                ) : null}
            </div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map(({ node, sourceNodeId }, index) => (
                    <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} badge={badges[index]} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />
                ))}
                {onStartSelection ? (
                    <button
                        type="button"
                        className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70"
                        style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                        title={t("canvas.references.select")}
                        onClick={() => onStartSelection?.(nodeId)}
                    >
                        <Plus className="size-4" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function ReferenceItem({ node, badge, onRemove }: { node: CanvasNodeData; badge?: string; onRemove: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} />}>
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && content ? <img src={content} alt="" className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                </span>
                {badge ? (
                    <span className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 truncate rounded-b-xl bg-black/60 px-0.5 py-0.5 text-center text-[9px] font-medium leading-none text-white backdrop-blur-[2px]">
                        {badge}
                    </span>
                ) : null}
                <button type="button" className="absolute right-0 top-0 z-20 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
