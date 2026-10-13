import type { Page } from "@playwright/test";

export async function mockCanvasProjectApi(page: Page, initialProjects: any[] = []) {
    let projects = [...initialProjects];

    await page.route("**/api/canvas/projects**", async (route) => {
        const method = route.request().method();
        const url = route.request().url();

        if (method === "POST") {
            const body = route.request().postDataJSON() || {};
            const newProj = {
                id: body.id || `proj-${Date.now()}`,
                user_id: 903,
                title: body.title || "无限画布 1",
                revision: 1,
                content: body.content || "{}",
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
            };
            projects.unshift(newProj);
            await route.fulfill({ json: { success: true, data: newProj } });
        } else if (method === "GET") {
            if (url.includes("/api/canvas/projects/")) {
                const id = url.split("/api/canvas/projects/")[1].split("?")[0];
                const found = projects.find((p) => p.id === id);
                if (found) {
                    await route.fulfill({ json: { success: true, data: found } });
                } else {
                    await route.fulfill({ status: 404, json: { success: false, message: "Not found" } });
                }
            } else {
                await route.fulfill({
                    json: {
                        success: true,
                        data: projects.map((p) => ({
                            id: p.id,
                            user_id: p.user_id,
                            title: p.title,
                            revision: p.revision,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        })),
                    },
                });
            }
        } else if (method === "PUT") {
            const body = route.request().postDataJSON() || {};
            const id = url.split("/api/canvas/projects/")[1].split("?")[0];
            const found = projects.find((p) => p.id === id);
            if (found) {
                found.revision = (body.revision || found.revision) + 1;
                if (body.title) found.title = body.title;
                if (body.content) found.content = body.content;
                found.updated_at = Math.floor(Date.now() / 1000);
                await route.fulfill({ json: { success: true, data: found } });
            } else {
                await route.fulfill({ status: 404, json: { success: false, message: "Not found" } });
            }
        } else if (method === "DELETE") {
            const id = url.split("/api/canvas/projects/")[1].split("?")[0];
            projects = projects.filter((p) => p.id !== id);
            await route.fulfill({ json: { success: true, message: "Deleted" } });
        } else {
            await route.continue();
        }
    });

    return {
        getProjects: () => projects,
        setProjects: (next: any[]) => {
            projects = next;
        },
    };
}
