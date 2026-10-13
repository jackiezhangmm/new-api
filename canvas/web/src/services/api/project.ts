import { getCanvasAuthHeaders } from "@/services/host-auth";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CloudCanvasProjectMetadata = {
    id: string;
    user_id: number;
    title: string;
    revision: number;
    created_at: number;
    updated_at: number;
};

export type CloudCanvasProject = {
    id: string;
    user_id: number;
    title: string;
    revision: number;
    content: string;
    created_at: number;
    updated_at: number;
};

export class ConflictError extends Error {
    readonly latestRevision?: number;
    constructor(message: string, latestRevision?: number) {
        super(message);
        this.name = "ConflictError";
        this.latestRevision = latestRevision;
    }
}

export class NotFoundError extends Error {
    constructor(message = "工程不存在") {
        super(message);
        this.name = "NotFoundError";
    }
}

export async function fetchCanvasProjectList(): Promise<CloudCanvasProjectMetadata[]> {
    const headers = await getCanvasAuthHeaders();
    const res = await fetch("/api/canvas/projects", { headers });
    if (!res.ok) {
        throw new Error(`获取工程列表失败: ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) {
        throw new Error(json.message || "获取工程列表失败");
    }
    return json.data;
}

export async function createCloudProject(params?: { id?: string; title?: string; content?: string }): Promise<CloudCanvasProject> {
    const headers = await getCanvasAuthHeaders();
    const res = await fetch("/api/canvas/projects", {
        method: "POST",
        headers: {
            ...headers,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(params || {}),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`创建工程失败: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
        throw new Error(json.message || "创建工程失败");
    }
    return json.data;
}

export async function fetchCloudProject(id: string): Promise<CloudCanvasProject> {
    const headers = await getCanvasAuthHeaders();
    const res = await fetch(`/api/canvas/projects/${encodeURIComponent(id)}`, { headers });
    if (res.status === 404) {
        throw new NotFoundError();
    }
    if (!res.ok) {
        throw new Error(`获取工程失败: ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
        throw new Error(json.message || "获取工程失败");
    }
    return json.data;
}

export async function updateCloudProject(id: string, params: { revision: number; title?: string; content?: string }): Promise<CloudCanvasProject> {
    const headers = await getCanvasAuthHeaders();
    const res = await fetch(`/api/canvas/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
            ...headers,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
    });
    if (res.status === 409) {
        const json = await res.json().catch(() => ({}));
        throw new ConflictError(json.message || "工程已被其他端更新，存在版本冲突", json.data?.revision);
    }
    if (res.status === 404) {
        throw new NotFoundError();
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`更新工程失败: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
        throw new Error(json.message || "更新工程失败");
    }
    return json.data;
}

export async function deleteCloudProject(id: string): Promise<void> {
    const headers = await getCanvasAuthHeaders();
    const res = await fetch(`/api/canvas/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
    });
    if (res.status === 404) {
        throw new NotFoundError();
    }
    if (!res.ok) {
        throw new Error(`删除工程失败: ${res.status}`);
    }
}
