import './telemetry';
import app from './index';
import router from './config/routes';
import fastifySwagger from '@fastify/swagger';
import { API_DOCS, AUTH_MODE, SERVER_HOST, SERVER_PORT } from 'globals';
import { assertWireCloudConfig } from 'services/WireCloudAuth';
import { assertLocalConfig, auth } from 'lib/auth';
import { swaggerOptions } from 'config/apiDocs';

const start = async () => {
	// In `wirecloud` mode without settings there is no sign-in: better to fail
	// at startup than on the first request.
	if (AUTH_MODE === 'wirecloud') assertWireCloudConfig();
	else assertLocalConfig();

	if (API_DOCS) {
		// better-auth describes its own endpoints; in WireCloud mode there are
		// none.
		const authDocument =
			AUTH_MODE === 'wirecloud'
				? undefined
				: await auth.api.generateOpenAPISchema();
		await app.register(fastifySwagger, swaggerOptions(authDocument));
		await app.register(import('@scalar/fastify-api-reference'), {
			routePrefix: '/documentation',
		});
	}

	// Load every plugin before the routes exist: the rate limit only attaches
	// to routes created after it.
	await app.after();

	// handle route
	router(app);

	try {
		await app.listen({ port: SERVER_PORT, host: SERVER_HOST });
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
};

// A failing start (missing settings, a port in use) ends the process with
// the reason in the log instead of an unhandled rejection.
start().catch((error: unknown) => {
	app.log.error(error);
	process.exit(1);
});
