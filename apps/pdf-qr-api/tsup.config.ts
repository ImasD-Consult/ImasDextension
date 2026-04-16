import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/worker.ts"],
	outDir: "dist",
	format: ["esm"],
	platform: "node",
	target: "node20",
	sourcemap: true,
	clean: true,
	splitting: false,
	bundle: true,
	external: ["mupdf"],
});
