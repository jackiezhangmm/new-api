import i18n from "@/i18n";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const canvasCapabilities = {
    generation: true,
    imageEditing: true,
    auxiliaryText: true,
    promptLibrary: true,
    video: true,
    audio: true,
    audioGeneration: false,
    plugins: false,
    agent: false,
    externalPrompts: false,
    projectTransfer: false,
    externalConfig: false,
};

export function requireCanvasCapability(capability: keyof typeof canvasCapabilities) {
    if (!canvasCapabilities[capability]) throw new Error(i18n.t("integration.unavailable"));
}

export function isCanvasNodeAllowed(type: string) {
    return [CanvasNodeType.Image, CanvasNodeType.Text, CanvasNodeType.Config, CanvasNodeType.Group, CanvasNodeType.Video, CanvasNodeType.Audio].some((allowed) => allowed === type);
}

export function assertCanvasNodesAllowed(nodes: CanvasNodeData[]) {
    if (nodes.some((node) => !isCanvasNodeAllowed(node.type) || (node.metadata?.generationMode && node.metadata.generationMode !== "image" && node.metadata.generationMode !== "text" && node.metadata.generationMode !== "video"))) {
        throw new Error(i18n.t("integration.unsupportedProject"));
    }
}
