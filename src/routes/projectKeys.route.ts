import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireProject, requireWorkspaceAdmin } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { loadProject } from 'services/TreeService';
import { projectKeyToApi } from 'services/SyncService';
import { forbidden, fromBase64, invalid, toBase64 } from 'utils/http';

type OrgParams = { organizationId: string };
type ProjectParams = OrgParams & { projectId: string };

const grantSchema = {
	body: {
		type: 'object',
		required: ['keyId', 'grants'],
		additionalProperties: false,
		properties: {
			keyId: { type: 'string', minLength: 1, maxLength: 64 },
			algorithm: { type: 'string', maxLength: 64 },
			grants: {
				type: 'array',
				minItems: 1,
				maxItems: 200,
				items: {
					type: 'object',
					required: [
						'userId',
						'ephemeralPublicKey',
						'nonce',
						'wrappedKey',
					],
					additionalProperties: false,
					properties: {
						userId: { type: 'string', maxLength: 191 },
						ephemeralPublicKey: { type: 'string', maxLength: 128 },
						nonce: { type: 'string', maxLength: 64 },
						wrappedKey: { type: 'string', maxLength: 512 },
					},
				},
			},
		},
	},
};

/// The project keys.
///
/// The server distributes them, but neither creates nor reads them: it accepts
/// what a client has wrapped for another user and hands it out again to
/// exactly that user. So all it can do is record a grant — only someone who
/// already holds the key can issue one.
export default (fastify: FastifyInstance) => {
	/// The public keys of all members of the workspace. Whoever wants to issue
	/// a grant needs them for wrapping.
	fastify.get<{ Params: OrgParams }>(
		'/api/workspaces/:organizationId/member-keys',
		async (request) => {
			const { organizationId } = request.params;
			await requireWorkspace(request, organizationId);

			const members = await prisma.member.findMany({
				where: { organizationId },
				select: {
					userId: true,
					role: true,
					user: {
						select: {
							name: true,
							email: true,
							key: {
								select: {
									algorithm: true,
									publicKey: true,
								},
							},
						},
					},
				},
			});

			return members.map((member) => ({
				userId: member.userId,
				name: member.user.name,
				email: member.user.email,
				role: member.role,
				// `null` as long as this user has not set up a master password
				// yet. Nothing can be wrapped for them.
				key: member.user.key
					? {
							algorithm: member.user.key.algorithm,
							publicKey: toBase64(member.user.key.publicKey),
						}
					: null,
			}));
		}
	);

	/// Who is still missing something for this project: everyone allowed to
	/// see it, with their public key and the versions they already hold. The
	/// client compares that with its own and fills the gaps.
	fastify.get<{ Params: ProjectParams }>(
		'/api/workspaces/:organizationId/projects/:projectId/key-requests',
		async (request) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireProject(access, projectId, 'viewer');
			await loadProject(organizationId, projectId);

			const entitled = await entitledUsers(organizationId, projectId);
			const keys = await prisma.projectKey.findMany({
				where: { projectId, userId: { in: [...entitled] } },
				select: { userId: true, keyId: true },
			});
			const held = new Map<string, string[]>();
			for (const key of keys) {
				held.set(key.userId, [
					...(held.get(key.userId) ?? []),
					key.keyId,
				]);
			}

			const users = await prisma.user.findMany({
				where: { id: { in: [...entitled] } },
				select: {
					id: true,
					name: true,
					email: true,
					key: { select: { algorithm: true, publicKey: true } },
				},
			});

			return users.map((user) => ({
				userId: user.id,
				name: user.name,
				email: user.email,
				key: user.key
					? {
							algorithm: user.key.algorithm,
							publicKey: toBase64(user.key.publicKey),
						}
					: null,
				keyIds: held.get(user.id) ?? [],
			}));
		}
	);

	/// Accepts wrapped copies. This is allowed for whoever may edit the
	/// project — and, once the version already exists, only for whoever holds
	/// it themselves: whoever does not have it cannot have wrapped it either.
	fastify.post<{
		Params: ProjectParams;
		Body: {
			keyId: string;
			algorithm?: string;
			grants: Array<{
				userId: string;
				ephemeralPublicKey: string;
				nonce: string;
				wrappedKey: string;
			}>;
		};
	}>(
		'/api/workspaces/:organizationId/projects/:projectId/keys',
		{ schema: grantSchema },
		async (request, reply) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireProject(access, projectId, 'editor');
			await loadProject(organizationId, projectId);

			const { keyId } = request.body;
			const existing = await prisma.projectKey.count({
				where: { projectId, keyId },
			});
			if (existing > 0) {
				const own = await prisma.projectKey.count({
					where: { projectId, keyId, userId: access.userId },
				});
				if (own === 0) throw forbidden();
			}

			const entitled = await entitledUsers(organizationId, projectId);
			for (const grant of request.body.grants) {
				if (!entitled.has(grant.userId)) {
					throw invalid(
						`${grant.userId} has no access to this project`
					);
				}
			}

			const algorithm =
				request.body.algorithm ?? 'x25519-xchacha20poly1305';

			const written = await prisma.$transaction(
				request.body.grants.map((grant) => {
					const data = {
						algorithm,
						ephemeralPublicKey: fromBase64(
							grant.ephemeralPublicKey,
							'ephemeralPublicKey',
							64
						),
						nonce: fromBase64(grant.nonce, 'nonce', 32),
						wrappedKey: fromBase64(
							grant.wrappedKey,
							'wrappedKey',
							255
						),
						grantedById: access.userId,
					};
					return prisma.projectKey.upsert({
						where: {
							projectId_userId_keyId: {
								projectId,
								userId: grant.userId,
								keyId,
							},
						},
						create: {
							projectId,
							userId: grant.userId,
							keyId,
							...data,
						},
						update: data,
					});
				})
			);

			// A new version replaces the old ones: whatever someone who may no
			// longer see the project still holds is thereby renewed and can go.
			// Not before — `stale-keys` needs these copies to know which
			// projects need renewing.
			if (existing === 0) {
				await prisma.projectKey.deleteMany({
					where: { projectId, userId: { notIn: [...entitled] } },
				});
			}

			return reply.status(201).send(written.map(projectKeyToApi));
		}
	);

	/// Takes the wrapped copy away from a user again. What they have read
	/// until then they still know — only a new version of the project key
	/// helps against that, and only the client can create it.
	fastify.delete<{ Params: ProjectParams & { userId: string } }>(
		'/api/workspaces/:organizationId/projects/:projectId/keys/:userId',
		async (request, reply) => {
			const { organizationId, projectId, userId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireProject(access, projectId, 'editor');

			await prisma.projectKey.deleteMany({
				where: { projectId, userId },
			});
			return reply.status(204).send();
		}
	);

	/// For which projects someone holds the current version of the key
	/// without being allowed to see them anymore — after removal from the
	/// workspace or from a team, exactly the projects whose key must be
	/// renewed. What they only hold in an older version has already been
	/// renewed; what they may still see they would get anew anyway.
	fastify.get<{ Params: OrgParams & { userId: string } }>(
		'/api/workspaces/:organizationId/members/:userId/stale-keys',
		async (request) => {
			const { organizationId, userId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);

			const held = await prisma.projectKey.findMany({
				where: { userId, project: { organizationId, deletedAt: null } },
				select: { projectId: true, keyId: true },
			});
			// No longer a member: then no team row counts that may have been
			// left behind on removal.
			const member = await prisma.member.findFirst({
				where: { organizationId, userId },
				select: { userId: true },
			});

			const projectIds: string[] = [];
			for (const projectId of new Set(held.map((key) => key.projectId))) {
				const current = await prisma.projectKey.findFirst({
					where: { projectId },
					orderBy: { createdAt: 'desc' },
					select: { keyId: true },
				});
				const holdsCurrent = held.some(
					(key) =>
						key.projectId === projectId &&
						key.keyId === current?.keyId
				);
				if (!holdsCurrent) continue;
				if (
					member &&
					(await entitledUsers(organizationId, projectId)).has(userId)
				) {
					continue;
				}
				projectIds.push(projectId);
			}
			return { projectIds };
		}
	);
};

/// Who may see this project: owner and admin of the organization, plus the
/// members of the teams it is shared with — and everyone, if it is shared with
/// the whole organization.
async function entitledUsers(
	organizationId: string,
	projectId: string
): Promise<Set<string>> {
	const admins = await prisma.member.findMany({
		where: { organizationId, role: { in: ['owner', 'admin'] } },
		select: { userId: true },
	});
	const entitled = new Set(admins.map((member) => member.userId));

	const shares = await prisma.projectShare.findMany({
		where: { projectId },
		select: { teamId: true },
	});

	if (shares.some((share) => share.teamId === null)) {
		const members = await prisma.member.findMany({
			where: { organizationId },
			select: { userId: true },
		});
		members.forEach((member) => entitled.add(member.userId));
		return entitled;
	}

	const teamIds = shares
		.map((share) => share.teamId)
		.filter((id): id is string => id !== null);
	if (teamIds.length > 0) {
		const members = await prisma.teamMember.findMany({
			where: { teamId: { in: teamIds } },
			select: { userId: true },
		});
		members.forEach((member) => entitled.add(member.userId));
	}

	return entitled;
}
