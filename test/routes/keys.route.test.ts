import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs, USER_ID } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const wrapped = {
	nonce: Buffer.from('012345678901').toString('base64'),
	encryptedPrivateKey: Buffer.from('wrapped key').toString('base64'),
	kdfSalt: Buffer.from('0123456789abcdef').toString('base64'),
	kdfParams: '{"m":65536,"t":3,"p":4}',
};

const payload = {
	publicKey: Buffer.alloc(32, 7).toString('base64'),
	master: wrapped,
	recoveryKeys: [{ label: 'WT7K', ...wrapped }],
};

describe("a user's key material", () => {
	test('there is none without signing in', async () => {
		const response = await call('GET', '/api/keys/me');
		expect(response.statusCode).toBe(401);
	});

	test('on setup, key pair and recovery codes arrive together', async () => {
		loginAs();
		prismaMock.userKey.findUnique.mockResolvedValue(null);

		const response = await call('POST', '/api/keys/me', { payload });

		expect(response.statusCode).toBe(201);
		expect(prismaMock.userKey.create.mock.calls[0][0].data).toMatchObject({
			userId: USER_ID,
			algorithm: 'x25519',
		});
		expect(prismaMock.recoveryKey.create).toHaveBeenCalledTimes(1);
		expect(prismaMock.recoveryKey.create.mock.calls[0][0].data.label).toBe(
			'WT7K'
		);
	});

	test('a second key pair would not be a fresh start but a loss', async () => {
		loginAs();
		prismaMock.userKey.findUnique.mockResolvedValue({ userId: USER_ID });

		const response = await call('POST', '/api/keys/me', { payload });

		// Every project key of this user is wrapped to the old public
		// key; a new pair makes it unusable. So 409 instead of
		// overwriting.
		expect(response.statusCode).toBe(409);
		expect(response.json().code).toBe('K-EX');
		expect(prismaMock.userKey.create).not.toHaveBeenCalled();
	});

	test('a new master password swaps the wrapping, not the key', async () => {
		loginAs();
		prismaMock.userKey.findUnique.mockResolvedValue({ userId: USER_ID });

		const response = await call('POST', '/api/keys/me/rewrap', {
			payload: {
				master: wrapped,
				recoveryKeys: [{ label: 'AB12', ...wrapped }],
			},
		});

		expect(response.statusCode).toBe(200);
		const written = prismaMock.userKey.update.mock.calls[0][0].data;
		expect(written).not.toHaveProperty('publicKey');
		// The old set of codes opens the same door and has to go.
		expect(prismaMock.recoveryKey.deleteMany).toHaveBeenCalledWith({
			where: { userId: USER_ID },
		});
	});

	test('rewrap without an existing key pair goes nowhere', async () => {
		loginAs();
		prismaMock.userKey.findUnique.mockResolvedValue(null);

		const response = await call('POST', '/api/keys/me/rewrap', {
			payload: { master: wrapped },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json().code).toBe('K-NF');
	});

	test("someone else's recovery code cannot be reported as used", async () => {
		loginAs();
		prismaMock.recoveryKey.findFirst.mockResolvedValue(null);

		const response = await call(
			'POST',
			'/api/keys/me/recovery/foreign-1/used'
		);

		expect(response.statusCode).toBe(404);
		// The query binds the ID to the signed-in user.
		expect(prismaMock.recoveryKey.findFirst.mock.calls[0][0].where).toEqual(
			{
				id: 'foreign-1',
				userId: USER_ID,
			}
		);
	});
});
