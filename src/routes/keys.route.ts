import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireUser } from 'services/AuthService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { conflict, fromBase64, notFound, toBase64 } from 'utils/http';

/// A ciphertext along with everything needed to open it again — except the
/// password.
const wrapped = {
	type: 'object',
	required: ['nonce', 'encryptedPrivateKey', 'kdfSalt', 'kdfParams'],
	additionalProperties: false,
	properties: {
		wrapAlgorithm: { type: 'string', maxLength: 64 },
		nonce: { type: 'string', maxLength: 64 },
		encryptedPrivateKey: { type: 'string', maxLength: 8192 },
		kdf: { type: 'string', maxLength: 64 },
		kdfSalt: { type: 'string', maxLength: 64 },
		kdfParams: { type: 'string', maxLength: 255 },
	},
};

const recoveryItem = {
	type: 'object',
	required: ['label', 'nonce', 'encryptedPrivateKey', 'kdfSalt', 'kdfParams'],
	additionalProperties: false,
	properties: {
		label: { type: 'string', minLength: 1, maxLength: 16 },
		...wrapped.properties,
	},
};

const createSchema = {
	body: {
		type: 'object',
		required: ['publicKey', 'master'],
		additionalProperties: false,
		properties: {
			algorithm: { type: 'string', maxLength: 64 },
			publicKey: { type: 'string', maxLength: 128 },
			master: wrapped,
			recoveryKeys: {
				type: 'array',
				minItems: 1,
				maxItems: 20,
				items: recoveryItem,
			},
		},
	},
};

const rewrapSchema = {
	body: {
		type: 'object',
		required: ['master'],
		additionalProperties: false,
		properties: {
			master: wrapped,
			recoveryKeys: {
				type: 'array',
				maxItems: 20,
				items: recoveryItem,
			},
		},
	},
};

type Wrapped = {
	wrapAlgorithm?: string;
	nonce: string;
	encryptedPrivateKey: string;
	kdf?: string;
	kdfSalt: string;
	kdfParams: string;
};
type RecoveryItem = Wrapped & { label: string };

function wrappedData(input: Wrapped) {
	return {
		wrapAlgorithm: input.wrapAlgorithm ?? 'xchacha20poly1305',
		nonce: fromBase64(input.nonce, 'nonce', 32),
		encryptedPrivateKey: fromBase64(
			input.encryptedPrivateKey,
			'encryptedPrivateKey',
			4096
		),
		kdf: input.kdf ?? 'argon2id',
		kdfSalt: fromBase64(input.kdfSalt, 'kdfSalt', 32),
		kdfParams: input.kdfParams,
	};
}

/// A user's key material.
///
/// Everything here is either public (the public key) or a ciphertext the
/// server has no password for. It is handed out to whoever owns it — whoever
/// fetches it has nothing yet.
export default (fastify: FastifyInstance) => {
	fastify.get('/api/keys/me', async (request) => {
		const userId = await requireUser(request);

		const key = await prisma.userKey.findUnique({ where: { userId } });
		if (!key) throw notFound(ErrorCodes.KEY_NOT_FOUND);

		const recoveryKeys = await prisma.recoveryKey.findMany({
			where: { userId },
			orderBy: { createdAt: 'asc' },
		});

		return {
			algorithm: key.algorithm,
			publicKey: toBase64(key.publicKey),
			master: {
				wrapAlgorithm: key.wrapAlgorithm,
				nonce: toBase64(key.nonce),
				encryptedPrivateKey: toBase64(key.encryptedPrivateKey),
				kdf: key.kdf,
				kdfSalt: toBase64(key.kdfSalt),
				kdfParams: key.kdfParams,
			},
			recoveryKeys: recoveryKeys.map((entry) => ({
				id: entry.id,
				label: entry.label,
				wrapAlgorithm: entry.wrapAlgorithm,
				nonce: toBase64(entry.nonce),
				encryptedPrivateKey: toBase64(entry.encryptedPrivateKey),
				kdf: entry.kdf,
				kdfSalt: toBase64(entry.kdfSalt),
				kdfParams: entry.kdfParams,
				usedAt: entry.usedAt,
			})),
		};
	});

	/// Once in an account's lifetime: create the key pair.
	///
	/// A second time would not be a fresh start but a loss — every project
	/// key of this user is wrapped to the old public key and could no longer
	/// be opened with a new pair. Hence 409 instead of overwriting; a new
	/// master password goes through `/rewrap`, a lost one through a recovery
	/// code.
	fastify.post<{
		Body: {
			algorithm?: string;
			publicKey: string;
			master: Wrapped;
			recoveryKeys?: RecoveryItem[];
		};
	}>('/api/keys/me', { schema: createSchema }, async (request, reply) => {
		const userId = await requireUser(request);

		const existing = await prisma.userKey.findUnique({ where: { userId } });
		if (existing) throw conflict(ErrorCodes.KEY_EXISTS);

		await prisma.$transaction(async (tx) => {
			await tx.userKey.create({
				data: {
					userId,
					algorithm: request.body.algorithm ?? 'x25519',
					publicKey: fromBase64(
						request.body.publicKey,
						'publicKey',
						64
					),
					...wrappedData(request.body.master),
				},
			});
			for (const entry of request.body.recoveryKeys ?? []) {
				await tx.recoveryKey.create({
					data: {
						userId,
						label: entry.label,
						...wrappedData(entry),
					},
				});
			}
		});

		return reply.status(201).send({ ok: true });
	});

	/// The master password has changed — or a recovery code was redeemed.
	/// Both times the key pair stays the same, only the wrapping is new. If a
	/// new set of recovery codes is sent along, it replaces the old one
	/// completely: the old one opens the same door.
	fastify.post<{
		Body: { master: Wrapped; recoveryKeys?: RecoveryItem[] };
	}>('/api/keys/me/rewrap', { schema: rewrapSchema }, async (request) => {
		const userId = await requireUser(request);

		const existing = await prisma.userKey.findUnique({
			where: { userId },
		});
		if (!existing) throw notFound(ErrorCodes.KEY_NOT_FOUND);

		await prisma.$transaction(async (tx) => {
			await tx.userKey.update({
				where: { userId },
				data: wrappedData(request.body.master),
			});

			if (request.body.recoveryKeys) {
				await tx.recoveryKey.deleteMany({ where: { userId } });
				for (const entry of request.body.recoveryKeys) {
					await tx.recoveryKey.create({
						data: {
							userId,
							label: entry.label,
							...wrappedData(entry),
						},
					});
				}
			}
		});

		return { ok: true };
	});

	/// A code is valid once. It is used up in the client — the server only
	/// learns that it happened, so the UI can show it.
	fastify.post<{ Params: { id: string } }>(
		'/api/keys/me/recovery/:id/used',
		async (request) => {
			const userId = await requireUser(request);

			const entry = await prisma.recoveryKey.findFirst({
				where: { id: request.params.id, userId },
			});
			if (!entry) throw notFound(ErrorCodes.RECOVERY_KEY_NOT_FOUND);

			await prisma.recoveryKey.update({
				where: { id: entry.id },
				data: { usedAt: new Date() },
			});

			return { ok: true };
		}
	);
};
