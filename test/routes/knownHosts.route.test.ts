import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { loginAs } from '../helpers/auth';
import { prismaMock } from '../helpers/prisma';

const ORGANIZATION = 'organization-1';
const url = `/api/workspaces/${ORGANIZATION}/known-hosts`;
const FINGERPRINT = 'ab'.repeat(32);

function asMember() {
	loginAs();
	prismaMock.member.findFirst.mockResolvedValue({ role: 'member' });
	prismaMock.teamMember.findMany.mockResolvedValue([]);
	prismaMock.projectShare.findMany.mockResolvedValue([]);
	prismaMock.organization.update.mockResolvedValue({ revision: 9n });
	prismaMock.knownHostKey.upsert.mockImplementation(
		async ({ create }: { create: Record<string, unknown> }) => ({
			id: 'host-1',
			...create,
		})
	);
}

describe('known hosts', () => {
	test('a TLS certificate goes in with its fingerprint as the key', async () => {
		asMember();

		const response = await call('POST', url, {
			payload: {
				host: 'ftp.example.test',
				port: 990,
				algorithm: 'x509-sha256',
				publicKey: FINGERPRINT,
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			host: 'ftp.example.test',
			port: 990,
			algorithm: 'x509-sha256',
			publicKey: FINGERPRINT,
			revision: '9',
		});
	});

	test('a certificate without a valid fingerprint is rejected', async () => {
		asMember();

		for (const publicKey of [
			'ab'.repeat(31),
			FINGERPRINT.toUpperCase(),
			`${'ab'.repeat(31)}zz`,
			'ssh-ed25519 AAAA',
		]) {
			const response = await call('POST', url, {
				payload: {
					host: 'ftp.example.test',
					port: 21,
					algorithm: 'x509-sha256',
					publicKey,
				},
			});
			expect(response.statusCode, publicKey).toBe(400);
		}
		expect(prismaMock.knownHostKey.upsert).not.toHaveBeenCalled();
	});

	test('an SSH host key stays as it was', async () => {
		asMember();

		const response = await call('POST', url, {
			payload: {
				host: 'web01.example.test',
				algorithm: 'ssh-ed25519',
				publicKey:
					'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({ port: 22 });
	});
});
