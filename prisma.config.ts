import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

/// Like `secret()` in src/lib/env.ts, repeated here because the production
/// image runs migrations without the sources.
function secret(name: string): string | undefined {
	const file = process.env[`${name}_FILE`];
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- path from the operator
	if (file) return readFileSync(file, 'utf8').trim();
	// eslint-disable-next-line security/detect-object-injection -- constant name
	return process.env[name] || undefined;
}

/// The same DATABASE_URL as the server, with TLS added the way Prisma's own
/// engine expects it when DATABASE_SSL is set — so migrations reach a database
/// that only speaks TLS without a second setting.
function datasourceUrl(): string | undefined {
	const url = secret('DATABASE_URL');
	if (!url || process.env.DATABASE_SSL !== 'true') return url;
	const withTls = new URL(url);
	withTls.searchParams.set('sslaccept', 'strict');
	if (process.env.DATABASE_SSL_CA) {
		withTls.searchParams.set('sslcert', process.env.DATABASE_SSL_CA);
	}
	return withTls.toString();
}

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
		seed: 'tsx prisma/seed.ts',
	},
	datasource: {
		url: datasourceUrl(),
	},
});
