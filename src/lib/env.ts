import { readFileSync } from 'node:fs';

/// A secret from the environment: the content of the file named in
/// `<NAME>_FILE` if that is set (Docker and Kubernetes secrets), else
/// `<NAME>` itself. Surrounding whitespace, such as the newline most files
/// end with, is dropped. `prisma.config.ts` repeats this, because the
/// production image runs migrations without the sources.
export function secret(name: string): string | undefined {
	// `name` is a constant from globals.ts, the path comes from the operator.
	const file = process.env[`${name}_FILE`];
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	if (file) return readFileSync(file, 'utf8').trim();
	// eslint-disable-next-line security/detect-object-injection
	return process.env[name] || undefined;
}
