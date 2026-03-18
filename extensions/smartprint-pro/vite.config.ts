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

const MANIFEST_BASE = {
	title: "smartprintPRO",
	description: "ImasD / smartprintPRO integration for Trimble Connect",
	configCommand: "do_config",
	enabled: true,
};

function trimbleManifestPlugin(): Plugin {
	return {
		name: "trimble-manifest",

		configureServer(server) {
			server.middlewares.use("/manifest.json", (_req, res) => {
				const port = server.config.server.port ?? 3000;
				const origin = `http://localhost:${port}`;

				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify(
						{
							...MANIFEST_BASE,
							icon: `${origin}/logo.svg`,
							url: `${origin}`,
						},
						null,
						2,
					),
				);
			});
		},

		generateBundle() {
			const origin =
				process.env.EXTENSION_URL ??
				"https://extensions.imasdconsult.com/trimble/smartprintPRO";

			this.emitFile({
				type: "asset",
				fileName: "manifest.json",
				source: JSON.stringify(
					{
						...MANIFEST_BASE,
						icon: `${origin}/logo.svg`,
						url: `${origin}`,
					},
					null,
					2,
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
		allowedHosts: [".ngrok-free.app", "web.connect.trimble.com"],
	},
	preview: { proxy },
	build: { outDir: "dist" },
	plugins: [tailwindcss(), trimbleManifestPlugin()],
}));
