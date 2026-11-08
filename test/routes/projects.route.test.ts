import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs } from '../helpers/auth';
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
