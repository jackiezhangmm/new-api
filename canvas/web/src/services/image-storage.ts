import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { withLocalProxy } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { getCanvasAuthHeaders } from "@/services/host-auth";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const userStorageKey = (key: string) => {
    const userId = useUserStore.getState().user?.id;
    return userId ? `${key}:${userId}` : `${key}:anonymous`;
};
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";

type ImageReadOptions = { signal?: AbortSignal };

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    if (typeof input !== "string") return uploadBlobToCloud(input, options);
    const blob = await fetchImageBlob(input, options);
    return uploadBlobToCloud(blob, options);
}

async function uploadBlobToCloud(blob: Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    throwIfAborted(options?.signal);
    const headers = await getCanvasAuthHeaders();
    throwIfAborted(options?.signal);

    const formData = new FormData();
    const filename = blob instanceof File && blob.name ? blob.name : "upload.png";
    formData.append("file", blob, filename);

    const response = await fetch("/api/images", {
        method: "POST",
        headers,
        body: formData,
        signal: options?.signal,
    });

    if (!response.ok) {
        let errorMsg = i18n.t("common.imageReadFailed");
        try {
            const resJson = await response.json();
            if (resJson && resJson.message) {
                errorMsg = resJson.message;
            }
        } catch {
            /* ignore json parse failure */
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
        storageKey: item.id,
        width: item.width,
        height: item.height,
        bytes: item.bytes,
        mimeType: item.mime_type || blob.type || "image/png",
    };
}

async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function namedError(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(urlOrStorageKey?: string, fallback = "") {
    if (!urlOrStorageKey) return fallback;
    if (/^https?:\/\//i.test(urlOrStorageKey) || urlOrStorageKey.startsWith("data:") || urlOrStorageKey.startsWith("blob:")) {
        return urlOrStorageKey;
    }
    return fallback || urlOrStorageKey;
}

export async function getImageBlob(url: string) {
    if (!url) return null;
    try {
        const response = await fetch(withLocalProxy(url));
        if (!response.ok) return null;
        return await response.blob();
    } catch {
        return null;
    }
}

export async function setImageBlob(_storageKey: string, blob: Blob) {
    return URL.createObjectURL(blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await fetchImageBlob(url, options));
}

export async function deleteStoredImages(_keys: Iterable<string>) {
    // 禁绝物理删除：删除节点绝不删除云端对象
}

export async function cleanupUnusedImages(_usedData?: unknown) {
    // 彻底切除 IndexedDB 图片持久化与清理逻辑
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
