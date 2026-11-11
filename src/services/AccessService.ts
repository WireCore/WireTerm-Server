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
	/// via a team or with the whole organization, plus the projects they
	/// created themselves.
	///
	/// This applies to *visibility*. Even an owner only gets at the secrets
	/// if someone has wrapped the project key for them — the server cannot do
	/// that, see `ProjectKey` in the schema.
	everyProject: boolean;
	projectRoles: Map<string, ProjectRole>;
	/// The projects this member created. They manage them like an admin:
	/// rename, share, delete.
	ownProjects: Set<string>;
	/// See `Member.accessRevision`.
	accessRevision: bigint;
};

/// Throws if the user has no business in this organization.
export async function workspaceAccess(
	prisma: PrismaClient,
	userId: string,
	organizationId: string
): Promise<WorkspaceAccess> {
	const member = await prisma.member.findFirst({
		where: { userId, organizationId },
		select: { role: true, accessRevision: true },
	});
	if (!member) throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND);

	const role = (member.role as WorkspaceRole) ?? 'member';
	const accessRevision = member.accessRevision;
	if (role === 'owner' || role === 'admin') {
		return {
			organizationId,
			userId,
			role,
			everyProject: true,
			projectRoles: new Map(),
			ownProjects: new Set(),
			accessRevision,
		};
	}

	const teams = await prisma.teamMember.findMany({
		where: { userId, team: { organizationId } },
		select: { teamId: true },
	});
	const teamIds = teams.map((team) => team.teamId);

	const [shares, created] = await Promise.all([
		prisma.projectShare.findMany({
			where: {
				// Without `deletedAt: null`: a deleted project has to stay
				// visible, otherwise a client that has been offline since the
				// deletion never learns of it — the tombstone would never reach
				// it.
				project: { organizationId },
				// `teamId: null` is the share with the whole organization.
				OR: [{ teamId: null }, { teamId: { in: teamIds } }],
			},
			select: { projectId: true, role: true },
		}),
		// The same goes for the tombstone of a project of one's own.
		prisma.project.findMany({
			where: { organizationId, createdById: userId },
			select: { id: true },
		}),
	]);

	const projectRoles = new Map<string, ProjectRole>();
	for (const share of shares) {
		// Two shares on the same project: the more generous one wins.
		if (share.role === 'editor' || !projectRoles.has(share.projectId)) {
			projectRoles.set(share.projectId, share.role);
		}
	}
	const ownProjects = new Set(created.map((project) => project.id));
	for (const projectId of ownProjects) projectRoles.set(projectId, 'editor');

	return {
		organizationId,
		userId,
		role,
		everyProject: false,
		projectRoles,
		ownProjects,
		accessRevision,
	};
}

/// Only owner and admin manage the workspace itself: its vault accounts, its
/// settings, and the projects of others. Who may edit a project is stated in
/// the share.
export function requireWorkspaceAdmin(access: WorkspaceAccess) {
	if (!isWorkspaceAdmin(access)) throw forbidden();
}

export function isWorkspaceAdmin(access: WorkspaceAccess): boolean {
	return access.role === 'owner' || access.role === 'admin';
}

/// Owner and admin create projects; members only if the workspace allows it
/// (`organization.memberProjects`).
export function requireProjectCreator(
	access: WorkspaceAccess,
	memberProjects: boolean
) {
	if (!isWorkspaceAdmin(access) && !memberProjects) throw forbidden();
}

/// Renaming, sharing and deleting a project: owner and admin, and whoever
/// created it. Someone who does not even see the project gets 404, like
/// everywhere else.
export function requireProjectManager(
	access: WorkspaceAccess,
	projectId: string
) {
	if (isWorkspaceAdmin(access)) return;
	if (!projectRole(access, projectId)) {
		throw notFound(ErrorCodes.PROJECT_NOT_FOUND);
	}
	if (!access.ownProjects.has(projectId)) throw forbidden();
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
