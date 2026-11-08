import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const CONNECTION = 'connection-1';
const url = `/api/workspaces/${ORGANIZATION}/connections/${CONNECTION}/secret`;

const payload = {
	keyId: 'key-1',
	// "secret" and twelve bytes of nonce, both base64.
	nonce: Buffer.from('012345678901').toString('base64'),
	ciphertext: Buffer.from('unreadable').toString('base64'),
};

function connectionExists(projectId = 'project-1') {
	prismaMock.connection.findFirst.mockResolvedValue({
		id: CONNECTION,
		projectId,
		deletedAt: null,
	});
}

describe('secret of a connection', () => {
	test('a viewer may not replace it', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([
			{ teamId: 'team-1' },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([
			{ projectId: 'project-1', role: 'viewer' },
		]);
		connectionExists();

		const response = await call('PUT', url, { payload });

		expect(response.statusCode).toBe(403);
		expect(prismaMock.secret.upsert).not.toHaveBeenCalled();
	});

	test('a keyId that nobody can open is rejected', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		connectionExists();
		prismaMock.projectKey.findFirst.mockResolvedValue(null);

		const response = await call('PUT', url, { payload });

		expect(response.statusCode).toBe(400);
		expect(prismaMock.secret.upsert).not.toHaveBeenCalled();
	});

	test('the ciphertext goes into the database as bytes and comes back as base64', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		connectionExists();
		prismaMock.projectKey.findFirst.mockResolvedValue({ id: 'pk-1' });
		prismaMock.secret.findUnique.mockResolvedValue(null);
		prismaMock.organization.update.mockResolvedValue({ revision: 8n });
		prismaMock.secret.upsert.mockImplementation(
			async ({ create }: { create: Record<string, unknown> }) => ({
				connectionId: CONNECTION,
				...create,
				deletedAt: null,
			})
		);

		const response = await call('PUT', url, { payload });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			connectionId: CONNECTION,
			keyId: 'key-1',
			ciphertext: payload.ciphertext,
			revision: '8',
		});

		// What gets stored is bytes — not a string.
		const stored = prismaMock.secret.upsert.mock.calls[0][0].create;
		expect(stored.ciphertext).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(stored.ciphertext).toString()).toBe('unreadable');
	});

	test('a revision that is no longer current overwrites nothing', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		connectionExists();
		prismaMock.projectKey.findFirst.mockResolvedValue({ id: 'pk-1' });
		prismaMock.secret.findUnique.mockResolvedValue({ revision: 9n });

		const response = await call('PUT', url, {
			payload: { ...payload, expectedRevision: '7' },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('R-CF');
		expect(prismaMock.secret.upsert).not.toHaveBeenCalled();
	});

	test('anything that is not base64 does not even arrive', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		connectionExists();

		const response = await call('PUT', url, {
			payload: { ...payload, ciphertext: 'not base64 !!' },
		});

		expect(response.statusCode).toBe(400);
	});

	test('deleting leaves no ciphertext behind', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		connectionExists();
		prismaMock.secret.findUnique.mockResolvedValue({
			revision: 3n,
			deletedAt: null,
		});
		prismaMock.organization.update.mockResolvedValue({ revision: 9n });

		const response = await call('DELETE', url);

		expect(response.statusCode).toBe(204);
		const written = prismaMock.secret.update.mock.calls[0][0].data;
		expect(written.deletedAt).toBeInstanceOf(Date);
		expect(written.ciphertext).toHaveLength(0);
		expect(written.nonce).toHaveLength(0);
	});
});
