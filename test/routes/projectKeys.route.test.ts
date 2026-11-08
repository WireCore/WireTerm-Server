import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs, OTHER_USER_ID, USER_ID } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const PROJECT = 'project-1';
const url = `/api/workspaces/${ORGANIZATION}/projects/${PROJECT}/keys`;

const grant = {
	userId: OTHER_USER_ID,
	ephemeralPublicKey: Buffer.alloc(32, 1).toString('base64'),
	nonce: Buffer.from('012345678901').toString('base64'),
	wrappedKey: Buffer.alloc(48, 2).toString('base64'),
};

function ownerOfLivingProject() {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
	prismaMock.project.findFirst.mockResolvedValue({
		id: PROJECT,
		organizationId: ORGANIZATION,
		deletedAt: null,
	});
}

describe('distributing project keys', () => {
	test('nothing can be stored for someone without access', async () => {
		ownerOfLivingProject();
		prismaMock.projectKey.count.mockResolvedValue(0);
		// Neither an administrator nor in a team with a share.
		prismaMock.member.findMany.mockResolvedValue([{ userId: USER_ID }]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);

		const response = await call('POST', url, {
			payload: { keyId: 'key-1', grants: [grant] },
		});

		expect(response.statusCode).toBe(400);
		expect(prismaMock.projectKey.upsert).not.toHaveBeenCalled();
	});

	test('whoever does not hold the key version cannot have wrapped it', async () => {
		ownerOfLivingProject();
		// The key version already exists …
		prismaMock.projectKey.count
			.mockResolvedValueOnce(3)
			// … but the sender holds no copy of it.
			.mockResolvedValueOnce(0);

		const response = await call('POST', url, {
			payload: { keyId: 'key-1', grants: [grant] },
		});

		expect(response.statusCode).toBe(403);
		expect(prismaMock.projectKey.upsert).not.toHaveBeenCalled();
	});

	test('whoever may edit the project may create the first key version', async () => {
		ownerOfLivingProject();
		prismaMock.projectKey.count.mockResolvedValue(0);
		prismaMock.member.findMany.mockResolvedValue([
			{ userId: USER_ID },
			{ userId: OTHER_USER_ID },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);
		prismaMock.projectKey.upsert.mockImplementation(
			async ({ create }: { create: Record<string, unknown> }) => create
		);

		const response = await call('POST', url, {
			payload: { keyId: 'key-1', grants: [grant] },
		});

		expect(response.statusCode).toBe(201);
		const written = prismaMock.projectKey.upsert.mock.calls[0][0].create;
		expect(written.userId).toBe(OTHER_USER_ID);
		expect(written.grantedById).toBe(USER_ID);
		expect(written.wrappedKey).toBeInstanceOf(Uint8Array);
	});

	test('whoever has not set up a master password has no public key', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'owner' });
		prismaMock.member.findMany.mockResolvedValue([
			{
				userId: OTHER_USER_ID,
				role: 'member',
				user: { name: 'New', email: 'new@example.com', key: null },
			},
		]);

		const response = await call(
			'GET',
			`/api/workspaces/${ORGANIZATION}/member-keys`
		);

		expect(response.statusCode).toBe(200);
		// `null` means: nothing can be wrapped for this user yet.
		expect(response.json()[0].key).toBeNull();
	});
});

describe('cleaning up after renewal', () => {
	function grantAs(existing: number) {
		ownerOfLivingProject();
		prismaMock.projectKey.count.mockResolvedValue(existing);
		prismaMock.member.findMany.mockResolvedValue([
			{ userId: USER_ID },
			{ userId: OTHER_USER_ID },
		]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);
		prismaMock.projectKey.upsert.mockImplementation(
			async ({ create }: { create: Record<string, unknown> }) => create
		);
	}

	test('a new key version removes the copies of those who may no longer see anything', async () => {
		grantAs(0);

		await call('POST', url, {
			payload: { keyId: 'key-2', grants: [grant] },
		});

		expect(prismaMock.projectKey.deleteMany).toHaveBeenCalledWith({
			where: {
				projectId: PROJECT,
				userId: { notIn: [USER_ID, OTHER_USER_ID] },
			},
		});
	});

	test('a further delivery for the same key version leaves them alone', async () => {
		grantAs(2);
		prismaMock.projectKey.count
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(1);

		await call('POST', url, {
			payload: { keyId: 'key-2', grants: [grant] },
		});

		expect(prismaMock.projectKey.deleteMany).not.toHaveBeenCalled();
	});
});

describe('stale keys after removal', () => {
	const stale = `/api/workspaces/${ORGANIZATION}/members/${OTHER_USER_ID}/stale-keys`;

	function heldKeys() {
		prismaMock.projectKey.findMany.mockResolvedValue([
			{ projectId: 'project-1', keyId: 'new' },
			{ projectId: 'project-2', keyId: 'old' },
		]);
		// The current one per project is the newest key version.
		prismaMock.projectKey.findFirst.mockImplementation(
			async ({ where }: { where: { projectId: string } }) => ({
				keyId: where.projectId === 'project-1' ? 'new' : 'newer',
			})
		);
	}

	test('whoever is no longer a member makes every project with their key version due', async () => {
		loginAs();
		prismaMock.member.findFirst
			.mockResolvedValueOnce({ role: 'owner' })
			.mockResolvedValueOnce(null);
		heldKeys();

		const response = await call('GET', stale);

		expect(response.statusCode).toBe(200);
		// project-2 is already renewed: their key version there is no longer the current one.
		expect(response.json()).toEqual({ projectIds: ['project-1'] });
	});

	test('what they may still see after removal from a team is not due', async () => {
		loginAs();
		prismaMock.member.findFirst
			.mockResolvedValueOnce({ role: 'owner' })
			.mockResolvedValueOnce({ userId: OTHER_USER_ID });
		prismaMock.projectKey.findMany.mockResolvedValue([
			{ projectId: 'project-1', keyId: 'k1' },
			{ projectId: 'project-3', keyId: 'k3' },
		]);
		prismaMock.projectKey.findFirst.mockImplementation(
			async ({ where }: { where: { projectId: string } }) => ({
				keyId: where.projectId === 'project-1' ? 'k1' : 'k3',
			})
		);
		prismaMock.member.findMany.mockImplementation(
			async ({ where }: { where: { role?: unknown } }) =>
				where.role ? [{ userId: USER_ID }] : [{ userId: OTHER_USER_ID }]
		);
		// project-1 is shared with the whole organization, project-3 with nobody.
		prismaMock.projectShare.findMany.mockImplementation(
			async ({ where }: { where: { projectId: string } }) =>
				where.projectId === 'project-1' ? [{ teamId: null }] : []
		);

		const response = await call('GET', stale);

		expect(response.json()).toEqual({ projectIds: ['project-3'] });
	});

	test('only those who manage members may ask', async () => {
		loginAs();
		prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.projectShare.findMany.mockResolvedValue([]);

		const response = await call('GET', stale);

		expect(response.statusCode).toBe(403);
		expect(prismaMock.projectKey.findMany).not.toHaveBeenCalled();
	});
});
