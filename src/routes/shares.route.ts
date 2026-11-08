import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireWorkspaceAdmin } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { loadProject } from 'services/TreeService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { invalid, notFound } from 'utils/http';

type ProjectParams = { organizationId: string; projectId: string };

const putSchema = {
	body: {
		type: 'object',
		required: ['shares'],
		additionalProperties: false,
		properties: {
			shares: {
				type: 'array',
				maxItems: 200,
				items: {
					type: 'object',
					required: ['role'],
					additionalProperties: false,
					properties: {
						// null means: the whole organization.
						teamId: { type: ['string', 'null'], maxLength: 191 },
						role: { type: 'string', enum: ['editor', 'viewer'] },
					},
				},
			},
		},
	},
};

/// Who gets into a project.
///
/// The teams come from the organization plugin; here we only record which of
/// them sees which project. A share grants *access* to the rows — a new member
/// only gets at the secrets once someone has wrapped the project key for them.
/// What is still missing for that is listed in `GET …/key-requests`.
export default (fastify: FastifyInstance) => {
	fastify.get<{ Params: ProjectParams }>(
		'/api/workspaces/:organizationId/projects/:projectId/shares',
		async (request) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);
			await loadProject(organizationId, projectId);

			const shares = await prisma.projectShare.findMany({
				where: { projectId },
				include: { team: { select: { id: true, name: true } } },
			});

			return shares.map((share) => ({
				id: share.id,
				teamId: share.teamId,
				teamName: share.team?.name ?? null,
				role: share.role,
			}));
		}
	);

	/// Replaces the whole set. A revocation is thus one share fewer in the same
	/// list — and afterwards a matter for the keys: the server deletes the
	/// wrapped copies of those excluded, but what they have read until then
	/// they still know. It is only truly sealed once the client creates a new
	/// version of the project key.
	fastify.put<{
		Params: ProjectParams;
		Body: {
			shares: Array<{
				teamId?: string | null;
				role: 'editor' | 'viewer';
			}>;
		};
	}>(
		'/api/workspaces/:organizationId/projects/:projectId/shares',
		{ schema: putSchema },
		async (request) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);
			await loadProject(organizationId, projectId);

			const teamIds = request.body.shares
				.map((share) => share.teamId)
				.filter((id): id is string => typeof id === 'string');

			if (new Set(teamIds).size !== teamIds.length) {
				throw invalid('a team appears twice in the list');
			}
			if (
				request.body.shares.filter((share) => !share.teamId).length > 1
			) {
				throw invalid('the organization appears twice in the list');
			}

			if (teamIds.length > 0) {
				const found = await prisma.team.count({
					where: { id: { in: teamIds }, organizationId },
				});
				if (found !== teamIds.length) {
					throw notFound(ErrorCodes.TEAM_NOT_FOUND);
				}
			}

			const shares = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);

				await tx.projectShare.deleteMany({ where: { projectId } });
				for (const share of request.body.shares) {
					await tx.projectShare.create({
						data: {
							projectId,
							teamId: share.teamId ?? null,
							role: share.role,
						},
					});
				}

				// The shares are not stored in `project`, but they change
				// what a client gets to see. Without the new revision its
				// copy would stay as it is.
				await tx.project.update({
					where: { id: projectId },
					data: { revision: next },
				});

				// Whoever is no longer allowed keeps no wrapped copy.
				await removeOrphanedKeys(tx, organizationId, projectId);

				return tx.projectShare.findMany({ where: { projectId } });
			});

			return shares.map((share) => ({
				id: share.id,
				teamId: share.teamId,
				role: share.role,
			}));
		}
	);
};

/// Deletes the project keys of those who no longer have access after the
/// change. owner and admin stay: they get into every project without a share.
async function removeOrphanedKeys(
	tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
	organizationId: string,
	projectId: string
) {
	const shares = await tx.projectShare.findMany({
		where: { projectId },
		select: { teamId: true },
	});
	const teamIds = shares
		.map((share) => share.teamId)
		.filter((id): id is string => id !== null);
	const wholeOrganization = shares.some((share) => share.teamId === null);

	const admins = await tx.member.findMany({
		where: { organizationId, role: { in: ['owner', 'admin'] } },
		select: { userId: true },
	});
	const allowed = new Set(admins.map((member) => member.userId));

	if (wholeOrganization) {
		const members = await tx.member.findMany({
			where: { organizationId },
			select: { userId: true },
		});
		members.forEach((member) => allowed.add(member.userId));
	} else if (teamIds.length > 0) {
		const members = await tx.teamMember.findMany({
			where: { teamId: { in: teamIds } },
			select: { userId: true },
		});
		members.forEach((member) => allowed.add(member.userId));
	}

	// In Prisma, `notIn: []` is not "nothing matches" but a filter that
	// restricts nothing. If nobody may access the project anymore, that happens
	// to be right — but not because it is meant that way here.
	const allowedIds = [...allowed];
	await tx.projectKey.deleteMany({
		where:
			allowedIds.length > 0
				? { projectId, userId: { notIn: allowedIds } }
				: { projectId },
	});
}
