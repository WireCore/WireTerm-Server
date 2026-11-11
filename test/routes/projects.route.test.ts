import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs, USER_ID } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const PROJECT = '0e9b2d4c-6a1f-4c3e-8b7d-5f2a9c1e3d60';
const url = `/api/workspaces/${ORGANIZATION}/projects`;

function owner() {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
	prismaMock.organization.update.mockResolvedValue({ revision: 5n });
	prismaMock.project.findUnique.mockResolvedValue(null);
	prismaMock.project.create.mockImplementation(
		async ({ data }: { data: Record<string, unknown> }) => data
	);
}

describe('creating a project', () => {
	test('with a UUID as its ID', async () => {
		owner();

		const response = await call('POST', url, {
			payload: { id: PROJECT, name: 'Production' },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().id).toBe(PROJECT);
	});

	test.each(['production', PROJECT.toUpperCase()])(
		'an ID that is not a UUID (%s) is rejected',
		async (id) => {
			owner();

			const response = await call('POST', url, {
				payload: { id, name: 'Production' },
			});

			expect(response.statusCode).toBe(400);
			expect(prismaMock.project.findUnique).not.toHaveBeenCalled();
		}
	);
});

describe('a project of a member', () => {
	function member(memberProjects: boolean) {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);
		prismaMock.organization.findUnique.mockResolvedValue({
			memberProjects,
		});
		prismaMock.organization.update.mockResolvedValue({ revision: 5n });
		prismaMock.project.findUnique.mockResolvedValue(null);
		prismaMock.project.create.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => data
		);
	}

	test('is only created where the workspace allows it', async () => {
		member(false);
		const refused = await call('POST', url, {
			payload: { id: PROJECT, name: 'Mine' },
		});
		expect(refused.statusCode).toBe(403);

		member(true);
		const created = await call('POST', url, {
			payload: { id: PROJECT, name: 'Mine' },
		});
		expect(created.statusCode).toBe(201);
		expect(
			prismaMock.project.create.mock.calls[0][0].data.createdById
		).toBe(USER_ID);
	});

	test('is deleted by whoever created it', async () => {
		member(true);
		prismaMock.project.findMany.mockImplementation(async ({ where }) =>
			where.createdById === USER_ID ? [{ id: PROJECT }] : []
		);
		prismaMock.project.findFirst.mockResolvedValue({
			id: PROJECT,
			organizationId: ORGANIZATION,
			deletedAt: null,
		});

		const response = await call('DELETE', `${url}/${PROJECT}`);

		expect(response.statusCode).toBe(204);
	});

	test('but not by an editor it was shared with', async () => {
		member(true);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: PROJECT, role: 'editor' },
		]);

		const response = await call('DELETE', `${url}/${PROJECT}`);

		expect(response.statusCode).toBe(403);
		expect(prismaMock.project.update).not.toHaveBeenCalled();
	});
});

describe('deleting a project', () => {
	test('its snippets get tombstones along with it', async () => {
		owner();
		prismaMock.project.findFirst.mockResolvedValue({
			id: PROJECT,
			organizationId: ORGANIZATION,
			deletedAt: null,
		});

		const response = await call('DELETE', `${url}/${PROJECT}`);

		expect(response.statusCode).toBe(204);
		const tombstones = prismaMock.snippet.updateMany.mock.calls[0][0];
		expect(tombstones.where).toEqual({
			projectId: PROJECT,
			deletedAt: null,
		});
		expect(tombstones.data.deletedAt).toBeInstanceOf(Date);
		expect(tombstones.data.revision).toBe(5n);
	});
});
