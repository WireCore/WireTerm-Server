import app from '../../src/index';
import router from '../../src/config/routes';

let ready: Promise<void> | undefined;

// Fastify's request logs make the test output unreadable.
app.log.level = 'silent';

/// Resolves once the app is ready. The instance itself is `app`: it is a
/// thenable, so returning it from a promise would unwrap it.
export function getTestApp(): Promise<void> {
	ready ??= (async () => {
		// As in `server.ts`, load the plugins first, then register the routes:
		// the rate limit only attaches to routes created after it.
		await app.after();
		router(app);
		await app.ready();
	})();
	return ready;
}

type Options = {
	payload?: unknown;
	headers?: Record<string, string>;
	query?: Record<string, string>;
};

export async function call(
	method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
	url: string,
	options: Options = {}
) {
	await getTestApp();
	return app.inject({
		method,
		url,
		payload: options.payload as never,
		headers: options.headers,
		query: options.query,
	});
}
