import { FastifyInstance } from 'fastify';

import authRoute from 'routes/auth.route';
import keysRoute from 'routes/keys.route';
import workspacesRoute from 'routes/workspaces.route';
import projectsRoute from 'routes/projects.route';
import connectionsRoute from 'routes/connections.route';
import secretsRoute from 'routes/secrets.route';
import sharesRoute from 'routes/shares.route';
import projectKeysRoute from 'routes/projectKeys.route';
import vaultAccountsRoute from 'routes/vaultAccounts.route';
import knownHostsRoute from 'routes/knownHosts.route';
import snippetsRoute from 'routes/snippets.route';
import wirecloudRoute from 'routes/wirecloud.route';
import pagesRoute from 'routes/pages.route';
import { AUTH_MODE } from 'globals';

export default (fastify: FastifyInstance) => {
	// For the probes in Kubernetes: answers as soon as the server accepts
	// requests. Does not appear in the API documentation.
	fastify.get('/health', { schema: { hide: true } }, async () => ({
		status: 'ok',
	}));

	// Accounts, organizations, teams — all from better-auth. In `wirecloud`
	// mode WireCloud decides about them, and there is no route for them here.
	if (AUTH_MODE !== 'wirecloud') {
		authRoute(fastify);
		// Where the links in password-reset and invitation mails lead.
		pagesRoute(fastify);
	} else wirecloudRoute(fastify);

	// The users' key material.
	keysRoute(fastify);

	// The tree.
	workspacesRoute(fastify);
	projectsRoute(fastify);
	connectionsRoute(fastify);
	secretsRoute(fastify);
	sharesRoute(fastify);
	projectKeysRoute(fastify);
	vaultAccountsRoute(fastify);
	knownHostsRoute(fastify);
	snippetsRoute(fastify);
};
