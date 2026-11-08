import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '../../src/lib/wirecloud');

describe('verification module lib/wirecloud', () => {
	it('imports only jose and its own files', () => {
		const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const source = readFileSync(join(dir, file), 'utf8');
			const specifiers = [
				...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g),
			].map((m) => m[1]);
			for (const specifier of specifiers) {
				expect(
					specifier === 'jose' || specifier.startsWith('./'),
					`${file} imports ${specifier}`
				).toBe(true);
			}
		}
	});
});
