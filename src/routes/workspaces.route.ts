import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireUser } from 'services/AuthService';
import { requireWorkspace } from 'services/RequestAccess';
import { delta } from 'services/SyncService';
import { workspaceKind } from 'services/WorkspaceService';
import { parseRevision, revision } from 'utils/http';

type OrgParams = { organizationId: string };

export default (fastify: FastifyInstance) => {
	/// The workspaces this user has — one row per organization they are a
	/// member of. This is the list shown in the client's left-hand sidebar.
	fastify.get('/api/workspaces', async (request) => {
		const userId = await requireUser(request);
		const memberships = await prisma.member.findMany({
			where: { userId },
			select: {
				role: true,
				organization: {
					select: {
						id: true,
						name: true,
						slug: true,
						metadata: true,
						revision: true,
					},
				},
			},
		});

		return memberships.map((membership) => ({
			id: membership.organization.id,
			name: membership.organization.name,
			slug: membership.organization.slug,
			// `personal` means: one's own workspace. The client shows no
			// "Manage members" and no "Delete" on it — inviting is still
			// allowed, and that turns it into a team.
			kind: workspaceKind(membership.organization.metadata),
			role: membership.role,
			revision: revision(membership.organization.revision),
		}));
	});

	/// The sync. `?since=0` is the first start and returns everything this
	/// user may see; every further call takes the `revision` from the last
	/// response.
	fastify.get<{ Params: OrgParams; Querystring: { since?: string } }>(
		'/api/workspaces/:organizationId/sync',
		async (request) => {
			const access = await requireWorkspace(
				request,
				request.params.organizationId
			);
			return delta(access, parseRevision(request.query.since));
		}
	);
};
