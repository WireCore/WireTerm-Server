import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs, OTHER_USER_ID, USER_ID } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const PROJECT = 'project-1';
const url = `/api/workspaces/${ORGANIZATION}/projects/${PROJECT}/shares`;

function adminOfLivingProject() {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({ role: 'admin' });
	prismaMock.project.findFirst.mockResolvedValue({
		id: PROJECT,
		organizationId: ORGANIZATION,
		deletedAt: null,
	});
	prismaMock.organization.update.mockResolvedValue({ revision: 12n });
}

describe('shares of a project', () => {
	test('a plain member does not manage them', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);

		const response = await call('PUT', url, {
			payload: { shares: [{ teamId: 'team-1', role: 'editor' }] },
		});

		expect(response.statusCode).toBe(403);
	});

	test('a team from a foreign organization does not count', async () => {
		adminOfLivingProject();
		prismaMock.team.count.mockResolvedValue(0);

		const response = await call('PUT', url, {
			payload: { shares: [{ teamId: 'foreign-team', role: 'editor' }] },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('T-NF');
		expect(prismaMock.projectShare.deleteMany).not.toHaveBeenCalled();
	});

	test('whoever loses the share also loses the wrapped copy of the key', async () => {
		adminOfLivingProject();
		prismaMock.team.count.mockResolvedValue(1);
		// After the write only team-1 is left in the list …
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
		]);
		// … whose only member is USER_ID.
		prismaMock.member.findMany.mockResolvedValue([{ userId: 'admin-1' }]);
		prismaMock.teamMember.findMany.mockResolvedValue([{ userId: USER_ID }]);

		const response = await call('PUT', url, {
			payload: { shares: [{ teamId: 'team-1', role: 'editor' }] },
		});

		expect(response.statusCode).toBe(200);
		const where = prismaMock.projectKey.deleteMany.mock.calls[0][0].where;
		expect(where.projectId).toBe(PROJECT);
		// Administrators keep their copy, OTHER_USER_ID does not.
		expect(where.userId.notIn).toEqual(
			expect.arrayContaining(['admin-1', USER_ID])
		);
		expect(where.userId.notIn).not.toContain(OTHER_USER_ID);
	});

	test('the same team twice is an error, not a silent merge', async () => {
		adminOfLivingProject();

		const response = await call('PUT', url, {
			payload: {
				shares: [
					{ teamId: 'team-1', role: 'editor' },
					{ teamId: 'team-1', role: 'viewer' },
				],
			},
		});

		expect(response.statusCode).toBe(400);
	});
});
