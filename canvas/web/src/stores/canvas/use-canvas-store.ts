import { create } from "zustand";
import i18n from "@/i18n";
import { requireCanvasCapability } from "@/lib/canvas/canvas-capabilities";
import {
    fetchCanvasProjectList,
    fetchCloudProject,
    createCloudProject,
    updateCloudProject,
    deleteCloudProject,
} from "@/services/api/project";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    fetchProjects: () => Promise<void>;
    loadProject: (id: string) => Promise<CanvasProject>;
    createProject: (title?: string, content?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
    hydrated: false,
    projects: [],
    deletedProjects: [],

    fetchProjects: async () => {
        try {
            const list = await fetchCanvasProjectList();
            const currentProjects = get().projects;
            const projectMap = new Map(currentProjects.map((p) => [p.id, p]));

            const projects: CanvasProject[] = list.map((meta) => {
                const existing = projectMap.get(meta.id);
                if (existing && existing.revision >= meta.revision) {
                    return existing;
                }
                return {
                    id: meta.id,
                    title: meta.title,
                    revision: meta.revision,
                    createdAt: new Date(meta.created_at * 1000).toISOString(),
                    updatedAt: new Date(meta.updated_at * 1000).toISOString(),
                    nodes: existing?.nodes || [],
                    connections: existing?.connections || [],
                    chatSessions: existing?.chatSessions || [],
                    activeChatId: existing?.activeChatId ?? null,
                    backgroundMode: existing?.backgroundMode || "lines",
                    showImageInfo: existing?.showImageInfo || false,
                    viewport: existing?.viewport || initialViewport,
                };
            });
            set({ projects, hydrated: true });
        } catch {
            set({ hydrated: true });
        }
    },

    loadProject: async (id: string) => {
        const cloud = await fetchCloudProject(id);
        let parsed: Partial<CanvasProject> = {};
        try {
            parsed = JSON.parse(cloud.content);
        } catch {
            parsed = {};
        }
        const project: CanvasProject = {
            id: cloud.id,
            title: cloud.title,
            revision: cloud.revision,
            createdAt: new Date(cloud.created_at * 1000).toISOString(),
            updatedAt: new Date(cloud.updated_at * 1000).toISOString(),
            nodes: parsed.nodes || [],
            connections: parsed.connections || [],
            chatSessions: parsed.chatSessions || [],
            activeChatId: parsed.activeChatId ?? null,
            backgroundMode: parsed.backgroundMode || "lines",
            showImageInfo: parsed.showImageInfo || false,
            viewport: parsed.viewport || initialViewport,
        };
        set((state) => {
            const index = state.projects.findIndex((p) => p.id === id);
            if (index >= 0) {
                const next = [...state.projects];
                next[index] = project;
                return { projects: next };
            }
            return { projects: [project, ...state.projects] };
        });
        return project;
    },

    createProject: async (title = i18n.t("canvas.project.untitled"), content?: string) => {
        const initialContent = content || JSON.stringify({
            nodes: [],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines",
            showImageInfo: false,
            viewport: initialViewport,
        });
        const cloud = await createCloudProject({ title, content: initialContent });
        let parsed: Partial<CanvasProject> = {};
        try {
            parsed = JSON.parse(initialContent);
        } catch {
            parsed = {};
        }
        const project: CanvasProject = {
            id: cloud.id,
            title: cloud.title,
            revision: cloud.revision,
            createdAt: new Date(cloud.created_at * 1000).toISOString(),
            updatedAt: new Date(cloud.updated_at * 1000).toISOString(),
            nodes: parsed.nodes || [],
            connections: parsed.connections || [],
            chatSessions: parsed.chatSessions || [],
            activeChatId: parsed.activeChatId ?? null,
            backgroundMode: parsed.backgroundMode || "lines",
            showImageInfo: parsed.showImageInfo || false,
            viewport: parsed.viewport || initialViewport,
        };
        set((state) => ({ projects: [project, ...state.projects.filter((p) => p.id !== project.id)] }));
        return project.id;
    },

    importProject: () => {
        requireCanvasCapability("projectTransfer");
        throw new Error(i18n.t("integration.unavailable"));
    },

    openProject: (id) => {
        return get().projects.find((item) => item.id === id) || null;
    },

    renameProject: async (id, title) => {
        const trimmed = title.trim();
        const project = get().projects.find((p) => p.id === id);
        if (!project || (trimmed && trimmed === project.title)) return;

        const nextTitle = trimmed || project.title;
        set((state) => ({
            projects: state.projects.map((p) => (p.id === id ? { ...p, title: nextTitle, updatedAt: new Date().toISOString() } : p)),
        }));

        try {
            const updated = await updateCloudProject(id, { revision: project.revision, title: nextTitle });
            set((state) => ({
                projects: state.projects.map((p) => (p.id === id ? { ...p, revision: updated.revision, updatedAt: new Date(updated.updated_at * 1000).toISOString() } : p)),
            }));
        } catch {
            // Error handling left to caller or subsequent save
        }
    },

    deleteProjects: async (ids) => {
        const removing = new Set(ids);
        set((state) => ({
            projects: state.projects.filter((p) => !removing.has(p.id)),
        }));
        await Promise.all(ids.map((id) => deleteCloudProject(id).catch(() => {})));
    },

    replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),

    updateProject: (id, patch) =>
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
        })),
}));
