import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig(
	globalIgnores(['dist/**', 'coverage/**', 'src/generated/**', 'db-data/**']),
	js.configs.recommended,
	// Rules that know the types — they catch an un-awaited promise in a route,
	// which the untyped rules cannot see. tsconfig.json covers src, test,
	// prisma and the configuration files.
	tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	security.configs.recommended,
	prettierRecommended,
	{
		// Plain JavaScript (this file, scripts/) has no types to check.
		files: ['**/*.js', '**/*.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
	},
	{
		rules: {
			'no-console': 2,
			'no-tabs': ['error', { allowIndentationTabs: true }],
			'@typescript-eslint/no-explicit-any': 1,
			// Handlers and hooks are async because Fastify and better-auth expect
			// a promise there, not because they forgot an `await`.
			'@typescript-eslint/require-await': 0,
		},
	},
	{
		// Table-driven tests access resolvers dynamically and read fixtures
		// from fixed paths.
		// Responses from `inject().json()` are untyped by design.
		files: ['test/**/*.ts'],
		rules: {
			'security/detect-object-injection': 0,
			'security/detect-non-literal-fs-filename': 0,
			'@typescript-eslint/no-unsafe-member-access': 0,
			'@typescript-eslint/no-unsafe-assignment': 0,
			'@typescript-eslint/no-unsafe-return': 0,
		},
	},
	{
		// The seed and the scripts run as a CLI: they write to stdout and to
		// the paths they are given.
		files: ['prisma/**/*.ts', 'scripts/**/*.ts'],
		rules: {
			'no-console': 0,
			'security/detect-non-literal-fs-filename': 0,
		},
	}
);
