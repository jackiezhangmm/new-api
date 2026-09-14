import { nanoid } from "nanoid";
import i18n from "@/i18n";
import type { AiConfig } from "@/stores/use-config-store";
import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { buildCanvasImageEditRequest, buildCanvasImageRequest } from "./image-models";
import { fitNodeSize } from "./canvas-node-size";
import { buildImageGenerationMetadata } from "./canvas-node-factory";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

type ImageGenerationRun = {
    sourceId: string;
    prompt: string;
    config: AiConfig;
    signal: AbortSignal;
    getNodes: () => CanvasNodeData[];
    setNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => void;
    addConnection: (sourceId: string, targetId: string) => void;
    onTarget?: (targetId: string) => void;
    retry?: { imageId?: string };
    references?: ReferenceImage[];
};

// 只有当前请求标识仍匹配的节点可以接受结果；每次回写都基于最新画布。
export async function runCanvasImageGeneration(
    run: ImageGenerationRun,
    io: {
        generate?: typeof requestGeneration;
        edit?: typeof requestEdit;
        store?: typeof uploadImage;
    } = { generate: requestGeneration, edit: requestEdit, store: uploadImage },
) {
    const { config, signal, sourceId, prompt, retry, references = [] } = run;
    signal.throwIfAborted();
    const source = run.getNodes().find((node) => node.id === sourceId);
    if (!source) throw new DOMException("Aborted", "AbortError");

    const isEdit = references.length > 0 || (Boolean(retry) && source.metadata?.generationType === "edit");
    if (isEdit) {
        buildCanvasImageEditRequest(config, prompt, config.models, references.length);
    } else {
        buildCanvasImageRequest(config, prompt, config.models);
    }

    const reuse = Boolean(retry) || (source.type === CanvasNodeType.Image && !source.metadata?.content);
    const targetId = reuse ? sourceId : nanoid();
    const generationId = nanoid();
    const pending: CanvasNodeImage[] = Array.from({ length: Number(config.count) }, () => ({ id: nanoid(), status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }));
    const metadata = buildImageGenerationMetadata(isEdit ? "edit" : "generation", config, retry?.imageId ? (source.metadata?.count ?? 1) : Number(config.count), references);
    if (retry?.imageId && !source.metadata?.images?.some((image) => image.id === retry.imageId)) throw new DOMException("Aborted", "AbortError");
    const target: CanvasNodeData = {
        id: targetId,
        type: CanvasNodeType.Image,
        title: prompt.slice(0, 32),
        position: { x: source.position.x + source.width + 96, y: source.position.y },
        width: 340,
        height: 240,
        metadata: { ...metadata, prompt, generationId, status: "loading", images: pending },
    };
    run.onTarget?.(targetId);
    run.setNodes((nodes) => {
        if (signal.aborted || !nodes.some((node) => node.id === sourceId)) return nodes;
        const updated = nodes.map((node) => {
            if (node.id !== sourceId) return node;
            if (!reuse) return { ...node, metadata: { ...node.metadata, generationId, status: "loading" as const, errorDetails: undefined } };
            const images = retry?.imageId ? node.metadata?.images?.map((image) => (image.id === retry.imageId ? { ...image, status: "loading" as const, errorDetails: undefined } : image)) : pending;
            return { ...node, metadata: { ...node.metadata, ...metadata, prompt, generationId, status: "loading" as const, images, errorDetails: undefined } };
        });
        return reuse ? updated : [...updated, target];
    });
    if (!reuse) run.addConnection(sourceId, targetId);
    try {
        const editFn = io.edit ?? io.generate ?? requestEdit;
        const generateFn = io.generate ?? requestGeneration;
        const storeFn = io.store ?? uploadImage;
        const onTaskId = (taskId: string) => {
            run.setNodes((nodes) =>
                nodes.map((node) => {
                    if (node.metadata?.generationId !== generationId) return node;
                    if (node.id !== targetId && (!reuse || node.id !== sourceId)) return node;
                    return { ...node, metadata: { ...node.metadata, mjTaskId: taskId } };
                }),
            );
        };
        const onProgress = (progress: string) => {
            run.setNodes((nodes) =>
                nodes.map((node) => {
                    if (node.metadata?.generationId !== generationId) return node;
                    if (node.id !== targetId && (!reuse || node.id !== sourceId)) return node;
                    return { ...node, metadata: { ...node.metadata, progress } };
                }),
            );
        };
        const images = isEdit
            ? await editFn(config, prompt, references, { signal, onTaskId, onProgress })
            : await generateFn(config, prompt, { signal, onTaskId, onProgress });
        signal.throwIfAborted();
        if (!run.getNodes().some((node) => node.id === sourceId) || !run.getNodes().some((node) => node.id === targetId && node.metadata?.generationId === generationId)) throw new DOMException("Aborted", "AbortError");
        const stored = await Promise.all(
            images.map(async (image) => {
                const img = image as { id: string; url?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string; dataUrl?: string };
                if (img.storageKey && img.url) {
                    return {
                        id: retry?.imageId || img.id,
                        status: "success" as const,
                        content: img.url,
                        storageKey: img.storageKey,
                        naturalWidth: img.width || 0,
                        naturalHeight: img.height || 0,
                        bytes: img.bytes || 0,
                        mimeType: img.mimeType || "",
                    };
                }
                const value = await storeFn(img.dataUrl || img.url || "", { signal });
                return { id: retry?.imageId || img.id, status: "success" as const, content: value.url, storageKey: value.storageKey, naturalWidth: value.width, naturalHeight: value.height, bytes: value.bytes, mimeType: value.mimeType };
            }),
        );
        signal.throwIfAborted();
        if (!run.getNodes().some((node) => node.id === targetId && node.metadata?.generationId === generationId)) throw new DOMException("Aborted", "AbortError");
        run.setNodes((nodes) =>
            nodes.map((node) => {
                if (signal.aborted || node.metadata?.generationId !== generationId) return node;
                if (node.id !== targetId) return node.id === sourceId ? { ...node, metadata: { ...node.metadata, generationId: undefined, status: "success" as const } } : node;
                const items = retry?.imageId ? node.metadata.images?.map((item) => (item.id === retry.imageId ? stored[0] : item)) || stored : stored;
                const primary = items.find((item) => item.id === node.metadata?.primaryImageId && item.status === "success") || items.find((item) => item.status === "success")!;
                const original = reuse ? source : target;
                const unchangedGeometry = node.width === original.width && node.height === original.height && node.position.x === original.position.x && node.position.y === original.position.y;
                const size = !retry?.imageId && !node.metadata.freeResize && unchangedGeometry ? fitNodeSize(primary.naturalWidth, primary.naturalHeight, 340, 240) : null;
                return {
                    ...node,
                    ...(size ? { ...size, position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 } } : {}),
                    metadata: {
                        ...node.metadata,
                        generationId: undefined,
                        mjTaskId: undefined,
                        progress: undefined,
                        status: "success" as const,
                        errorDetails: undefined,
                        images: items,
                        primaryImageId: primary.id,
                        content: primary.content,
                        storageKey: primary.storageKey,
                        naturalWidth: primary.naturalWidth,
                        naturalHeight: primary.naturalHeight,
                        bytes: primary.bytes,
                        mimeType: primary.mimeType,
                    },
                };
            }),
        );
        return { targetId, received: images.length, requested: Number(config.count), usedOriginalGrid: Boolean((images as any).usedOriginalGrid) };
    } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new DOMException("Aborted", "AbortError");
        const errorDetails = error instanceof Error ? error.message : i18n.t("canvas.projectPage.generationFailed");
        run.setNodes((nodes) =>
            nodes.map((node) => {
                if (signal.aborted || node.metadata?.generationId !== generationId) return node;
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        generationId: undefined,
                        mjTaskId: undefined,
                        progress: undefined,
                        status: node.metadata.content ? ("success" as const) : ("error" as const),
                        errorDetails,
                        images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails } : image)),
                    },
                };
            }),
        );
        throw error;
    }
}

export type TextGenerationRun = {
    sourceId: string;
    prompt: string;
    config: AiConfig;
    signal: AbortSignal;
    messages: AiTextMessage[];
    getNodes: () => CanvasNodeData[];
    setNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => void;
    addConnection: (sourceId: string, targetId: string) => void;
    onTarget?: (targetId: string) => void;
    retry?: { targetId?: string };
};

export async function runCanvasTextGeneration(
    run: TextGenerationRun,
    io: {
        question?: (config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: { signal?: AbortSignal }) => Promise<string>;
    } = { question: requestImageQuestion },
) {
    const { config, signal, sourceId, prompt, messages, retry } = run;
    signal.throwIfAborted();
    const source = run.getNodes().find((node) => node.id === sourceId);
    if (!source) throw new DOMException("Aborted", "AbortError");

    const reuse = Boolean(retry?.targetId) || (source.type === CanvasNodeType.Text && !source.metadata?.content);
    const targetId = retry?.targetId || (reuse ? sourceId : nanoid());
    const generationId = nanoid();

    const target: CanvasNodeData = {
        id: targetId,
        type: CanvasNodeType.Text,
        title: prompt.slice(0, 32) || i18n.t("canvas.projectPage.canvasText"),
        position: { x: source.position.x + source.width + 96, y: source.position.y },
        width: 340,
        height: 240,
        metadata: {
            prompt,
            generationId,
            status: "loading",
            content: "",
            fontSize: 14,
        },
    };

    run.onTarget?.(targetId);
    run.setNodes((nodes) => {
        if (signal.aborted || !nodes.some((node) => node.id === sourceId)) return nodes;
        const updated = nodes.map((node) => {
            if (node.id === sourceId && sourceId !== targetId) {
                return { ...node, metadata: { ...node.metadata, status: "loading" as const, errorDetails: undefined } };
            }
            if (node.id === targetId) {
                return { ...node, metadata: { ...node.metadata, prompt, generationId, status: "loading" as const, content: "", errorDetails: undefined } };
            }
            return node;
        });
        return reuse ? updated : [...updated, target];
    });
    if (!reuse) run.addConnection(sourceId, targetId);

    try {
        const questionFn = io.question ?? requestImageQuestion;
        let streamed = "";
        const result = await questionFn(
            config,
            messages,
            (delta) => {
                streamed = delta;
                if (signal.aborted) return;
                run.setNodes((nodes) =>
                    nodes.map((node) => {
                        if (node.id !== targetId || node.metadata?.generationId !== generationId) return node;
                        return {
                            ...node,
                            metadata: {
                                ...node.metadata,
                                content: delta,
                            },
                        };
                    }),
                );
            },
            { signal },
        );
        signal.throwIfAborted();
        if (!run.getNodes().some((node) => node.id === targetId && node.metadata?.generationId === generationId)) {
            throw new DOMException("Aborted", "AbortError");
        }
        const finalContent = result || streamed;
        run.setNodes((nodes) =>
            nodes.map((node) => {
                if (signal.aborted) return node;
                if (node.id === sourceId && sourceId !== targetId) {
                    return { ...node, metadata: { ...node.metadata, status: "success" as const } };
                }
                if (node.id !== targetId || node.metadata?.generationId !== generationId) return node;
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        generationId: undefined,
                        status: "success" as const,
                        content: finalContent,
                        errorDetails: undefined,
                    },
                };
            }),
        );
        return { targetId, content: finalContent };
    } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new DOMException("Aborted", "AbortError");
        const errorDetails = error instanceof Error ? error.message : i18n.t("canvas.projectPage.generationFailed");
        run.setNodes((nodes) =>
            nodes.map((node) => {
                if (signal.aborted || node.metadata?.generationId !== generationId) {
                    if (node.id === sourceId && sourceId !== targetId && node.metadata?.status === "loading") {
                        return { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails } };
                    }
                    return node;
                }
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        generationId: undefined,
                        status: "error" as const,
                        errorDetails,
                    },
                };
            }),
        );
        throw error;
    }
}
