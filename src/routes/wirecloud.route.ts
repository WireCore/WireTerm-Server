import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { notAuthenticated } from 'utils/http';
import { WIRECLOUD_AUDIENCE, WIRECLOUD_URL } from 'globals';
import {
	linkWireCloudAccount,
	requireWireCloudAdmin,
	requireWireCloudUser,
	wireCloudIssuer,
} from 'services/WireCloudAuth';
import {
	EVENT_TYPES,
	WireCloudEvent,
	applyEvents,
} from 'services/WireCloudEventService';

/// Only mounted in `wirecloud` mode (see config/routes.ts).
export default (fastify: FastifyInstance) => {
	// Links the local account with the same address to the token's WireCloud
	// account. The client calls this after running into `WC-EC` (409) and the
	// person has entered their previous sign-in password.
	fastify.post(
		'/api/wirecloud/link',
		{
			schema: {
				hide: true,
				body: {
					type: 'object',
					required: ['password'],
					additionalProperties: false,
					properties: {
						password: {
							type: 'string',
							minLength: 1,
							maxLength: 1024,
						},
					},
				},
			},
		},
		async (request) => {
			const { password } = request.body as { password: string };
			return linkWireCloudAccount(request, password);
		}
	);

	// Who the person is here. The token only names WireCloud's identifier
	// (`sub`); keys and memberships hang off the local one. In local mode,
	// better-auth's `get-session` answers this.
	fastify.get(
		'/api/wirecloud/me',
		{ schema: { hide: true } },
		async (request) => {
			const userId = await requireWireCloudUser(request);
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { id: true, name: true, email: true },
			});
			if (!user) throw notAuthenticated();
			return user;
		}
	);

	// The tool describes itself to WireCloud (VERTRAG.md section 7).
	fastify.get(
		'/.well-known/wirecloud-tool.json',
		{ schema: { hide: true } },
		async () => ({
			contract_version: 1,
			tool: 'wireterm',
			audience: WIRECLOUD_AUDIENCE,
			// Where a client goes to sign in (`/v1/client-auth/authorize`)
			// and where it fetches tokens.
			wirecloud_url: WIRECLOUD_URL,
			role_keys: ['owner', 'admin', 'member'],
			capabilities: { teams: true, events: true, limits: false },
			project_shares: 'tool',
			admin_api: '/wc/v1',
			events: EVENT_TYPES,
		})
	);

	// Events from WireCloud: revocation, role change, deleted team or deleted
	// company, suspended or deleted account. Delivered at least once and in
	// order, applied idempotently here.
	fastify.post(
		'/wc/v1/events',
		{
			schema: {
				hide: true,
				body: {
					type: 'object',
					required: ['events'],
					properties: {
						events: {
							type: 'array',
							minItems: 1,
							maxItems: 100,
							items: {
								type: 'object',
								required: ['id', 'type', 'sequence'],
								properties: {
									id: {
										type: 'string',
										minLength: 1,
										maxLength: 191,
									},
									type: { type: 'string', maxLength: 48 },
									sequence: { type: 'integer', minimum: 0 },
									company: { type: 'string', maxLength: 191 },
									account: { type: 'string', maxLength: 191 },
									team: { type: 'string', maxLength: 191 },
									team_name: {
										type: 'string',
										maxLength: 255,
									},
									role: { type: 'string', maxLength: 32 },
								},
							},
						},
					},
				},
			},
		},
		async (request) => {
			await requireWireCloudAdmin(request, 'events:write');
			const { events } = request.body as { events: WireCloudEvent[] };
			return applyEvents(events, {
				prisma,
				issuer: wireCloudIssuer(),
			});
		}
	);
};
