import { describe, expect, test } from 'vitest';
import { requireMatchingSettings } from '../../src/services/ConnectionService';
import { HttpError } from '../../src/utils/http';
import { ErrorCodes } from '../../src/utils/ErrorCodes';

function failure(body: Parameters<typeof requireMatchingSettings>[0]) {
	try {
		requireMatchingSettings(body);
	} catch (error) {
		return error as HttpError;
	}
	return undefined;
}

// Exactly one settings group, and the one matching the type. A CHECK in the
// migration cannot do that — it cannot count across tables.
describe('type and settings of a connection', () => {
	test('if they match, the type is returned', () => {
		expect(
			requireMatchingSettings({ type: 'ssh', ssh: { host: 'a' } })
		).toBe('ssh');
	});

	test('the type says ssh, but ftp was sent', () => {
		const error = failure({ type: 'ssh', ftp: { host: 'a' } });
		expect(error?.status).toBe(400);
		expect(error?.code).toBe(ErrorCodes.CONNECTION_SETTINGS_MISMATCH);
	});

	test('two groups at once is one too many', () => {
		const error = failure({
			type: 'ssh',
			ssh: { host: 'a' },
			s3: { host: 'b' },
		});
		expect(error?.code).toBe(ErrorCodes.CONNECTION_SETTINGS_MISMATCH);
	});

	test('none at all is too few as well', () => {
		expect(failure({ type: 's3' })?.code).toBe(
			ErrorCodes.CONNECTION_SETTINGS_MISMATCH
		);
	});

	test('a type that does not exist', () => {
		const error = failure({
			type: 'webdav' as never,
			ssh: { host: 'a' },
		});
		expect(error?.code).toBe(ErrorCodes.INVALID_PAYLOAD);
	});
});
