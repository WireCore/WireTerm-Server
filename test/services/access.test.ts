import { describe, expect, test } from 'vitest';
import { prismaMock } from '../helpers/prisma';
import {
	projectRole,
	requireProject,
	requireWorkspaceAdmin,
	visibleProjectFilter,
	workspaceAccess,
} from '../../src/services/AccessService';
import { ErrorCodes } from '../../src/utils/ErrorCodes';
import { HttpError } from '../../src/utils/http';

const prisma = prismaMock as never;
const ORGANIZATION = 'organization-1';

describe('access to a workspace', () => {
	test('a non-member does not find the workspace', async () => {
		prismaMock.member.findFirst.mockResolvedValue(null);

		const failure = await workspaceAccess(
			prisma,
			'stranger',
			ORGANIZATION
		).catch((error) => error);

		expect(failure).toBeInstanceOf(HttpError);
		expect(failure.status).toBe(404);
		expect(failure.code).toBe(ErrorCodes.WORKSPACE_NOT_FOUND);
	});

	test('owner reaches every project without needing a share', async () => {
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });

		const access = await workspaceAccess(prisma, 'user-1', ORGANIZATION);

		expect(access.everyProject).toBe(true);
		expect(projectRole(access, 'any-project')).toBe('editor');
		expect(visibleProjectFilter(access)).toBeUndefined();
		// For owner and admin, teams are not even queried.
		expect(prismaMock.teamMember.findMany).not.toHaveBeenCalled();
	});

	test('a member only sees what is shared with one of their teams', async () => {
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: 'project-1', role: 'viewer' },
		]);

		const access = await workspaceAccess(prisma, 'user-2', ORGANIZATION);

		expect(access.everyProject).toBe(false);
		expect(projectRole(access, 'project-1')).toBe('viewer');
		expect(projectRole(access, 'project-2')).toBeUndefined();
		expect(visibleProjectFilter(access)).toEqual({ in: ['project-1'] });

		// The query includes the share with the whole organization.
		const where = prismaMock.projectShare.findMany.mock.calls[0][0].where;
		expect(where.OR).toEqual([
			{ teamId: null },
			{ teamId: { in: ['team-1'] } },
		]);
	});

	test('two shares of the same project: the more generous one applies', async () => {
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
			{ teamId: 'team-2' },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: 'project-1', role: 'viewer' },
			{ projectId: 'project-1', role: 'editor' },
		]);

		const access = await workspaceAccess(prisma, 'user-2', ORGANIZATION);

		expect(projectRole(access, 'project-1')).toBe('editor');
	});

	test('a deleted project stays visible, otherwise the tombstone never arrives', async () => {
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);

		await workspaceAccess(prisma, 'user-2', ORGANIZATION);

		const where = prismaMock.projectShare.findMany.mock.calls[0][0].where;
		expect(where.project).toEqual({ organizationId: ORGANIZATION });
	});
});

describe('permissions on a project', () => {
	const viewer = {
		organizationId: ORGANIZATION,
		userId: 'user-2',
		role: 'member' as const,
		everyProject: false,
		projectRoles: new Map([['project-1', 'viewer' as const]]),
	};

	test('a viewer may not write', () => {
		expect(() =>
			requireProject(viewer, 'project-1', 'viewer')
		).not.toThrow();

		const failure = (() => {
			try {
				requireProject(viewer, 'project-1', 'editor');
			} catch (error) {
				return error as HttpError;
			}
		})();

		expect(failure?.status).toBe(403);
	});

	test('a project without a share does not exist for this member', () => {
		const failure = (() => {
			try {
				requireProject(viewer, 'project-9', 'viewer');
			} catch (error) {
				return error as HttpError;
			}
		})();

		// 404 instead of 403: that the project exists is itself information.
		expect(failure?.status).toBe(404);
		expect(failure?.code).toBe(ErrorCodes.PROJECT_NOT_FOUND);
	});

	test('only owner and admin manage the workspace', () => {
		expect(() => requireWorkspaceAdmin(viewer)).toThrow();
		expect(() =>
			requireWorkspaceAdmin({ ...viewer, role: 'admin' })
		).not.toThrow();
	});
});
