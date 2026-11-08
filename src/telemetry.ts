import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import FastifyOtelInstrumentation from '@fastify/otel';
import { OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME } from 'globals';

export const otelInstrumentation = new FastifyOtelInstrumentation({
	registerOnInitialization: true,
	ignorePaths: '/documentation',
});

// Without a collector there is nothing to export to: the SDK stays off
// instead of sending to an address nobody configured.
if (OTEL_EXPORTER_OTLP_ENDPOINT) {
	const url = OTEL_EXPORTER_OTLP_ENDPOINT;
	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			// Further attributes come from OTEL_RESOURCE_ATTRIBUTES.
			'service.name': OTEL_SERVICE_NAME || 'wireterm-backend',
		}),
		traceExporter: new OTLPTraceExporter({ url }),
		logRecordProcessor: new BatchLogRecordProcessor({
			exporter: new OTLPLogExporter({ url }),
		}),
		instrumentations: [
			otelInstrumentation,
			new PinoInstrumentation(),
			new HttpInstrumentation(),
			new PrismaInstrumentation(),
		],
	});
	sdk.start();
	process.on('SIGTERM', () => {
		void sdk.shutdown().finally(() => process.exit(0));
	});
}
