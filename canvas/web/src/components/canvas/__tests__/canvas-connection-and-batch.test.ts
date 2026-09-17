import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@/i18n";
import { ConnectionCreateMenu } from "@/components/canvas/canvas-create-menus";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { canvasCapabilities } from "@/lib/canvas/canvas-capabilities";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("Issue #35 - 连线快捷菜单对齐上游基线并遵循能力矩阵", () => {
    const html = renderToString(
        React.createElement(ConnectionCreateMenu, {
            pending: { connection: { nodeId: "node-1", handleType: "source" }, position: { x: 100, y: 100 } },
            onCreate: () => {},
            onClose: () => {},
        }),
    );

    // 默认具备 video、audio 与 generation 能力
    assert.equal(html.includes("文本生成"), true, "应包含文本生成");
    assert.equal(html.includes("图片生成"), true, "应包含图片生成");
    assert.equal(html.includes("视频生成"), true, "应包含视频生成");
    assert.equal(html.includes("配置节点"), true, "应包含配置节点");
    assert.equal(html.includes("音频参考"), true, "音频开启时应展示音频选项");

    // 动态关闭能力时隐藏对应选项
    const origVideo = canvasCapabilities.video;
    const origAudio = canvasCapabilities.audio;
    try {
        (canvasCapabilities as any).video = false;
        (canvasCapabilities as any).audio = false;
        const htmlWithoutVideo = renderToString(
            React.createElement(ConnectionCreateMenu, {
                pending: { connection: { nodeId: "node-1", handleType: "source" }, position: { x: 100, y: 100 } },
                onCreate: () => {},
                onClose: () => {},
            }),
        );
        assert.equal(htmlWithoutVideo.includes("视频生成"), false, "video 能力关闭时不展示视频选项");
        assert.equal(htmlWithoutVideo.includes("音频参考"), false, "audio 能力关闭时不展示音频选项");
    } finally {
        (canvasCapabilities as any).video = origVideo;
        (canvasCapabilities as any).audio = origAudio;
    }
});

test("Issue #35 - 多图展开卡片顶栏按钮自适应布局防截断", () => {
    const makeNode = (width: number): CanvasNodeData => ({
        id: "node-img-batch",
        type: CanvasNodeType.Image,
        title: "Image Batch",
        position: { x: 0, y: 0 },
        width,
        height: 240,
        metadata: {
            images: [
                { id: "img-1", content: "data:image/png;base64,1", status: "success", naturalWidth: 100, naturalHeight: 100, bytes: 100, mimeType: "image/png" },
                { id: "img-2", content: "data:image/png;base64,2", status: "success", naturalWidth: 100, naturalHeight: 100, bytes: 100, mimeType: "image/png" },
            ],
        },
    });

    const defaultNodeProps = {
        scale: 1,
        isSelected: false,
        isRelated: false,
        isFocusRelated: false,
        isConnectionTarget: false,
        isConnecting: false,
        showPanel: false,
        showImageInfo: false,
        onMouseDown: () => {},
        onHoverStart: () => {},
        onHoverEnd: () => {},
        onConnectStart: () => {},
        onResizeStart: () => {},
        onResize: () => {},
        onResizeEnd: () => {},
        onContentChange: () => {},
        onTitleChange: () => {},
        onContextMenu: () => {},
    };

    // 窄卡片（1:1 正方形 240px，或 9:16 纵向长图 135px）：文字标签隐藏，保留 title 与图标，消除文字截断
    const htmlNarrow = renderToString(
        React.createElement(CanvasNode, {
            ...defaultNodeProps,
            data: makeNode(240),
            batchExpanded: true,
        }),
    );

    assert.equal(htmlNarrow.includes('title="创建副本"'), true, "窄卡片按钮保留原生 title 提示");
    assert.equal(htmlNarrow.includes('title="设为主图"'), true, "窄卡片按钮保留原生 title 提示");
    assert.equal(htmlNarrow.includes('title="下载"'), true, "窄卡片按钮保留原生 title 提示");
    assert.equal(htmlNarrow.includes(">创建副本</span>"), false, "窄卡片应隐藏文案标签");
    assert.equal(htmlNarrow.includes(">设为主图</span>"), false, "窄卡片应隐藏文案标签");
    assert.equal(htmlNarrow.includes(">下载</span>"), false, "窄卡片应隐藏文案标签");

    // 宽卡片（如横版 340px）：文字标签完整展示
    const htmlWide = renderToString(
        React.createElement(CanvasNode, {
            ...defaultNodeProps,
            data: makeNode(340),
            batchExpanded: true,
        }),
    );

    assert.equal(htmlWide.includes(">创建副本</span>"), true, "宽卡片应展示文案标签");
    assert.equal(htmlWide.includes(">设为主图</span>"), true, "宽卡片应展示文案标签");
    assert.equal(htmlWide.includes(">下载</span>"), true, "宽卡片应展示文案标签");
});

test("Issue #35 - 提示词编辑面板正确透传连线选图回调", () => {
    const queryClient = new QueryClient();
    const node: CanvasNodeData = {
        id: "node-prompt-test",
        type: CanvasNodeType.Image,
        title: "Image Node",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
    };

    // 传入 onStartReferenceSelection 时，应当渲染添加参考图的按钮
    const htmlWithSelection = renderToString(
        React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(CanvasNodePromptPanel, {
                node,
                nodes: [node],
                isRunning: false,
                onPromptChange: () => {},
                onConfigChange: () => {},
                onGenerate: () => {},
                onStop: () => {},
                onStartReferenceSelection: () => {},
            }),
        ),
    );
    assert.equal(htmlWithSelection.includes("从画布选择参考节点"), true, "应渲染连线选图加号按钮");

    // 未传入回调时，不渲染该按钮
    const htmlWithoutSelection = renderToString(
        React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(CanvasNodePromptPanel, {
                node,
                nodes: [node],
                isRunning: false,
                onPromptChange: () => {},
                onConfigChange: () => {},
                onGenerate: () => {},
                onStop: () => {},
            }),
        ),
    );
    assert.equal(htmlWithoutSelection.includes("从画布选择参考节点"), false, "未提供回调时不应渲染加号按钮");
});
