import i18n from "@/i18n";
import { queryClient } from "@/lib/query-client";
import { getCanvasAuthHeaders } from "@/services/host-auth";

export type Prompt = {
    id: string;
    title: string;
    prompt: string;
    coverUrl: string;
    referenceImageUrls: string[];
    description: string;
    category: string;
    tags: string[];
    sourceId: string;
    githubUrl: string;
    preview?: string;
    createdAt?: string;
    updatedAt?: string;
};

export const ALL_PROMPTS_OPTION = "all";
export const BULULU_FEATURED_CATEGORY = "Bululu精选";
export const BULULU_FEATURED_SOURCE_ID = "bululu-featured";
export const FEATURED_PROMPTS_QUERY_KEY = ["featured-prompts"] as const;
const FEATURED_PROMPTS_STALE_TIME = 5 * 60 * 1000;

export const MIDJOURNEY_POLISH_TEMPLATE = `任务：
将用户提供的提示词，改写为专业的Midjourney英文提示词

可选参数：
--niji：Niji 开关
--ar：画面比例，1:1 / 16:9 / 2:3 / 9:16 等
--q：渲染质量，0.25 / 0.5 / 1 / 2
--hd：HD 高清
--style：风格：“raw”等
--s：风格化强度，0–1000
--c：混乱度，0–100
--w：怪异度，0–3000
--iw：图片权重，0–3
--cw：角色权重，0–100
--sw：风格权重，0–1000
--seed：固定种子

用户输入：
<input>`;

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
};

export type PromptSourceRefreshResult = PromptSourceStatus & {
    sourceName: string;
    success: boolean;
};

export type PromptSourceRefreshSummary = {
    results: PromptSourceRefreshResult[];
    total: number;
    successCount: number;
    failureCount: number;
};

type FeaturedPromptDto = {
    id: number;
    title: string;
    prompt: string;
    cover_url: string;
    sort_order: number;
    created_at: number;
    updated_at: number;
};

function mapFeaturedPrompt(item: FeaturedPromptDto): Prompt {
    return {
        id: String(item.id),
        title: item.title,
        prompt: item.prompt,
        coverUrl: item.cover_url || "",
        referenceImageUrls: item.cover_url ? [item.cover_url] : [],
        description: "",
        category: BULULU_FEATURED_CATEGORY,
        tags: [],
        sourceId: BULULU_FEATURED_SOURCE_ID,
        githubUrl: "",
        createdAt: item.created_at ? new Date(item.created_at > 1e11 ? item.created_at : item.created_at * 1000).toISOString() : undefined,
        updatedAt: item.updated_at ? new Date(item.updated_at > 1e11 ? item.updated_at : item.updated_at * 1000).toISOString() : undefined,
    };
}

export async function fetchAllFeaturedPrompts(): Promise<Prompt[]> {
    const headers = await getCanvasAuthHeaders();
    const response = await fetch("/api/featured-prompts?page_size=100", { headers });
    if (!response.ok) {
        let message = i18n.t("prompts.loadFailed");
        try {
            const errJson = await response.json();
            if (errJson?.message) message = errJson.message;
        } catch {
            // 保留默认提示
        }
        throw new Error(message);
    }
    const body = await response.json();
    if (!body.success || !body.data || !Array.isArray(body.data.items)) {
        throw new Error(body.message || i18n.t("prompts.loadFailed"));
    }
    return (body.data.items as FeaturedPromptDto[]).map(mapFeaturedPrompt);
}

export async function getCachedFeaturedPrompts(): Promise<Prompt[]> {
    return queryClient.fetchQuery({
        queryKey: FEATURED_PROMPTS_QUERY_KEY,
        queryFn: fetchAllFeaturedPrompts,
        staleTime: FEATURED_PROMPTS_STALE_TIME,
    });
}

export async function fetchPrompts({
    keyword = "",
    tag = [],
    category = ALL_PROMPTS_OPTION,
    page = 1,
    pageSize = 20,
}: {
    keyword?: string;
    tag?: string[];
    category?: string;
    page?: number;
    pageSize?: number;
} = {}): Promise<PromptListResponse> {
    const items = await getCachedFeaturedPrompts();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const filtered = filterPrompts(items, { keyword: normalizedKeyword, category, tags: tag });

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: [ALL_PROMPTS_OPTION],
        categories: [ALL_PROMPTS_OPTION, BULULU_FEATURED_CATEGORY],
        total: filtered.length,
    };
}

export async function fetchSourcePrompts(_sourceId?: string): Promise<Prompt[]> {
    return getCachedFeaturedPrompts();
}

export async function refreshSource(_sourceId: string): Promise<PromptSourceRefreshResult> {
    const items = await queryClient.fetchQuery({
        queryKey: FEATURED_PROMPTS_QUERY_KEY,
        queryFn: fetchAllFeaturedPrompts,
        staleTime: 0,
    });
    return {
        sourceId: BULULU_FEATURED_SOURCE_ID,
        sourceName: BULULU_FEATURED_CATEGORY,
        count: items.length,
        lastSuccessAt: new Date().toISOString(),
        lastError: "",
        success: true,
    };
}

export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {
    const res = await refreshSource(BULULU_FEATURED_SOURCE_ID);
    return {
        results: [res],
        total: res.count,
        successCount: 1,
        failureCount: 0,
    };
}

export async function refreshDueSources(_maxAgeMs: number): Promise<PromptSourceRefreshSummary> {
    return { results: [], total: 0, successCount: 0, failureCount: 0 };
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    return {};
}

export function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.includes(ALL_PROMPTS_OPTION) && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function isActiveOption(value: string) {
    return value && value !== ALL_PROMPTS_OPTION && value !== "all";
}

export function formatPromptDate(value?: string, locale?: string) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
