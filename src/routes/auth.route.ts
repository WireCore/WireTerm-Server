import { FastifyInstance } from 'fastify';
import { auth } from 'lib/auth';

/// Everything concerning accounts, organizations and teams is answered by
/// better-auth itself: sign-in, invitation to an organization, `create-team`,
/// `add-team-member`, `set-active-team`. This route only passes it through.
export default (fastify: FastifyInstance) => {
	fastify.route({
		method: ['GET', 'POST'],
		url: '/api/auth/*',
		async handler(request, reply) {
			try {
				const url = new URL(
					request.url,
					`http://${request.headers.host}`
				);

				const headers = new Headers();
				Object.entries(request.headers).forEach(([key, value]) => {
					if (value) headers.append(key, value.toString());
				});
				// better-auth reads the address for its rate limit from this
				// header. It is set here, from what Fastify considers the
				// client's address according to `TRUST_PROXY` — a value sent
				// along by the client would otherwise defeat the limit.
				headers.set('x-forwarded-for', request.ip);

				const req = new Request(url.toString(), {
					method: request.method,
					headers,
					body: request.body
						? JSON.stringify(request.body)
						: undefined,
				});

				const response = await auth.handler(req);

				reply.status(response.status);
				response.headers.forEach((value, key) => {
					reply.header(key, value);
				});
				reply.send(response.body ? await response.text() : null);
			} catch (error) {
				fastify.log.error(error);
				reply.status(500).send({
					error: 'Internal authentication error',
					code: 'AUTH_FAILURE',
				});
			}
		},
	});
};
