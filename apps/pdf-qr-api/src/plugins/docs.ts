import swagger from "@fastify/swagger";
import scalarApiReference from "@scalar/fastify-api-reference";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
	createJsonSchemaTransformObject,
	jsonSchemaTransform,
} from "fastify-type-provider-zod";
import { openapiComponentSchemas } from "../lib/schemas";

const docsPlugin: FastifyPluginAsync = fp(async (app) => {
	await app.register(swagger, {
		openapi: {
			openapi: "3.0.0",
			info: {
				title: "PDF QR stamping API",
				version: "1.0.0",
				description:
					"Upload a PDF, queue QR stamping, poll job status, download the stamped PDF once.",
			},
			tags: [
				{ name: "pdf-qr", description: "PDF upload and QR stamping jobs" },
			],
		},
		transform: jsonSchemaTransform,
		transformObject: createJsonSchemaTransformObject({
			schemas: { ...openapiComponentSchemas },
		}),
	});

	app.get(
		"/openapi.json",
		{
			schema: { hide: true },
		},
		async () => app.swagger(),
	);

	await app.register(scalarApiReference, {
		routePrefix: "/docs",
		logLevel: "silent",
		configuration: {
			title: "PDF QR API",
		},
	});
});

export default docsPlugin;
