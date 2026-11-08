import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		alias: {
			// src/database.ts builds a MariaDB pool on import, src/lib/auth.ts
			// starts better-auth against it. Both are replaced by mocks, so
			// that the tests run without a database.
			database: new URL('./test/helpers/prisma.ts', import.meta.url)
				.pathname,
			'lib/auth': new URL('./test/helpers/auth.ts', import.meta.url)
				.pathname,
		},
		setupFiles: ['./test/setup.ts'],
		coverage: {
			include: ['src/**/*.ts'],
			exclude: ['src/generated/**', 'src/instrumentation.ts'],
		},
	},
});
