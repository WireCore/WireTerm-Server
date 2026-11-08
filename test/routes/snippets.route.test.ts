import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const SNIPPET = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const list = `/api/workspaces/${ORGANIZATION}/snippets`;
const single = `${list}/${SNIPPET}`;

function as(role: 'owner' | 'member') {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({ role });
	prismaMock.teamMember.findMany.mockResolvedValue([]);
	prismaMock.projectShare.findMany.mockResolvedValue([]);
	prismaMock.organization.update.mockResolvedValue({ revision: 9n });
}

const stored = {
	id: SNIPPET,
	organizationId: ORGANIZATION,
	name: 'Logs',
	folder: '',
	command: 'tail -f /var/log/syslog',
	position: 0,
	revision: 4n,
	deletedAt: null,
};

describe('snippets', () => {
	test("an owner creates one, with the workspace's revision", async () => {
		as('owner');
		prismaMock.snippet.findUnique.mockResolvedValue(null);
		prismaMock.snippet.create.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => ({
				...data,
				deletedAt: null,
			})
		);

		const response = await call('POST', list, {
			payload: {
				id: SNIPPET,
				name: 'Disk space',
				folder: 'Maintenance/Linux',
				command: 'df -h {{connection.host}}',
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			id: SNIPPET,
			folder: 'Maintenance/Linux',
			position: 0,
			revision: '9',
		});
	});

	test("a member may not create any — startup commands run in other people's terminals", async () => {
		as('member');

		const response = await call('POST', list, {
			payload: { id: SNIPPET, name: 'x', command: 'rm -rf ~' },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.snippet.create).not.toHaveBeenCalled();
	});

	test('the ID must be a UUID', async () => {
		as('owner');

		const response = await call('POST', list, {
			payload: { id: 'logs', name: 'x', command: 'ls' },
		});

		expect(response.statusCode).toBe(400);
	});

	test('an ID that already exists overwrites nothing', async () => {
		as('owner');
		prismaMock.snippet.findUnique.mockResolvedValue(stored);

		const response = await call('POST', list, {
			payload: { id: SNIPPET, name: 'x', command: 'ls' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('SN-EX');
	});

	test('updating checks the revision', async () => {
		as('owner');
		prismaMock.snippet.findFirst.mockResolvedValue(stored);

		const response = await call('PATCH', single, {
			payload: { command: 'journalctl -f', expectedRevision: '3' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('R-CF');
		expect(prismaMock.snippet.update).not.toHaveBeenCalled();
	});

	test('updating only takes what is sent', async () => {
		as('owner');
		prismaMock.snippet.findFirst.mockResolvedValue(stored);
		prismaMock.snippet.update.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => ({
				...stored,
				...data,
			})
		);

		const response = await call('PATCH', single, {
			payload: { command: 'journalctl -f', expectedRevision: '4' },
		});

		expect(response.statusCode).toBe(200);
		const data = prismaMock.snippet.update.mock.calls[0][0].data;
		expect(data).toEqual({ command: 'journalctl -f', revision: 9n });
	});

	test('deleting sets a tombstone', async () => {
		as('owner');
		prismaMock.snippet.findFirst.mockResolvedValue(stored);

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(204);
		const data = prismaMock.snippet.update.mock.calls[0][0].data;
		expect(data.deletedAt).toBeInstanceOf(Date);
		expect(data.revision).toBe(9n);
	});

	test('a snippet from another workspace does not exist here', async () => {
		as('owner');
		prismaMock.snippet.findFirst.mockResolvedValue(null);

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('SN-NF');
	});
});
