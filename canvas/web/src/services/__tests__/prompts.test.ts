import { test } from "node:test";
import assert from "node:assert/strict";
import { useUserStore } from "@/stores/use-user-store";
import { queryClient } from "@/lib/query-client";
import {
    ALL_PROMPTS_OPTION,
    BULULU_FEATURED_CATEGORY,
    BULULU_FEATURED_SOURCE_ID,
    FEATURED_PROMPTS_QUERY_KEY,
    fetchPrompts,
    fetchSourcePrompts,
} from "@/services/api/prompts";

const mockFeaturedItems = [
    {
        id: 1,
        title: "赛博朋克霓虹猫咪",
        prompt: "Cyberpunk neon cat with glowing blue eyes, cinematic lighting",
        cover_url: "https://assets.test/cat.webp",
        sort_order: 1,
        created_at: 1726000000,
        updated_at: 1726000000,
    },
    {
        id: 2,
        title: "水墨江南画卷",
        prompt: "Traditional Chinese ink wash painting, mist covered mountains and river",
        cover_url: "https://assets.test/ink.webp",
        sort_order: 2,
        created_at: 1726000100,
        updated_at: 1726000100,
    },
    {
        id: 3,
        title: "未来太空站",
        prompt: "Futuristic space station orbiting Mars, ultra detailed sci-fi concept",
        cover_url: "",
        sort_order: 3,
        created_at: 1726000200,
        updated_at: 1726000200,
    },
];

function setupHostAuth(userId = "user-m10") {
    useUserStore.setState({ user: { id: userId, username: "m10-tester", displayName: "", avatarUrl: "" } });
    globalThis.window = {
        parent: {
            newApiCanvasHost: {
                getUser: () => ({ id: userId }),
                getAuthHeaders: async () => ({ Authorization: "Bearer test-session-token" }),
                subscribe: () => () => {},
            },
        },
    } as unknown as Window & typeof globalThis;
}

test("M10 fetchPrompts 经宿主认证全量拉取本站精选词库并完成单分类映射与缓存", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    queryClient.removeQueries({ queryKey: FEATURED_PROMPTS_QUERY_KEY });
    setupHostAuth();

    let fetchCount = 0;
    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCount++;
        requestedUrl = String(input);
        requestedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: {
                    page: 1,
                    page_size: 100,
                    total: mockFeaturedItems.length,
                    items: mockFeaturedItems,
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        const result = await fetchPrompts();
        assert.equal(fetchCount, 1);
        assert.equal(requestedUrl, "/api/featured-prompts?page_size=100");
        assert.equal(requestedHeaders.Authorization, "Bearer test-session-token");

        // 验证分类与标签映射
        assert.deepEqual(result.categories, [ALL_PROMPTS_OPTION, BULULU_FEATURED_CATEGORY]);
        assert.deepEqual(result.tags, [ALL_PROMPTS_OPTION]);
        assert.equal(result.total, 3);
        assert.equal(result.items.length, 3);

        const first = result.items[0];
        assert.equal(first.id, "1");
        assert.equal(first.title, "赛博朋克霓虹猫咪");
        assert.equal(first.prompt, "Cyberpunk neon cat with glowing blue eyes, cinematic lighting");
        assert.equal(first.coverUrl, "https://assets.test/cat.webp");
        assert.deepEqual(first.referenceImageUrls, ["https://assets.test/cat.webp"]);
        assert.equal(first.category, BULULU_FEATURED_CATEGORY);
        assert.equal(first.sourceId, BULULU_FEATURED_SOURCE_ID);
        assert.deepEqual(first.tags, []);

        // 验证缓存命中：再次调用不应产生二次网络请求
        const cachedResult = await fetchPrompts();
        assert.equal(fetchCount, 1, "缓存期内不应再次发起网络请求");
        assert.equal(cachedResult.total, 3);

        // 验证 fetchSourcePrompts 共享同一缓存
        const sourceResult = await fetchSourcePrompts("bululu-featured");
        assert.equal(fetchCount, 1, "fetchSourcePrompts 应当共享底层缓存");
        assert.equal(sourceResult.length, 3);
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        queryClient.removeQueries({ queryKey: FEATURED_PROMPTS_QUERY_KEY });
    }
});

test("M10 内存 0ms 关键词搜索与切片分页", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    queryClient.removeQueries({ queryKey: FEATURED_PROMPTS_QUERY_KEY });
    setupHostAuth();

    globalThis.fetch = (async () => {
        return new Response(
            JSON.stringify({
                success: true,
                message: "",
                data: {
                    page: 1,
                    page_size: 100,
                    total: mockFeaturedItems.length,
                    items: mockFeaturedItems,
                },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }) as typeof fetch;

    try {
        // 1. 匹配中文标题
        const searchChinese = await fetchPrompts({ keyword: "水墨" });
        assert.equal(searchChinese.total, 1);
        assert.equal(searchChinese.items[0].title, "水墨江南画卷");

        // 2. 匹配英文正文（大小写不敏感）
        const searchEnglish = await fetchPrompts({ keyword: "CYBERPUNK" });
        assert.equal(searchEnglish.total, 1);
        assert.equal(searchEnglish.items[0].title, "赛博朋克霓虹猫咪");

        // 3. 切片分页
        const page1 = await fetchPrompts({ page: 1, pageSize: 2 });
        assert.equal(page1.total, 3);
        assert.equal(page1.items.length, 2);
        assert.equal(page1.items[0].id, "1");
        assert.equal(page1.items[1].id, "2");

        const page2 = await fetchPrompts({ page: 2, pageSize: 2 });
        assert.equal(page2.total, 3);
        assert.equal(page2.items.length, 1);
        assert.equal(page2.items[0].id, "3");

        // 4. 无命中关键词
        const searchEmpty = await fetchPrompts({ keyword: "not_found_query" });
        assert.equal(searchEmpty.total, 0);
        assert.equal(searchEmpty.items.length, 0);
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        queryClient.removeQueries({ queryKey: FEATURED_PROMPTS_QUERY_KEY });
    }
});

test("M10 接口异常时直接报错，坚决不回退外部源与离线脏缓存", async () => {
    const fetchBefore = globalThis.fetch;
    const windowBefore = globalThis.window;
    queryClient.removeQueries({ queryKey: FEATURED_PROMPTS_QUERY_KEY });
    setupHostAuth();

    globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ success: false, message: "服务暂时不可用" }), { status: 500 });
    }) as typeof fetch;

    try {
        await assert.rejects(fetchPrompts(), /服务暂时不可用|加载提示词失败/);
    } finally {
        globalThis.fetch = fetchBefore;
        globalThis.window = windowBefore;
        queryClient.removeQueries({ queryKey: FEATURED_PROMPTS_QUERY_KEY });
    }
});
