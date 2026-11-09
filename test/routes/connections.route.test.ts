import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs } from '../helpers/auth';
import { Prisma } from '../../src/generated/prisma/client';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const PROJECT = 'project-1';
const CONNECTION = '7d3f1c2a-5b8e-4f60-9a1d-2c4b6e8f0a13';
const create = `/api/workspaces/${ORGANIZATION}/projects/${PROJECT}/connections`;
const single = `/api/workspaces/${ORGANIZATION}/connections/conn-1`;

function ownerWithLivingProject() {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
	prismaMock.project.findFirst.mockResolvedValue({
		id: PROJECT,
		organizationId: ORGANIZATION,
		deletedAt: null,
	});
	prismaMock.organization.update.mockResolvedValue({ revision: 5n });
}

function connectionCreates() {
	prismaMock.connection.findUnique.mockResolvedValue(null);
	prismaMock.connection.create.mockImplementation(
		async ({ data }: { data: Record<string, unknown> }) => ({
			...data,
			systemId: null,
			deletedAt: null,
			ssh: data.ssh
				? {
						connectionId: data.id,
						...(data.ssh as { create: object }).create,
					}
				: null,
			ftp: null,
			s3: null,
		})
	);
}

describe('creating a connection', () => {
	test('the defaults come from the form, not from chance', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: {
					host: 'web01.example.com',
					user: 'root',
					authSource: 'inlineKey',
				},
			},
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		// Without values: port 22, not bookmarked, at the top.
		expect(written.ssh.create.port).toBe(22);
		expect(written.bookmarked).toBe(false);
		expect(written.position).toBe(0);
		expect(written.revision).toBe(5n);
	});

	test('a port beyond 65535 does not get through', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: {
					host: 'a',
					port: 70000,
					user: 'root',
					authSource: 'inlineKey',
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(prismaMock.connection.create).not.toHaveBeenCalled();
	});

	test('neither does an authentication source that does not exist', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: { host: 'a', user: 'root', authSource: 'telepathy' },
			},
		});

		expect(response.statusCode).toBe(400);
	});

	test.each(['password', 'vaultPassword', 'prompt'])(
		'SSH with a password (%s) gets through',
		async (authSource) => {
			ownerWithLivingProject();
			connectionCreates();

			const response = await call('POST', create, {
				payload: {
					id: CONNECTION,
					name: 'storagebox',
					type: 'ssh',
					ssh: { host: 'a', port: 23, user: 'u1', authSource },
				},
			});

			expect(response.statusCode).toBe(201);
			const written = prismaMock.connection.create.mock.calls[0][0].data;
			expect(written.ssh.create.authSource).toBe(authSource);
		}
	);

	test('SSH via the agent gets through without key path and vault', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: { host: 'a', port: 22, user: 'root', authSource: 'agent' },
			},
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create).toMatchObject({
			authSource: 'agent',
			keyFilePath: null,
			vaultProvider: null,
			vaultReference: null,
		});
		expect(response.json().ssh.authSource).toBe('agent');
	});

	test('via a jump host and with agent forwarding', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'internal',
				type: 'ssh',
				ssh: {
					host: '10.0.0.5',
					user: 'root',
					authSource: 'agent',
					jumpConnectionId: 'conn-1',
					agentForwarding: true,
				},
			},
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create).toMatchObject({
			jumpConnectionId: 'conn-1',
			agentForwarding: true,
		});
	});

	test('port forwards are sent along as a list', async () => {
		ownerWithLivingProject();
		connectionCreates();
		const forwards = [
			{
				kind: 'local',
				bindPort: 8080,
				targetHost: 'db',
				targetPort: 5432,
			},
			{ kind: 'dynamic', bindHost: '127.0.0.1', bindPort: 1080 },
		];

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'with tunnels',
				type: 'ssh',
				ssh: { host: 'a', user: 'root', authSource: 'agent', forwards },
			},
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create.forwards).toEqual(forwards);
	});

	test('a forward of an unknown kind does not get through', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'broken',
				type: 'ssh',
				ssh: {
					host: 'a',
					user: 'root',
					authSource: 'agent',
					forwards: [{ kind: 'udp', bindPort: 53 }],
				},
			},
		});

		expect(response.statusCode).toBe(400);
	});

	test('a custom proxy is sent along, for every type', async () => {
		ownerWithLivingProject();
		connectionCreates();
		const proxy = { mode: 'custom', kind: 'socks5', host: 'p', port: 1080 };

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: { host: 'a', user: 'root', authSource: 'agent', proxy },
			},
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create.proxy).toEqual(proxy);
	});

	test('proxy credentials do not end up on the server', async () => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 's3',
				s3: {
					host: 'a',
					user: 'AKIA',
					authSource: 'prompt',
					proxy: {
						mode: 'custom',
						kind: 'http',
						host: 'p',
						port: 3128,
						user: 'anna',
						password: 'secret',
					},
				},
			},
		});

		// Fastify strips what the schema does not know.
		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.s3.create.proxy).toEqual({
			mode: 'custom',
			kind: 'http',
			host: 'p',
			port: 3128,
		});
	});

	test('a startup command is sent along as the ID of a snippet', async () => {
		ownerWithLivingProject();
		connectionCreates();
		prismaMock.snippet.findFirst.mockResolvedValue({
			projectId: PROJECT,
			connectionId: null,
			locked: true,
		});

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: {
					host: 'a',
					user: 'root',
					authSource: 'agent',
					startupSnippetId: 'snippet-1',
				},
			},
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create.startupSnippetId).toBe('snippet-1');
	});

	test.each([
		[
			'an open snippet',
			{ projectId: PROJECT, connectionId: null, locked: false },
		],
		[
			'one of another project',
			{ projectId: 'project-2', connectionId: null, locked: true },
		],
		[
			'one for another connection',
			{ projectId: PROJECT, connectionId: 'conn-9', locked: true },
		],
		['a deleted or unknown one', null],
	])('%s is no startup command', async (_, snippet) => {
		ownerWithLivingProject();
		connectionCreates();
		prismaMock.snippet.findFirst.mockResolvedValue(snippet);

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: {
					host: 'a',
					user: 'root',
					authSource: 'agent',
					startupSnippetId: 'snippet-1',
				},
			},
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('SN-NS');
		expect(prismaMock.connection.create).not.toHaveBeenCalled();
	});

	test("without a proxy the device's proxy applies — the column holds NULL", async () => {
		ownerWithLivingProject();
		connectionCreates();

		await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: { host: 'a', user: 'root', authSource: 'agent' },
			},
		});

		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create.proxy).toBe(Prisma.DbNull);
	});

	test.each([
		{ mode: 'custom', kind: 'socks5', port: 1080 },
		{ mode: 'custom', kind: 'ftp', host: 'p', port: 1080 },
		{ mode: 'system' },
	])('a proxy like %j does not get through', async (proxy) => {
		ownerWithLivingProject();
		connectionCreates();

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ftp',
				ftp: { host: 'a', authSource: 'anonymous', proxy },
			},
		});

		expect(response.statusCode).toBe(400);
	});

	test('without values neither jump host nor agent', async () => {
		ownerWithLivingProject();
		connectionCreates();

		await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: { host: 'a', user: 'root', authSource: 'agent' },
			},
		});

		const written = prismaMock.connection.create.mock.calls[0][0].data;
		expect(written.ssh.create).toMatchObject({
			jumpConnectionId: null,
			agentForwarding: false,
			startupSnippetId: null,
		});
	});

	test.each(['prompt', 'agent'])(
		'a secret in the group of %s goes nowhere',
		async (authSource) => {
			ownerWithLivingProject();
			connectionCreates();

			const response = await call('POST', create, {
				payload: {
					id: CONNECTION,
					name: 'web01',
					type: 'ssh',
					ssh: {
						host: 'a',
						user: 'root',
						authSource,
						secret: 'secret',
					},
				},
			});

			// Fastify strips what the schema does not know.
			expect(response.statusCode).toBe(201);
			const written = prismaMock.connection.create.mock.calls[0][0].data;
			expect(written.ssh.create).not.toHaveProperty('secret');
			expect(prismaMock.secret.upsert).not.toHaveBeenCalled();
		}
	);

	test('an ID that already exists overwrites nothing', async () => {
		ownerWithLivingProject();
		prismaMock.connection.findUnique.mockResolvedValue({ id: 'conn-1' });

		const response = await call('POST', create, {
			payload: {
				id: CONNECTION,
				name: 'web01',
				type: 'ssh',
				ssh: { host: 'a', user: 'root', authSource: 'inlineKey' },
			},
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('C-EX');
	});

	test.each(['web01', '7D3F1C2A-5B8E-4F60-9A1D-2C4B6E8F0A13', ''])(
		'an ID that is not a UUID (%s) is rejected',
		async (id) => {
			ownerWithLivingProject();
			connectionCreates();

			const response = await call('POST', create, {
				payload: {
					id,
					name: 'web01',
					type: 'ssh',
					ssh: { host: 'a', user: 'root', authSource: 'agent' },
				},
			});

			expect(response.statusCode).toBe(400);
			expect(prismaMock.connection.findUnique).not.toHaveBeenCalled();
		}
	);
});

describe('updating a connection', () => {
	function existingConnection() {
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			type: 'ssh',
			revision: 4n,
			deletedAt: null,
		});
		prismaMock.organization.update.mockResolvedValue({ revision: 6n });
		prismaMock.connection.update.mockImplementation(
			async ({ data }: { data: Record<string, unknown> }) => ({
				id: 'conn-1',
				projectId: data.projectId ?? PROJECT,
				name: 'web01',
				type: 'ssh',
				bookmarked: false,
				position: 0,
				revision: 6n,
				deletedAt: null,
				ssh: null,
				ftp: null,
				s3: null,
			})
		);
	}

	test('a connection moves to another project', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.project.findFirst.mockResolvedValue({
			id: 'project-2',
			organizationId: ORGANIZATION,
			deletedAt: null,
		});
		existingConnection();

		const response = await call('PATCH', single, {
			payload: { projectId: 'project-2', position: 3 },
		});

		expect(response.statusCode).toBe(200);
		const data = prismaMock.connection.update.mock.calls[0][0].data;
		expect(data.projectId).toBe('project-2');
		expect(data.position).toBe(3);
		expect(response.json().projectId).toBe('project-2');
	});

	test("its own snippets go along, a startup command for the old project's connections stays behind", async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.project.findFirst.mockResolvedValue({
			id: 'project-2',
			organizationId: ORGANIZATION,
			deletedAt: null,
		});
		existingConnection();
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			type: 'ssh',
			revision: 4n,
			deletedAt: null,
			ssh: { startupSnippetId: 'snippet-1' },
		});
		prismaMock.snippet.findFirst.mockResolvedValue({
			projectId: PROJECT,
			connectionId: null,
			locked: true,
		});

		const response = await call('PATCH', single, {
			payload: { projectId: 'project-2' },
		});

		expect(response.statusCode).toBe(200);
		expect(prismaMock.snippet.updateMany).toHaveBeenCalledWith({
			where: { connectionId: 'conn-1' },
			data: { projectId: 'project-2', revision: 6n },
		});
		expect(prismaMock.sshConnection.updateMany).toHaveBeenCalledWith({
			where: { connectionId: 'conn-1' },
			data: { startupSnippetId: null },
		});
	});

	test('a new startup command that does not fit is refused', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		existingConnection();
		prismaMock.snippet.findFirst.mockResolvedValue({
			projectId: PROJECT,
			connectionId: null,
			locked: false,
		});

		const response = await call('PATCH', single, {
			payload: {
				ssh: {
					host: 'a',
					user: 'root',
					authSource: 'agent',
					startupSnippetId: 'snippet-1',
				},
			},
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('SN-NS');
		expect(prismaMock.connection.update).not.toHaveBeenCalled();
	});

	test('an unchanged startup command is not checked again', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		existingConnection();
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			type: 'ssh',
			revision: 4n,
			deletedAt: null,
			ssh: { startupSnippetId: 'snippet-1' },
		});

		const response = await call('PATCH', single, {
			payload: {
				ssh: {
					host: 'b',
					user: 'root',
					authSource: 'agent',
					startupSnippetId: 'snippet-1',
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(prismaMock.snippet.findFirst).not.toHaveBeenCalled();
	});

	test('nothing moves to a project without edit permission', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: PROJECT, role: 'editor' },
			{ projectId: 'project-2', role: 'viewer' },
		]);
		existingConnection();

		const response = await call('PATCH', single, {
			payload: { projectId: 'project-2' },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.connection.update).not.toHaveBeenCalled();
	});

	test('nor to a project of another workspace', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.project.findFirst.mockResolvedValue(null);
		existingConnection();

		const response = await call('PATCH', single, {
			payload: { projectId: 'foreign' },
		});

		expect(response.statusCode).toBe(404);
		expect(prismaMock.connection.update).not.toHaveBeenCalled();
	});

	test('a type change removes the old settings row', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.organization.update.mockResolvedValue({ revision: 6n });
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			type: 'ssh',
			revision: 4n,
			deletedAt: null,
		});
		prismaMock.connection.update.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			name: 'web01',
			type: 'ftp',
			bookmarked: false,
			position: 0,
			revision: 6n,
			deletedAt: null,
			ssh: null,
			ftp: { connectionId: 'conn-1', host: 'a' },
			s3: null,
		});

		const response = await call('PATCH', single, {
			payload: {
				type: 'ftp',
				ftp: { host: 'ftp.example.com', authSource: 'anonymous' },
			},
		});

		expect(response.statusCode).toBe(200);
		// If it stayed, the connection would deliver two sets of settings.
		expect(prismaMock.sshConnection.deleteMany).toHaveBeenCalledWith({
			where: { connectionId: 'conn-1' },
		});
		expect(prismaMock.ftpConnection.upsert).toHaveBeenCalled();
		// FTP without values: passive, explicit TLS, port 21.
		const data = prismaMock.ftpConnection.upsert.mock.calls[0][0].create;
		expect(data.passive).toBe(true);
		expect(data.security).toBe('explicit');
		expect(data.port).toBe(21);
	});

	test.each(['prompt', 'keyFile', 'agent'])(
		'a switch from inlineKey to %s leaves the secret to the client',
		async (authSource) => {
			loginAs();
			prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
			prismaMock.organization.update.mockResolvedValue({ revision: 6n });
			prismaMock.connection.findFirst.mockResolvedValue({
				id: 'conn-1',
				projectId: PROJECT,
				type: 'ssh',
				revision: 4n,
				deletedAt: null,
				ssh: { connectionId: 'conn-1', authSource: 'inlineKey' },
			});
			prismaMock.connection.update.mockResolvedValue({
				id: 'conn-1',
				projectId: PROJECT,
				name: 'web01',
				type: 'ssh',
				bookmarked: false,
				position: 0,
				revision: 6n,
				deletedAt: null,
				ssh: { connectionId: 'conn-1', host: 'a', authSource },
				ftp: null,
				s3: null,
			});

			const response = await call('PATCH', single, {
				payload: {
					ssh: { host: 'a', port: 22, user: 'root', authSource },
				},
			});

			expect(response.statusCode).toBe(200);
			const data =
				prismaMock.sshConnection.upsert.mock.calls[0][0].update;
			expect(data.authSource).toBe(authSource);
			// The ciphertext is removed via DELETE …/secret, the same for
			// every source — the server does not touch it here.
			expect(prismaMock.secret.update).not.toHaveBeenCalled();
			expect(prismaMock.secret.updateMany).not.toHaveBeenCalled();
			expect(prismaMock.secret.upsert).not.toHaveBeenCalled();
		}
	);

	test('a viewer changes nothing', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: PROJECT, role: 'viewer' },
		]);
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			type: 'ssh',
			revision: 4n,
			deletedAt: null,
		});

		const response = await call('PATCH', single, {
			payload: { name: 'renamed' },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.connection.update).not.toHaveBeenCalled();
	});

	test('a deleted connection no longer exists', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			deletedAt: new Date(),
		});

		const response = await call('PATCH', single, {
			payload: { name: 'renamed' },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('C-NF');
	});
});

describe('deleting a connection', () => {
	test('its snippets get tombstones along with it', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.connection.findFirst.mockResolvedValue({
			id: 'conn-1',
			projectId: PROJECT,
			deletedAt: null,
		});
		prismaMock.organization.update.mockResolvedValue({ revision: 7n });

		const response = await call('DELETE', single);

		expect(response.statusCode).toBe(204);
		const call0 = prismaMock.snippet.updateMany.mock.calls[0][0];
		expect(call0.where).toEqual({
			connectionId: 'conn-1',
			deletedAt: null,
		});
		expect(call0.data.deletedAt).toBeInstanceOf(Date);
		expect(call0.data.revision).toBe(7n);
	});
});
