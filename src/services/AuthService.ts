import { FastifyRequest } from 'fastify';
import { auth } from 'lib/auth';
import { notAuthenticated } from 'utils/http';
import { AUTH_MODE } from 'globals';
import { requireWireCloudUser } from 'services/WireCloudAuth';

/// Who is making the request — via the session from the cookie or via a
/// personal API key. Both end in a user ID; everything else is decided by
/// `AccessService`.
///
/// The desktop client has no browser and therefore no cookie jar that outlives
/// it; `x-api-key` is the simpler way for it.
export async function requireUser(request: FastifyRequest): Promise<string> {
	// In `wirecloud` mode the sign-in comes as a token from WireCloud. The
	// local path below stays as it was.
	if (AUTH_MODE === 'wirecloud') return requireWireCloudUser(request);

	const key = request.headers['x-api-key'];
	if (typeof key === 'string' && key.length > 0) {
		const result = await auth.api.verifyApiKey({
			body: { key, configId: 'user-keys' },
		});
		if (result.valid === true && result.key?.referenceId) {
			return result.key.referenceId;
		}
		throw notAuthenticated();
	}

	const session = await auth.api.getSession({
		headers: new Headers(request.headers as Record<string, string>),
	});
	if (!session?.user?.id) throw notAuthenticated();
	return session.user.id;
}
