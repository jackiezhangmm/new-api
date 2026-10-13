import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { getCanvasHost, fetchCanvasModels } from "@/services/host-auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

let initialization: Promise<void> | undefined;

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        let unsubscribe = () => {};
        setReady(false);
        setError("");
        try {
            const host = getCanvasHost();
            const user = host.getUser();
            if (!user) throw new Error(t("integration.sessionExpired"));
            useUserStore.setState({ user: { ...user, displayName: user.displayName || "", avatarUrl: "" } });
            unsubscribe = host.subscribe(() => {
                active = false;
                useConfigStore.getState().setAvailableModels([]);
                setReady(false);
                setError(t("integration.sessionExpired"));
            });
            // 身份确定后才恢复账号数据；StrictMode 重挂载复用同一次初始化。
            initialization ??= (async () => {
                const models = await fetchCanvasModels();
                if (host.getUser()?.id !== user.id) throw new Error(t("integration.sessionExpired"));
                useConfigStore.getState().setAvailableModels(models);
                await useCanvasStore.getState().fetchProjects().catch((err) => {
                    console.error("Failed to fetch canvas projects:", err);
                });
                useCanvasStore.setState({ hydrated: true });
                if (!useCanvasStore.getState().hydrated) throw new Error(t("integration.storageFailed"));
            })().catch((reason) => {
                initialization = undefined;
                throw reason;
            });
            void initialization
                .then(() => {
                    if (active && host.getUser()?.id === user.id) setReady(true);
                })
                .catch((reason) => {
                    if (active) setError(reason instanceof Error ? reason.message : t("integration.storageFailed"));
                });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("integration.hostRequired"));
        }
        return () => {
            active = false;
            unsubscribe();
        };
    }, [t]);

    if (!ready)
        return (
            <main className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-sm" role="status">
                <p>{error || t("canvas.loading")}</p>
                {error ? <Button onClick={() => window.location.reload()}>{t("canvas.node.retry")}</Button> : null}
            </main>
        );
    return (
        <div className="flex h-dvh flex-col">
            <div className="min-h-0 flex-1">{children}</div>
        </div>
    );
}
