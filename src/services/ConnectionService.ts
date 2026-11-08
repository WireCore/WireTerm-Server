import {
	Connection,
	ConnectionType,
	FtpConnection,
	Prisma,
	S3Connection,
	SshConnection,
} from 'generated/prisma/client';
import { ErrorCodes } from 'utils/ErrorCodes';
import { HttpError, invalid, revision } from 'utils/http';

/// Whatever belongs to `type` comes in a field of the same name: `{"type":"ssh",
/// "ssh":{…}}`. The same tagged enum as `ConnectionSettings` in the client,
/// just in the notation JSON allows.
export type ConnectionBody = {
	id?: string;
	name?: string;
	type?: ConnectionType;
	bookmarked?: boolean;
	position?: number;
	system?: {
		id: string;
		name: string;
		version: string;
		pretty: string;
	} | null;
	ssh?: Record<string, unknown>;
	ftp?: Record<string, unknown>;
	s3?: Record<string, unknown>;
	/** Only when updating: move into this project. */
	projectId?: string;
	expectedRevision?: string;
};

const TYPES: ConnectionType[] = ['ssh', 'ftp', 's3'];

/// Exactly one of the three settings groups, and the one matching `type`.
/// Neither Prisma nor a CHECK in the migration can manage that — a CHECK
/// cannot count across tables. So here, in the one place every connection
/// passes through.
export function requireMatchingSettings(body: ConnectionBody): ConnectionType {
	const type = body.type;
	if (!type || !TYPES.includes(type)) {
		throw invalid('type must be ssh, ftp or s3');
	}
	// `candidate` comes from TYPES, not from the request.
	// eslint-disable-next-line security/detect-object-injection
	const given = TYPES.filter((candidate) => body[candidate] !== undefined);
	if (given.length !== 1 || given[0] !== type) {
		throw new HttpError(
			400,
			ErrorCodes.CONNECTION_SETTINGS_MISMATCH,
			`type is ${type}, but ${given.join(', ') || 'nothing'} was sent`
		);
	}
	return type;
}

// ---- Input -> columns -------------------------------------------------------
//
// Whatever is not sent gets the default value from the schema. Fastify checks
// the types and the required fields using the JSON schema on the route; here
// it is only about the shape.

function text(value: unknown, field: string, max = 255): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid(`${field} is missing`);
	}
	if (value.length > max) throw invalid(`${field} is too long`);
	return value;
}

function port(value: unknown, fallback: number): number {
	if (value === undefined || value === null) return fallback;
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > 65535
	) {
		throw invalid('port must be between 1 and 65535');
	}
	return value;
}

/// Without a proxy, the default proxy of the connecting device applies. For
/// JSON, Prisma distinguishes between SQL `NULL` and the JSON value `null`;
/// the former is meant.
function proxyData(value: unknown) {
	return (value as object | undefined) ?? Prisma.DbNull;
}

export function sshData(input: Record<string, unknown>) {
	return {
		host: text(input.host, 'ssh.host'),
		port: port(input.port, 22),
		user: text(input.user, 'ssh.user'),
		authSource: input.authSource as SshConnection['authSource'],
		keyFilePath: (input.keyFilePath as string | undefined) ?? null,
		vaultProvider:
			(input.vaultProvider as SshConnection['vaultProvider']) ?? null,
		vaultReference: (input.vaultReference as string | undefined) ?? null,
		startPath: (input.startPath as string | undefined) ?? '',
		jumpConnectionId:
			(input.jumpConnectionId as string | undefined) ?? null,
		agentForwarding: Boolean(input.agentForwarding),
		forwards: (input.forwards as object[] | undefined) ?? [],
		proxy: proxyData(input.proxy),
		startupSnippetId:
			(input.startupSnippetId as string | undefined) ?? null,
	};
}

export function ftpData(input: Record<string, unknown>) {
	return {
		host: text(input.host, 'ftp.host'),
		port: port(input.port, 21),
		user: typeof input.user === 'string' ? input.user : '',
		authSource: input.authSource as FtpConnection['authSource'],
		vaultProvider:
			(input.vaultProvider as FtpConnection['vaultProvider']) ?? null,
		vaultReference: (input.vaultReference as string | undefined) ?? null,
		security: (input.security as FtpConnection['security']) ?? 'explicit',
		passive: input.passive === undefined ? true : Boolean(input.passive),
		acceptInvalidCert: Boolean(input.acceptInvalidCert),
		startPath: (input.startPath as string | undefined) ?? '',
		proxy: proxyData(input.proxy),
	};
}

export function s3Data(input: Record<string, unknown>) {
	return {
		host: text(input.host, 's3.host'),
		port: port(input.port, 443),
		user: text(input.user, 's3.user'),
		authSource: input.authSource as S3Connection['authSource'],
		vaultProvider:
			(input.vaultProvider as S3Connection['vaultProvider']) ?? null,
		vaultReference: (input.vaultReference as string | undefined) ?? null,
		region: (input.region as string | undefined) || 'us-east-1',
		bucket: (input.bucket as string | undefined) ?? '',
		prefix: (input.prefix as string | undefined) ?? '',
		tls: input.tls === undefined ? true : Boolean(input.tls),
		pathStyle: Boolean(input.pathStyle),
		acceptInvalidCert: Boolean(input.acceptInvalidCert),
		storageClass: (input.storageClass as string | undefined) ?? '',
		proxy: proxyData(input.proxy),
	};
}

export function settingsData(type: ConnectionType, body: ConnectionBody) {
	if (type === 'ssh') return { ssh: { create: sshData(body.ssh!) } };
	if (type === 'ftp') return { ftp: { create: ftpData(body.ftp!) } };
	return { s3: { create: s3Data(body.s3!) } };
}

export function systemData(body: ConnectionBody) {
	if (body.system === undefined) return {};
	if (body.system === null) {
		return {
			systemId: null,
			systemName: null,
			systemVersion: null,
			systemPretty: null,
			systemSeenAt: null,
		};
	}
	return {
		systemId: body.system.id,
		systemName: body.system.name,
		systemVersion: body.system.version,
		systemPretty: body.system.pretty,
		systemSeenAt: new Date(),
	};
}

// ---- Columns -> output ------------------------------------------------------

type FullConnection = Connection & {
	ssh?: SshConnection | null;
	ftp?: FtpConnection | null;
	s3?: S3Connection | null;
};

/// The same shape that goes back in — whatever the client sends back it does
/// not have to rebuild first.
export function toApi(connection: FullConnection) {
	const ssh = withoutConnectionId(connection.ssh);
	const ftp = withoutConnectionId(connection.ftp);
	const s3 = withoutConnectionId(connection.s3);

	return {
		id: connection.id,
		projectId: connection.projectId,
		name: connection.name,
		type: connection.type,
		bookmarked: connection.bookmarked,
		position: connection.position,
		system: connection.systemId
			? {
					id: connection.systemId,
					name: connection.systemName ?? '',
					version: connection.systemVersion ?? '',
					pretty: connection.systemPretty ?? '',
					seenAt: connection.systemSeenAt,
				}
			: null,
		revision: revision(connection.revision),
		deletedAt: connection.deletedAt,
		...(ssh ? { ssh } : {}),
		...(ftp ? { ftp } : {}),
		...(s3 ? { s3 } : {}),
	};
}

/// The foreign key column is already next to it as `id`; having the same
/// thing twice in the body only invites changing the wrong one.
function withoutConnectionId<T extends { connectionId: string }>(
	row: T | null | undefined
) {
	if (!row) return undefined;
	const copy: Partial<T> = { ...row };
	delete copy.connectionId;
	return copy;
}
