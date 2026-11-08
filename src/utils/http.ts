import { FastifyReply } from 'fastify';
import { ErrorCodes } from 'utils/ErrorCodes';

/// An error that reaches the client as a status code and an error code.
/// Everything else becomes a 500 without details in the error handler,
/// because a stack trace is nothing that belongs on the wire.
export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: ErrorCodes,
		readonly detail?: string
	) {
		super(code);
	}
}

export const notAuthenticated = () =>
	new HttpError(401, ErrorCodes.AUTH_NOT_AUTHENTICATED);
export const forbidden = () =>
	new HttpError(403, ErrorCodes.AUTH_NO_ACCESS_TO_RESOURCE);
export const notFound = (code: ErrorCodes) => new HttpError(404, code);
export const conflict = (code: ErrorCodes, detail?: string) =>
	new HttpError(409, code, detail);
export const invalid = (detail: string) =>
	new HttpError(400, ErrorCodes.INVALID_PAYLOAD, detail);

export function sendError(reply: FastifyReply, error: unknown) {
	if (error instanceof HttpError) {
		return reply
			.status(error.status)
			.send({ code: error.code, detail: error.detail });
	}
	reply.log.error(error);
	return reply.status(500).send({ code: 'INTERNAL' });
}

// ---- Bytes over JSON --------------------------------------------------------
//
// Ciphertexts, nonces and public keys are bytes. JSON has none, so base64 —
// in both directions in one place, so that not every route invents its own
// notation.

export function toBase64(value: Uint8Array | Buffer): string {
	return Buffer.from(value).toString('base64');
}

export function fromBase64(
	value: unknown,
	field: string,
	maxBytes: number
): Uint8Array<ArrayBuffer> {
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid(`${field} is missing`);
	}
	const bytes = Buffer.from(value, 'base64');
	// Buffer.from does not throw, it discards what does not fit. A value that
	// comes back differently than it went in was not base64.
	if (
		bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
	) {
		throw invalid(`${field} is not base64`);
	}
	if (bytes.length === 0) throw invalid(`${field} is empty`);
	if (bytes.length > maxBytes) {
		throw invalid(`${field} is longer than ${maxBytes} bytes`);
	}
	// Prisma requires a `Uint8Array` on its own `ArrayBuffer`. A `Buffer` from
	// `Buffer.from` sits on a shared pool and is no good for that — so copy.
	const copy = new Uint8Array(new ArrayBuffer(bytes.length));
	copy.set(bytes);
	return copy;
}

/// `revision` is a BIGINT. `JSON.stringify` throws on a BigInt, and a number
/// would be wrong from 2^53 on — so it goes out as a string.
export function revision(value: bigint): string {
	return value.toString();
}

/// The reverse direction for `?since=`.
export function parseRevision(value: unknown): bigint {
	if (value === undefined || value === null || value === '') return 0n;
	const text =
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'bigint'
			? String(value)
			: '';
	if (!/^\d{1,19}$/.test(text)) throw invalid('since is not a revision');
	return BigInt(text);
}

// ---- IDs from the client ----------------------------------------------------
//
// Projects and connections get their ID from the client, and the tables are
// unique server-wide, not per organization. With a UUID that has no
// consequences; a meaningful ID like `web01`, on the other hand, could
// already be taken by another workspace, and the client would read the
// `P-EX`/`C-EX` as "I already created that".
export const clientId = {
	type: 'string',
	pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
};
