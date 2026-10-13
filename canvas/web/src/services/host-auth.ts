import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import i18n from "@/i18n";

type CanvasHost = {
    getUser: () => Omit<LocalUser, "avatarUrl"> | null;
    getAuthHeaders: () => Promise<Record<string, string>>;
    subscribe: (listener: () => void) => () => void;
};

declare global {
    interface Window {
        newApiCanvasHost?: CanvasHost;
    }
}

export function getCanvasHost() {
    try {
        const host = window.parent !== window ? window.parent.newApiCanvasHost : undefined;
        if (host && typeof host.getUser === "function" && typeof host.getAuthHeaders === "function" && typeof host.subscribe === "function") return host;
    } catch {
        /* 非同域宿主不可用。 */
    }
    throw new Error(i18n.t("integration.hostRequired"));
}

export async function getCanvasAuthHeaders() {
    const host = getCanvasHost();
    const userId = useUserStore.getState().user?.id;
    if (!userId || host.getUser()?.id !== userId) throw new Error(i18n.t("integration.sessionExpired"));
    const headers = await host.getAuthHeaders();
    if (host.getUser()?.id !== userId || !headers.Authorization) throw new Error(i18n.t("integration.sessionExpired"));
    return { Authorization: headers.Authorization };
}

export async function fetchCanvasModels(signal?: AbortSignal): Promise<string[]> {
    const host = getCanvasHost();
    const userId = useUserStore.getState().user?.id;
    const headers = await getCanvasAuthHeaders();
    signal?.throwIfAborted();
    const response = await fetch("/api/user/models", { headers, signal });
    if (!response.ok) throw new Error(i18n.t("integration.modelsFailed"));
    const body = await response.json();
    if (!body.success || !Array.isArray(body.data) || !body.data.every((model: unknown) => typeof model === "string")) {
        throw new Error(i18n.t("integration.modelsFailed"));
    }
    signal?.throwIfAborted();
    if (host.getUser()?.id !== userId || useUserStore.getState().user?.id !== userId) throw new Error(i18n.t("integration.sessionExpired"));
    return body.data;
}
