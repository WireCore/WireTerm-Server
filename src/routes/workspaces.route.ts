import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { AUTH_MODE, WIRECLOUD_ISSUER } from 'globals';
import { requireWorkspaceAdmin } from 'services/AccessService';
import { requireUser } from 'services/AuthService';
import { requireWorkspace } from 'services/RequestAccess';
import { delta } from 'services/SyncService';
import { workspaceKind } from 'services/WorkspaceService';
import { parseRevision, revision } from 'utils/http';

type OrgParams = { organizationId: string };

const settingsSchema = {
	body: {
		type: 'object',
		required: ['memberProjects'],
		additionalProperties: false,
		properties: { memberProjects: { type: 'boolean' } },
	},
};

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
						memberProjects: true,
					},
				},
			},
		});

		// In WireCloud mode: which WireCloud company an organization stands for.
		// The client fetches the company's image from WireCloud with it; this
		// server keeps no pictures.
		const companies = new Map<string, string>();
		if (AUTH_MODE === 'wirecloud' && memberships.length > 0) {
			const refs = await prisma.externalRef.findMany({
				where: {
					entityType: 'organization',
					issuer: WIRECLOUD_ISSUER,
					localId: {
						in: memberships.map((m) => m.organization.id),
					},
				},
				select: { localId: true, externalId: true },
			});
			for (const ref of refs) companies.set(ref.localId, ref.externalId);
		}

		return memberships.map((membership) => ({
			id: membership.organization.id,
			name: membership.organization.name,
			slug: membership.organization.slug,
			// `personal` means: one's own workspace. The client shows no
			// "Manage members" and no "Delete" on it — inviting is still
			// allowed, and that turns it into a team.
			kind: workspaceKind(membership.organization.metadata),
			role: membership.role,
			// Whether members may create projects, not only owner and admin.
			memberProjects: membership.organization.memberProjects,
			revision: revision(membership.organization.revision),
			// `null` for "Personal", for organizations of this server's own and
			// outside WireCloud mode.
			wirecloudCompany: companies.get(membership.organization.id) ?? null,
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

	/// The settings of a workspace that are WireTerm's, not better-auth's.
	/// Name, members and teams stay with better-auth (or WireCloud).
	fastify.patch<{ Params: OrgParams; Body: { memberProjects: boolean } }>(
		'/api/workspaces/:organizationId',
		{ schema: settingsSchema },
		async (request) => {
			const { organizationId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);

			const organization = await prisma.organization.update({
				where: { id: organizationId },
				data: { memberProjects: request.body.memberProjects },
				select: { memberProjects: true },
			});
			return { memberProjects: organization.memberProjects };
		}
	);
};
