import { beforeEach, describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs, loginWithApiKey, API_KEY, USER_ID } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const url = `/api/workspaces/${ORGANIZATION}/sync`;

function emptyTree() {
	prismaMock.organization.findUnique.mockResolvedValue({
		id: ORGANIZATION,
		name: 'WireCore',
		slug: 'wirecore',
		revision: 42n,
	});
	for (const model of [
		prismaMock.project,
		prismaMock.connection,
		prismaMock.secret,
		prismaMock.vaultAccount,
		prismaMock.knownHostKey,
		prismaMock.snippet,
		prismaMock.projectKey,
		prismaMock.projectShare,
		prismaMock.team,
	]) {
		model.findMany.mockResolvedValue([]);
	}
}

describe('sync', () => {
	beforeEach(() => emptyTree());

	test('there is nothing without signing in', async () => {
		const response = await call('GET', url);
		expect(response.statusCode).toBe(401);
	});

	test('an API key works too — the desktop client has no cookies', async () => {
		loginWithApiKey(USER_ID);
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });

		const response = await call('GET', url, {
			headers: { 'x-api-key': API_KEY },
		});

		expect(response.statusCode).toBe(200);
	});

	test('a non-member gets 404 instead of 403', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue(null);

		const response = await call('GET', url);

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('W-NF');
	});

	test('the revision comes as a string — BIGINT does not fit into JSON', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });

		const response = await call('GET', url);

		expect(response.statusCode).toBe(200);
		expect(response.json().revision).toBe('42');
		expect(response.json().workspace.role).toBe('owner');
	});

	test('`since` filters all lists that are a delta', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });

		await call('GET', url, { query: { since: '17' } });

		expect(
			prismaMock.project.findMany.mock.calls[0][0].where
		).toMatchObject({ revision: { gt: 17n } });
		expect(
			prismaMock.connection.findMany.mock.calls[0][0].where
		).toMatchObject({ revision: { gt: 17n } });
	});

	test('a connection via the SSH agent comes back without a secret', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.connection.findMany.mockResolvedValue([
			{
				id: 'conn-1',
				projectId: 'project-1',
				name: 'web01',
				type: 'ssh',
				bookmarked: false,
				position: 0,
				systemId: null,
				revision: 3n,
				deletedAt: null,
				ssh: {
					connectionId: 'conn-1',
					host: 'web01.example.com',
					port: 22,
					user: 'root',
					authSource: 'agent',
					keyFilePath: null,
					vaultProvider: null,
					vaultReference: null,
					startPath: '',
				},
				ftp: null,
				s3: null,
			},
		]);

		const response = await call('GET', url);

		expect(response.statusCode).toBe(200);
		expect(response.json().connections[0].ssh).toEqual({
			host: 'web01.example.com',
			port: 22,
			user: 'root',
			authSource: 'agent',
			keyFilePath: null,
			vaultProvider: null,
			vaultReference: null,
			startPath: '',
		});
		expect(response.json().secrets).toEqual([]);
	});

	test('the snippets come along with the projects one sees, filtered by `since`', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: 'project-1', role: 'viewer' },
		]);
		prismaMock.snippet.findMany.mockResolvedValue([
			{
				id: 'snippet-1',
				projectId: 'project-1',
				connectionId: 'conn-1',
				locked: true,
				name: 'Logs',
				folder: 'Maintenance',
				command: 'tail -f /var/log/syslog',
				position: 0,
				revision: 7n,
				deletedAt: null,
			},
		]);

		const response = await call('GET', url, { query: { since: '5' } });

		expect(prismaMock.snippet.findMany.mock.calls[0][0].where).toEqual({
			revision: { gt: 5n },
			project: {
				organizationId: ORGANIZATION,
				id: { in: ['project-1'] },
			},
		});
		expect(response.json().snippets).toEqual([
			{
				id: 'snippet-1',
				projectId: 'project-1',
				connectionId: 'conn-1',
				locked: true,
				name: 'Logs',
				folder: 'Maintenance',
				command: 'tail -f /var/log/syslog',
				position: 0,
				revision: '7',
				deletedAt: null,
			},
		]);
	});

	test('the project keys always come in full, never filtered by `since`', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });

		await call('GET', url, { query: { since: '17' } });

		const where = prismaMock.projectKey.findMany.mock.calls[0][0].where;
		expect(where).toEqual({
			userId: USER_ID,
			project: { organizationId: ORGANIZATION },
		});
		// The last key version per project is the current one — so ordered by age.
		expect(prismaMock.projectKey.findMany.mock.calls[0][0].orderBy).toEqual(
			{ createdAt: 'asc' }
		);
	});

	test('for a member only the projects shared with them are queried', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: 'project-1', role: 'editor' },
		]);

		await call('GET', url);

		// The first query asks for the projects the member created.
		expect(
			prismaMock.project.findMany.mock.calls[1][0].where
		).toMatchObject({
			organizationId: ORGANIZATION,
			id: { in: ['project-1'] },
		});
	});

	test('names the teams a project can be shared with, and whether members create projects', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.organization.findUnique.mockResolvedValue({
			id: ORGANIZATION,
			name: 'WireCore',
			slug: 'wirecore',
			revision: 42n,
			memberProjects: true,
		});
		prismaMock.team.findMany.mockResolvedValue([
			{ id: 'team-1', name: 'Ops' },
		]);

		const body = (
			await call('GET', url, { query: { since: '40' } })
		).json();

		expect(body.teams).toEqual([{ id: 'team-1', name: 'Ops' }]);
		expect(body.workspace.memberProjects).toBe(true);
		expect(prismaMock.team.findMany.mock.calls[0][0].where).toEqual({
			organizationId: ORGANIZATION,
		});
	});

	test.each([
		['before', '30', 0n],
		['after', '40', 40n],
	])(
		'a `since` from %s the last change of access asks from %s on',
		async (_, since, from) => {
			loginAs();
			// Someone joined a team at revision 35: what they see now is older
			// than their `since`.
			prismaMock.member.findFirst.mockResolvedValue({
				role: 'member',
				accessRevision: 35n,
			});
			prismaMock.teamMember.findMany.mockResolvedValue([
				{ teamId: 'team-1' },
			]);
			prismaMock.projectShare.findMany.mockResolvedValue([
				{ projectId: 'project-1', role: 'editor' },
			]);

			await call('GET', url, { query: { since } });

			expect(
				prismaMock.connection.findMany.mock.calls[0][0].where.revision
			).toEqual({ gt: from });
		}
	);

	test('a `since` that is not a number is rejected', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });

		const response = await call('GET', url, {
			query: { since: '17; DROP TABLE' },
		});

		expect(response.statusCode).toBe(400);
	});
});

describe('the list of workspaces', () => {
	test('says which one is the personal one', async () => {
		loginAs();
		prismaMock.member.findMany.mockResolvedValue([
			{
				role: 'owner',
				organization: {
					id: 'organization-0',
					name: 'Personal',
					slug: 'personal-user-1',
					metadata: '{"kind":"personal"}',
					revision: 3n,
					memberProjects: false,
				},
			},
			{
				role: 'member',
				organization: {
					id: ORGANIZATION,
					name: 'WireCore',
					slug: 'wirecore',
					metadata: null,
					revision: 7n,
					memberProjects: true,
				},
			},
		]);

		const response = await call('GET', '/api/workspaces');

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([
			{
				id: 'organization-0',
				name: 'Personal',
				slug: 'personal-user-1',
				kind: 'personal',
				role: 'owner',
				memberProjects: false,
				revision: '3',
				wirecloudCompany: null,
			},
			{
				id: ORGANIZATION,
				name: 'WireCore',
				slug: 'wirecore',
				kind: 'organization',
				role: 'member',
				memberProjects: true,
				revision: '7',
				wirecloudCompany: null,
			},
		]);
	});

	test('it is not available without signing in', async () => {
		const response = await call('GET', '/api/workspaces');
		expect(response.statusCode).toBe(401);
	});
});

describe('the settings of a workspace', () => {
	const settings = `/api/workspaces/${ORGANIZATION}`;

	test('an admin lets members create projects', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'admin' });
		prismaMock.organization.update.mockResolvedValue({
			memberProjects: true,
		});

		const response = await call('PATCH', settings, {
			payload: { memberProjects: true },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ memberProjects: true });
		expect(prismaMock.organization.update.mock.calls[0][0]).toMatchObject({
			where: { id: ORGANIZATION },
			data: { memberProjects: true },
		});
	});

	test('a member does not', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);

		const response = await call('PATCH', settings, {
			payload: { memberProjects: true },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.organization.update).not.toHaveBeenCalled();
	});

	test('nothing else can be changed here — the name stays with better-auth', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.organization.update.mockResolvedValue({
			memberProjects: false,
		});

		await call('PATCH', settings, {
			payload: { memberProjects: false, name: 'Other' },
		});

		expect(prismaMock.organization.update.mock.calls[0][0].data).toEqual({
			memberProjects: false,
		});
	});
});
