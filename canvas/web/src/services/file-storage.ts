import i18n from "@/i18n";
import { getCanvasAuthHeaders } from "@/services/host-auth";
import { withLocalProxy } from "@/stores/use-config-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

async function uploadMediaBlobToCloud(blob: Blob, prefix = "file"): Promise<{ url: string; id: string; bytes: number; mimeType: string }> {
    const headers = await getCanvasAuthHeaders();
    const formData = new FormData();
    const ext = blob.type.includes("video") ? "mp4" : blob.type.includes("audio") ? "mp3" : "bin";
    const filename = blob instanceof File && blob.name ? blob.name : `${prefix}.${ext}`;
    formData.append("file", blob, filename);

    const response = await fetch("/api/media", {
        method: "POST",
        headers,
        body: formData,
    });

    if (!response.ok) {
        let errorMsg = i18n.t("common.imageReadFailed");
        try {
            const resJson = await response.json();
            if (resJson && resJson.message) {
                errorMsg = resJson.message;
            }
        } catch {
            /* ignore */
        }
        throw new Error(errorMsg);
    }

    const resBody = await response.json();
    if (!resBody || !resBody.success || !resBody.data) {
        throw new Error(resBody?.message || i18n.t("common.imageReadFailed"));
    }

    const item = resBody.data;
    return {
        url: item.url,
        id: item.id,
        bytes: item.bytes,
        mimeType: item.mime_type || blob.type,
    };
}

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(withLocalProxy(input))).blob() : input;
    const tempUrl = URL.createObjectURL(blob);
    let meta: { width?: number; height?: number; durationMs?: number } = {};
    try {
        meta = blob.type.startsWith("video/") ? await readVideoMeta(tempUrl) : blob.type.startsWith("audio/") ? await readAudioMeta(tempUrl) : {};
    } finally {
        URL.revokeObjectURL(tempUrl);
    }

    const uploaded = await uploadMediaBlobToCloud(blob, prefix);
    return {
        url: uploaded.url,
        storageKey: uploaded.id,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType || "application/octet-stream",
        ...meta,
    };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (/^https?:\/\//i.test(storageKey) || storageKey.startsWith("/") || storageKey.startsWith("blob:")) {
        return storageKey;
    }
    return fallback || storageKey;
}

export async function getMediaBlob(storageKey: string): Promise<Blob | null> {
    if (!storageKey) return null;
    try {
        const response = await fetch(withLocalProxy(storageKey));
        if (!response.ok) return null;
        return await response.blob();
    } catch {
        return null;
    }
}

export async function setMediaBlob(_storageKey: string, blob: Blob) {
    return URL.createObjectURL(blob);
}

export async function deleteStoredMedia(_keys: Iterable<string>) {
    // 禁绝物理删除：删除节点绝不删除云端对象
}

export async function cleanupUnusedMedia(_usedData?: unknown) {
    // 彻底切除 IndexedDB 媒体持久化与清理逻辑
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string") keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        if (typeof document === "undefined" || !document.createElement) {
            resolve({ width: 1280, height: 720 });
            return;
        }
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        if (typeof document === "undefined" || !document.createElement) {
            resolve({});
            return;
        }
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
