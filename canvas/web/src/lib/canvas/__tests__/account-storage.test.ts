import { test } from "node:test";
import assert from "node:assert/strict";
import { localForageStorage } from "@/lib/localforage-storage";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";

test("画布工程与数字资产不再写入 localForage / IndexedDB", async () => {
    const original = { ...localForageStorage };
    const reads: string[] = [];
    const writes: Array<{ key: string; value: string }> = [];
    localForageStorage.getItem = async (key) => {
        reads.push(key);
        return null;
    };
    localForageStorage.setItem = async (key, value) => {
        writes.push({ key, value });
    };
    try {
        useUserStore.setState({ user: { id: "a", username: "a", displayName: "", avatarUrl: "" } });
        useAssetStore.getState().addAsset({ kind: "text", title: "A 的资产", coverUrl: "", tags: [], data: { content: "private-a" } });
        useUserStore.setState({ user: { id: "b", username: "b", displayName: "", avatarUrl: "" } });

        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.equal(reads.length, 0);
        assert.equal(writes.length, 0);
    } finally {
        Object.assign(localForageStorage, original);
        useUserStore.getState().clearSession();
    }
});
