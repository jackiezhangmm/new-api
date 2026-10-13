import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    outputDir: "/tmp/new-api-canvas-m1-artifacts",
    use: { baseURL: process.env.CANVAS_TEST_URL || "http://127.0.0.1:5173", screenshot: "only-on-failure" },
    workers: 1,
});
