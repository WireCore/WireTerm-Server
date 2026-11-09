import type { PrismaClient } from 'generated/prisma/client';
import { ErrorCodes } from 'utils/ErrorCodes';
import { forbidden, notFound } from 'utils/http';

/// The roles of the organization plugin.
export type WorkspaceRole = 'owner' | 'admin' | 'member';
/// The role a share grants.
export type ProjectRole = 'editor' | 'viewer';

export type WorkspaceAccess = {
	organizationId: string;
	userId: string;
	role: WorkspaceRole;
	/// `owner` and `admin` get at every project of the organization without a
	/// share being needed. For `member`, `projectRoles` holds what was shared
	/// via a team or with the whole organization.
	///
	/// This applies to *visibility*. Even an owner only gets at the secrets
	/// if someone has wrapped the project key for them — the server cannot do
	/// that, see `ProjectKey` in the schema.
	everyProject: boolean;
	projectRoles: Map<string, ProjectRole>;
};

/// Throws if the user has no business in this organization.
export async function workspaceAccess(
	prisma: PrismaClient,
	userId: string,
	organizationId: string
): Promise<WorkspaceAccess> {
	const member = await prisma.member.findFirst({
		where: { userId, organizationId },
		select: { role: true },
	});
	if (!member) throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND);

	const role = (member.role as WorkspaceRole) ?? 'member';
	if (role === 'owner' || role === 'admin') {
		return {
			organizationId,
			userId,
			role,
			everyProject: true,
			projectRoles: new Map(),
		};
	}

	const teams = await prisma.teamMember.findMany({
		where: { userId, team: { organizationId } },
		select: { teamId: true },
	});
	const teamIds = teams.map((team) => team.teamId);

	const shares = await prisma.projectShare.findMany({
		where: {
			// Without `deletedAt: null`: a deleted project has to stay visible,
			// otherwise a client that has been offline since the deletion never
			// learns of it — the tombstone would never reach it.
			project: { organizationId },
			// `teamId: null` is the share with the whole organization.
			OR: [{ teamId: null }, { teamId: { in: teamIds } }],
		},
		select: { projectId: true, role: true },
	});

	const projectRoles = new Map<string, ProjectRole>();
	for (const share of shares) {
		// Two shares on the same project: the more generous one wins.
		if (share.role === 'editor' || !projectRoles.has(share.projectId)) {
			projectRoles.set(share.projectId, share.role);
		}
	}

	return { organizationId, userId, role, everyProject: false, projectRoles };
}

/// Only owner and admin create projects, delete them, and manage shares and
/// the workspace's vault accounts. Who may edit a project is stated in the
/// share.
export function requireWorkspaceAdmin(access: WorkspaceAccess) {
	if (!isWorkspaceAdmin(access)) throw forbidden();
}

export function isWorkspaceAdmin(access: WorkspaceAccess): boolean {
	return access.role === 'owner' || access.role === 'admin';
}

export function projectRole(
	access: WorkspaceAccess,
	projectId: string
): ProjectRole | undefined {
	if (access.everyProject) return 'editor';
	return access.projectRoles.get(projectId);
}

export function requireProject(
	access: WorkspaceAccess,
	projectId: string,
	needed: ProjectRole
) {
	const role = projectRole(access, projectId);
	if (!role) throw notFound(ErrorCodes.PROJECT_NOT_FOUND);
	if (needed === 'editor' && role !== 'editor') throw forbidden();
}

/// What restricts a query to what the user may see. `undefined` means: no
/// restriction needed.
export function visibleProjectFilter(
	access: WorkspaceAccess
): { in: string[] } | undefined {
	if (access.everyProject) return undefined;
	return { in: [...access.projectRoles.keys()] };
}
