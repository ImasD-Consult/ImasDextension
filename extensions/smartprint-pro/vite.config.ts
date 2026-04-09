import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const TRIMBLE_HOSTS = {
	na: "https://app.connect.trimble.com",
	eu: "https://app21.connect.trimble.com",
	asia: "https://app31.connect.trimble.com",
} as const;

type Region = keyof typeof TRIMBLE_HOSTS;

function buildProxyConfig() {
	const proxy: Record<string, object> = {};

	for (const region of ["na", "eu", "asia"] as Region[]) {
		for (const version of ["2.0", "2.1"] as const) {
			const suffix = version === "2.1" ? "-21" : "";
			const key = `/tc-api-${region}${suffix}`;

			proxy[key] = {
				target: TRIMBLE_HOSTS[region],
				changeOrigin: true,
				rewrite: (path: string) => path.replace(key, `/tc/api/${version}`),
			};
		}
	}

	return proxy;
}

/** Two manifests, same `url` — register project manifest under Project → Extensions, 3D manifest under 3D Viewer → Extensions (avoids duplicate entries). */
function manifestBody(
	extensionType: readonly ["project"] | readonly ["3dviewer"],
	description: string,
	icon: string,
	url: string,
) {
	return JSON.stringify(
		{
			title: "smartprintPRO",
			description,
			configCommand: "do_config",
			enabled: true,
			extensionType,
			icon,
			url,
		},
		null,
		2,
	);
}

function trimbleManifestPlugin(): Plugin {
	return {
		name: "trimble-manifest",

		configureServer(server) {
			const send = (
				req: { method?: string },
				res: {
					setHeader: (k: string, v: string) => void;
					statusCode: number;
					end: (b: string) => void;
				},
				body: string,
			) => {
				res.setHeader("Access-Control-Allow-Origin", "*");
				if (req.method === "OPTIONS") {
					res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
					res.statusCode = 204;
					res.end("");
					return;
				}
				res.setHeader("Content-Type", "application/json");
				res.end(body);
			};

			server.middlewares.use("/manifest.json", (req, res) => {
				send(
					req,
					res,
					manifestBody(
						["project"],
						"smartprintPRO — add under Project → Extensions (Data / folders). Same app URL as manifest-3d.json.",
						"logo.svg",
						".",
					),
				);
			});
			server.middlewares.use("/manifest-3d.json", (req, res) => {
				send(
					req,
					res,
					manifestBody(
						["3dviewer"],
						"smartprintPRO — add under 3D Viewer → Settings → Extensions only.",
						"logo.svg",
						".",
					),
				);
			});
		},

		generateBundle() {
			const origin = process.env.EXTENSION_URL;
			const icon = origin
				? `${origin.replace(/\/$/, "")}/logo.svg`
				: "logo.svg";
			const url = origin ? origin.replace(/\/$/, "") : ".";

			this.emitFile({
				type: "asset",
				fileName: "manifest.json",
				source: manifestBody(
					["project"],
					"smartprintPRO — Project → Extensions (Data). Pair with manifest-3d.json for 3D.",
					icon,
					url,
				),
			});
			this.emitFile({
				type: "asset",
				fileName: "manifest-3d.json",
				source: manifestBody(
					["3dviewer"],
					"smartprintPRO — 3D Viewer → Extensions only.",
					icon,
					url,
				),
			});
		},
	};
}

const proxy = buildProxyConfig();

export default defineConfig(({ mode }) => ({
	base: mode === "production" ? "/trimble/smartprintPRO/" : "/",
	server: {
		port: 3000,
		cors: true,
		proxy,
		allowedHosts: [
			".ngrok-free.dev",
			".ngrok-free.app",
			"web.connect.trimble.com",
		],
	},
	preview: { cors: true, proxy },
	build: { outDir: "dist" },
	plugins: [tailwindcss(), trimbleManifestPlugin()],
}));
