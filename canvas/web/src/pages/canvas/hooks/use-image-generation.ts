import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";
import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext, readReferenceAudio, readReferenceImage } from "@/components/canvas/canvas-node-generation";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { runCanvasImageGeneration, runCanvasTextGeneration } from "@/lib/canvas/image-generation";
import { auxiliaryTextIssues, DEFAULT_AUXILIARY_TEXT_MODEL, imageSettingsIssues } from "@/lib/canvas/image-models";
import { videoSettingsIssues } from "@/lib/canvas/video-models";
import { createVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { applyGeneratedVideo } from "@/lib/canvas/canvas-node-factory";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

type Props = {
    projectId: string;
    config: AiConfig;
    nodes: CanvasNodeData[];
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
};
type Run = { controller: AbortController; targetId?: string };

export function useImageGeneration({ projectId, config, nodes, nodesRef, connectionsRef, setNodes, setConnections }: Props) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const runs = useRef(new Map<string, Run>());
    const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
    const stop = useCallback(
        (id: string) => {
            const entry = [...runs.current.entries()].find(([sourceId, run]) => sourceId === id || run.targetId === id);
            if (!entry) return;
            const [sourceId, run] = entry;
            run.controller.abort();
            runs.current.delete(sourceId);
            setRunningIds((current) => new Set([...current].filter((value) => value !== sourceId && value !== run.targetId)));
            setNodes((current) =>
                current.map((node) => {
                    if (node.id !== sourceId && node.id !== run.targetId) return node;
                    if (node.metadata?.status !== "loading") return node;
                    const errorDetails = t("common.requestCanceled");
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            generationId: undefined,
                            mjTaskId: undefined,
                            videoTaskId: undefined,
                            progress: undefined,
                            status: node.metadata.content ? "success" : "error",
                            errorDetails,
                            images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error", errorDetails } : image)),
                        },
                    };
                }),
            );
        },
        [setNodes, t],
    );

    useEffect(() => {
        const activeRuns = runs.current;
        return () => {
            activeRuns.forEach((run) => run.controller.abort());
            activeRuns.clear();
        };
    }, [projectId]);
    useEffect(() => {
        for (const [id, run] of runs.current) {
            if (!nodes.some((node) => node.id === id) || (run.targetId && !nodes.some((node) => node.id === run.targetId))) stop(id);
        }
    }, [nodes, stop]);

    const execute = useCallback(
        async (sourceId: string, prompt: string, retry?: { imageId?: string }) => {
            stop(sourceId);
            const source = nodesRef.current.find((node) => node.id === sourceId);
            if (!source) return;
            const controller = new AbortController();
            const run: Run = { controller };
            runs.current.set(sourceId, run);
            setRunningIds((current) => new Set(current).add(sourceId));
            try {
                const isRetryEdit = Boolean(retry && source.metadata?.generationType === "edit");
                const context = buildNodeGenerationContext(sourceId, nodesRef.current, connectionsRef.current, prompt);
                let references: ReferenceImage[] = [];

                if (isRetryEdit) {
                    const savedRefs = source.metadata?.references || [];
                    if (!savedRefs.length) {
                        throw new Error(t("canvas.projectPage.referenceMissing"));
                    }
                    const resolvedRefs: ReferenceImage[] = [];
                    for (const ref of savedRefs) {
                        const matchedNode = nodesRef.current.find((n) => n.metadata?.storageKey === ref || n.metadata?.content === ref || n.id === ref);
                        const refImage = matchedNode ? readReferenceImage(matchedNode) : null;
                        if (!refImage) {
                            throw new Error(t("canvas.projectPage.referenceMissing"));
                        }
                        resolvedRefs.push(refImage);
                    }
                    references = resolvedRefs;
                } else if (!retry) {
                    references = context.referenceImages;
                }

                const isEdit = references.length > 0 || isRetryEdit;
                const operation = isEdit ? "edit" : "generation";
                const settings = buildGenerationConfig(config, source, "image", operation);
                const issues = imageSettingsIssues(settings, config.models, operation, isEdit ? references.length : undefined);
                if (issues.length) throw new Error(issues.join("\n"));
                if (retry?.imageId) settings.count = "1";

                const result = await runCanvasImageGeneration({
                    sourceId,
                    prompt: retry ? prompt || source.metadata?.prompt || "" : context.prompt,
                    config: settings,
                    signal: controller.signal,
                    retry,
                    references,
                    getNodes: () => nodesRef.current,
                    setNodes,
                    addConnection: (fromNodeId, toNodeId) => setConnections((current) => [...current, { id: nanoid(), fromNodeId, toNodeId }]),
                    onTarget: (targetId) => {
                        run.targetId = targetId;
                        setRunningIds((current) => new Set(current).add(targetId));
                    },
                });
                if (result.usedOriginalGrid) message.info(t("canvas.projectPage.fallbackGrid"));
                if (result.received < result.requested) message.warning(t("integration.fewerImages", { actual: result.received, requested: result.requested }));
            } catch (error) {
                if (!controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) message.error(error instanceof Error ? error.message : t("canvas.projectPage.generationFailed"));
            } finally {
                if (runs.current.get(sourceId) === run) {
                    runs.current.delete(sourceId);
                    setRunningIds((current) => new Set([...current].filter((id) => id !== sourceId && id !== run.targetId)));
                }
            }
        },
        [config, connectionsRef, message, nodesRef, setConnections, setNodes, stop, t],
    );

    const executeText = useCallback(
        async (sourceId: string, prompt: string, retryTarget?: { targetId: string }) => {
            stop(sourceId);
            if (retryTarget?.targetId) stop(retryTarget.targetId);
            const source = nodesRef.current.find((node) => node.id === sourceId);
            if (!source) return;
            const controller = new AbortController();
            const run: Run = { controller, targetId: retryTarget?.targetId };
            runs.current.set(sourceId, run);
            setRunningIds((current) => {
                const next = new Set(current).add(sourceId);
                if (retryTarget?.targetId) next.add(retryTarget.targetId);
                return next;
            });
            try {
                const issues = auxiliaryTextIssues(config.models, DEFAULT_AUXILIARY_TEXT_MODEL);
                if (issues.length) throw new Error(issues.join("\n"));

                const isEditText = source.type === CanvasNodeType.Text && Boolean(source.metadata?.content);
                const effectivePrompt = isEditText
                    ? t("canvas.projectPage.editTextPrompt", { source: source.metadata?.content, prompt })
                    : prompt;

                const rawContext = buildNodeGenerationContext(sourceId, nodesRef.current, connectionsRef.current, effectivePrompt);
                const context = await hydrateNodeGenerationContext(rawContext);
                const connectedImageNode = nodesRef.current.find(
                    (n) => (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Config) && connectionsRef.current.some((c) => (c.fromNodeId === sourceId && c.toNodeId === n.id) || (c.toNodeId === sourceId && c.fromNodeId === n.id)),
                );
                const activeModel = connectedImageNode?.metadata?.model || source.metadata?.model || config.model;
                const messages = buildNodeResponseMessages(context, { model: activeModel });

                await runCanvasTextGeneration({
                    sourceId,
                    prompt: retryTarget ? prompt || source.metadata?.prompt || "" : prompt,
                    config: { ...config, model: DEFAULT_AUXILIARY_TEXT_MODEL },
                    signal: controller.signal,
                    retry: retryTarget,
                    messages,
                    getNodes: () => nodesRef.current,
                    setNodes,
                    addConnection: (fromNodeId, toNodeId) => setConnections((current) => [...current, { id: nanoid(), fromNodeId, toNodeId }]),
                    onTarget: (targetId) => {
                        run.targetId = targetId;
                        setRunningIds((current) => new Set(current).add(targetId));
                    },
                });
            } catch (error) {
                if (!controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) {
                    message.error(error instanceof Error ? error.message : t("canvas.projectPage.generationFailed"));
                }
            } finally {
                if (runs.current.get(sourceId) === run) {
                    runs.current.delete(sourceId);
                    setRunningIds((current) => new Set([...current].filter((id) => id !== sourceId && id !== run.targetId)));
                }
            }
        },
        [config, connectionsRef, message, nodesRef, setConnections, setNodes, stop, t],
    );

    const executeVideo = useCallback(
        async (sourceId: string, prompt: string, retryTarget?: { targetId?: string }) => {
            stop(sourceId);
            if (retryTarget?.targetId) stop(retryTarget.targetId);
            const source = nodesRef.current.find((node) => node.id === sourceId);
            if (!source) return;
            const controller = new AbortController();
            const targetNodeId = retryTarget?.targetId || (source.type === CanvasNodeType.Video ? sourceId : nanoid());
            const reuse = targetNodeId === sourceId;
            const run: Run = { controller, targetId: targetNodeId };
            runs.current.set(sourceId, run);
            setRunningIds((current) => {
                const next = new Set(current).add(sourceId);
                if (targetNodeId) next.add(targetNodeId);
                return next;
            });
            try {
                const effectivePrompt = prompt || source.metadata?.composerContent || source.metadata?.prompt || "";
                const context = buildNodeGenerationContext(sourceId, nodesRef.current, connectionsRef.current, effectivePrompt);
                let references = context.referenceImages;
                if (!references.length && retryTarget && source.metadata?.references?.length) {
                    const savedRefs = source.metadata.references;
                    const resolvedRefs: ReferenceImage[] = [];
                    for (const ref of savedRefs) {
                        const matched = nodesRef.current.find((n) => n.metadata?.storageKey === ref || n.metadata?.content === ref || n.id === ref);
                        const refImage = matched ? readReferenceImage(matched) : null;
                        if (refImage) resolvedRefs.push(refImage);
                    }
                    references = resolvedRefs;
                }
                let audios = context.referenceAudios;
                if (!audios.length && retryTarget && source.metadata?.audios?.length) {
                    const savedAudios = source.metadata.audios;
                    const resolvedAudios: ReferenceAudio[] = [];
                    for (const ref of savedAudios) {
                        const matched = nodesRef.current.find((n) => n.metadata?.storageKey === ref || n.metadata?.content === ref || n.id === ref);
                        const refAudio = matched ? readReferenceAudio(matched) : null;
                        if (refAudio) resolvedAudios.push(refAudio);
                    }
                    audios = resolvedAudios;
                }
                const generationConfig = buildGenerationConfig(config, source, "video");
                const issues = videoSettingsIssues(generationConfig, config.models, references.length);
                if (issues.length) throw new Error(issues.join("\n"));

                const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const parent = source.position || { x: 0, y: 0 };
                const videoNode: CanvasNodeData = {
                    id: targetNodeId,
                    type: CanvasNodeType.Video,
                    title: effectivePrompt.slice(0, 32) || t("assets.kinds.video"),
                    position: reuse ? source.position : { x: parent.x + (source.width || spec.width) + 96, y: parent.y },
                    width: reuse ? source.width : spec.width,
                    height: reuse ? source.height : spec.height,
                    metadata: {
                        prompt: effectivePrompt,
                        status: "loading" as const,
                        model: generationConfig.model,
                        size: generationConfig.size,
                        seconds: generationConfig.videoSeconds,
                        vquality: generationConfig.vquality,
                        references: references.map((r) => r.storageKey || r.url || r.dataUrl).filter(Boolean),
                        audios: audios.map((a) => a.storageKey || a.url).filter(Boolean),
                    },
                };
                setNodes((prev) =>
                    reuse
                        ? prev.map((node) => (node.id === sourceId ? { ...node, ...videoNode } : node))
                        : [...prev.map((node) => (node.id === sourceId ? { ...node, metadata: { ...node.metadata, status: "success" as const } } : node)), videoNode],
                );
                if (!reuse) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: sourceId, toNodeId: targetNodeId }]);

                const task = await createVideoGenerationTask(generationConfig, effectivePrompt, references, {
                    signal: controller.signal,
                    audios,
                });
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === targetNodeId
                            ? { ...item, metadata: { ...item.metadata, videoTaskId: task.id, videoTaskProvider: task.provider, model: generationConfig.model } }
                            : item,
                    ),
                );

                const result = await waitForVideoGenerationTask(generationConfig, task, { signal: controller.signal });
                const video = await storeGeneratedVideo(result);
                const fallbackUrl = `/v1/videos/${task.id}/content`;
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === targetNodeId
                            ? applyGeneratedVideo(item, video, {
                                  prompt: effectivePrompt,
                                  model: generationConfig.model,
                                  size: generationConfig.size,
                                  seconds: generationConfig.videoSeconds,
                                  vquality: generationConfig.vquality,
                                  audios: audios.map((a) => a.storageKey || a.url).filter(Boolean),
                                  fallbackUrl,
                                  status: "success" as const,
                              })
                            : item,
                    ),
                );
            } catch (error) {
                if (!controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) {
                    const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                    message.error(errorDetails);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === targetNodeId
                                ? {
                                      ...item,
                                      metadata: {
                                          ...item.metadata,
                                          status: "error" as const,
                                          errorDetails,
                                          ...(isVideoTaskFailed(error) ? { videoTaskId: undefined } : {}),
                                      },
                                  }
                                : item,
                        ),
                    );
                }
            } finally {
                if (runs.current.get(sourceId) === run) {
                    runs.current.delete(sourceId);
                    setRunningIds((current) => new Set([...current].filter((id) => id !== sourceId && id !== run.targetId)));
                }
            }
        },
        [config, connectionsRef, message, nodesRef, setConnections, setNodes, stop, t],
    );

    const generate = useCallback(
        async (nodeId: string, mode: CanvasGenerationMode, prompt: string) => {
            if (mode === "image") {
                await execute(nodeId, prompt);
                return;
            }
            if (mode === "text") {
                await executeText(nodeId, prompt);
                return;
            }
            if (mode === "video") {
                await executeVideo(nodeId, prompt);
                return;
            }
            message.error(t("integration.unavailable"));
        },
        [execute, executeText, executeVideo, message, t],
    );
    const retry = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            if (node.type === CanvasNodeType.Image) {
                await execute(node.id, node.metadata?.prompt || "", { imageId });
                return;
            }
            if (node.type === CanvasNodeType.Text) {
                const upstream = connectionsRef.current.find((c) => c.toNodeId === node.id);
                const sourceId = upstream ? upstream.fromNodeId : node.id;
                await executeText(sourceId, node.metadata?.prompt || "", { targetId: node.id });
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                const upstream = connectionsRef.current.find((c) => c.toNodeId === node.id);
                const sourceId = upstream ? upstream.fromNodeId : node.id;
                await executeVideo(sourceId, node.metadata?.prompt || "", { targetId: node.id });
                return;
            }
            message.error(t("integration.unavailable"));
        },
        [connectionsRef, execute, executeText, executeVideo, message, t],
    );
    return { generate, retry, stop, runningIds };
}
