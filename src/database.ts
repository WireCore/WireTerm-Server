import { readFileSync } from 'node:fs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client';
import {
	DATABASE_CONNECTION_LIMIT,
	DATABASE_SSL,
	DATABASE_SSL_CA,
	DATABASE_URL,
} from 'globals';

/// The connection comes from DATABASE_URL alone — the same value
/// `prisma migrate` uses — so it is maintained in one place.
function connection(url: string) {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number(parsed.port) || 3306,
		user: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
	};
}

if (!DATABASE_URL) throw new Error('DATABASE_URL is missing');

const adapter = new PrismaMariaDb({
	...connection(DATABASE_URL),
	connectionLimit: DATABASE_CONNECTION_LIMIT,
	ssl: DATABASE_SSL
		? {
				rejectUnauthorized: true,
				...(DATABASE_SSL_CA
					? // The path comes from the operator, not from a request.
						// eslint-disable-next-line security/detect-non-literal-fs-filename
						{ ca: readFileSync(DATABASE_SSL_CA, 'utf8') }
					: {}),
			}
		: undefined,
});
const prisma = new PrismaClient({ adapter });

export default prisma;
