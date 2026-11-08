import dotenv from 'dotenv';
dotenv.config();

import type { FastifyCookieOptions } from '@fastify/cookie';
import cookie from '@fastify/cookie';
import fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyView from '@fastify/view';
import nunjucks from 'nunjucks';
import path from 'path';
import { fileURLToPath } from 'url';

import corsConfig from './config/cors';
import { documentRoutes } from './config/apiDocs';
import { COOKIE_SECRET, LOG_LEVEL, RATE_LIMIT_MAX, TRUST_PROXY } from 'globals';
import { ErrorCodes } from 'utils/ErrorCodes';
import { HttpError, sendError } from 'utils/http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/// `TRUST_PROXY` the way Fastify understands it. Without a value the server
/// trusts nobody: then the address the connection comes from counts, and an
/// `X-Forwarded-For` sent along changes nothing about that.
function trustProxy(
	value: string | undefined
): FastifyServerOptions['trustProxy'] {
	if (!value) return false;
	if (value === 'true') return true;
	if (/^\d+$/.test(value)) {
		const hops = Number(value);
		return (_address, hop) => hop < hops;
	}
	return value;
}

const app = fastify({
	logger: { level: LOG_LEVEL },
	trustProxy: trustProxy(TRUST_PROXY),
});

// Tag and summary for the API reference, attached as the routes are added.
documentRoutes(app);

app.register(cors, corsConfig);
app.register(helmet, { contentSecurityPolicy: false });
// Applies to every route except the probe. better-auth additionally and more
// tightly throttles sign-in and sign-up, see `rateLimit` in `lib/auth.ts`.
app.register(rateLimit, {
	max: Number(RATE_LIMIT_MAX) || 600,
	timeWindow: '1 minute',
	allowList: (request) => request.url === '/health',
	errorResponseBuilder: (_request, context) =>
		new HttpError(
			429,
			ErrorCodes.RATE_LIMITED,
			`Too many requests, retry in ${context.after}`
		),
});
app.register(cookie, {
	secret: COOKIE_SECRET,
	hook: 'onRequest',
	parseOptions: {},
} as FastifyCookieOptions);

// Templates for the mails (`mail/`) and the few pages this backend serves
// itself (`page/`).
app.register(fastifyView, {
	root: path.join(__dirname, 'templates'),
	engine: {
		nunjucks: nunjucks,
	},
});

// Every route only throws — what becomes of that is decided in this one place.
// Fastify's own schema validation ends up here too, with `validation` set; it
// says which field did not match, and the client may know that.
app.setErrorHandler((error, _request, reply) => {
	if ((error as { validation?: unknown }).validation) {
		return reply.status(400).send({
			code: ErrorCodes.INVALID_PAYLOAD,
			detail: (error as Error).message,
		});
	}
	return sendError(reply, error);
});

export default app;
export { app };
