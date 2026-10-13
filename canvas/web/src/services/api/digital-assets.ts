import i18n from "@/i18n";
import { getCanvasAuthHeaders } from "@/services/host-auth";

export const DIGITAL_ASSETS_QUERY_KEY = ["digital-assets"] as const;
export const DIGITAL_ASSET_TAGS_QUERY_KEY = ["digital-asset-tags"] as const;

export type DigitalAssetTag = {
    id: number;
    user_id: number;
    name: string;
    created_at: number;
    updated_at: number;
};

export type DigitalAssetImage = {
    id: string;
    url: string;
    width: number;
    height: number;
    mime_type: string;
};

export type DigitalAsset = {
    id: number;
    user_id: number;
    asset_type: "text" | "image";
    title: string;
    content: string;
    image_id?: string;
    image?: DigitalAssetImage;
    is_favorite: boolean;
    created_at: number;
    updated_at: number;
    tags: DigitalAssetTag[];
};

export type DigitalAssetListResponse = {
    page: number;
    page_size: number;
    total: number;
    items: DigitalAsset[];
};

export type CreateDigitalAssetPayload = {
    asset_type: "text" | "image";
    title: string;
    content: string;
    tags: string[];
    image_id?: string;
};

export async function fetchDigitalAssets(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    tagIds?: number[];
    favorite?: boolean;
    assetType?: "text" | "image";
}): Promise<DigitalAssetListResponse> {
    const headers = await getCanvasAuthHeaders();
    const searchParams = new URLSearchParams();
    searchParams.set("p", String(params.page || 1));
    searchParams.set("page_size", String(params.pageSize || 20));

    if (params.search?.trim()) {
        searchParams.set("search", params.search.trim());
    }
    if (params.favorite !== undefined) {
        searchParams.set("favorite", String(params.favorite));
    }
    if (params.assetType) {
        searchParams.set("asset_type", params.assetType);
    }
    if (params.tagIds && params.tagIds.length > 0) {
        for (const tagId of params.tagIds) {
            searchParams.append("tag_id", String(tagId));
        }
    }

    const response = await fetch(`/api/digital-assets/?${searchParams.toString()}`, { headers });
    if (!response.ok) {
        let message = i18n.t("assets.loadFailed");
        try {
            const errJson = await response.json();
            if (errJson?.message) message = errJson.message;
        } catch {
            // 保留默认错误提示
        }
        throw new Error(message);
    }
    const body = await response.json();
    if (!body.success || !body.data) {
        throw new Error(body.message || i18n.t("assets.loadFailed"));
    }
    return body.data as DigitalAssetListResponse;
}

export async function fetchDigitalAssetTags(): Promise<DigitalAssetTag[]> {
    const headers = await getCanvasAuthHeaders();
    const response = await fetch("/api/digital-assets/tags", { headers });
    if (!response.ok) {
        let message = i18n.t("assets.loadFailed");
        try {
            const errJson = await response.json();
            if (errJson?.message) message = errJson.message;
        } catch {
            // 保留默认错误提示
        }
        throw new Error(message);
    }
    const body = await response.json();
    if (!body.success || !Array.isArray(body.data)) {
        throw new Error(body.message || i18n.t("assets.loadFailed"));
    }
    return body.data as DigitalAssetTag[];
}

export async function createDigitalAsset(payload: CreateDigitalAssetPayload): Promise<DigitalAsset> {
    const headers = await getCanvasAuthHeaders();
    const response = await fetch("/api/digital-assets/", {
        method: "POST",
        headers: {
            ...headers,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        let message = i18n.t("common.saveFailed");
        try {
            const errJson = await response.json();
            if (errJson?.message) message = errJson.message;
        } catch {
            // 保留默认错误提示
        }
        throw new Error(message);
    }
    const body = await response.json();
    if (!body.success || !body.data) {
        throw new Error(body.message || i18n.t("common.saveFailed"));
    }
    return body.data as DigitalAsset;
}

export async function deleteDigitalAsset(id: number): Promise<void> {
    const headers = await getCanvasAuthHeaders();
    const response = await fetch(`/api/digital-assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
    });
    if (!response.ok) {
        let message = i18n.t("common.failed");
        try {
            const errJson = await response.json();
            if (errJson?.message) message = errJson.message;
        } catch {
            // 保留默认错误提示
        }
        throw new Error(message);
    }
    const body = await response.json();
    if (!body.success) {
        throw new Error(body.message || i18n.t("common.failed"));
    }
}
