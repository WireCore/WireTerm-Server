import { describe, expect, test } from 'vitest';
import { checkRevision } from '../../src/services/TreeService';
import { HttpError } from '../../src/utils/http';
import { ErrorCodes } from '../../src/utils/ErrorCodes';
import { parseRevision } from '../../src/utils/http';

function failure(current: bigint, expected: unknown) {
	try {
		checkRevision(current, expected);
	} catch (error) {
		return error as HttpError;
	}
	return undefined;
}

describe('optimistic locking', () => {
	test('without a revision the last writer wins, as before', () => {
		expect(failure(9n, undefined)).toBeUndefined();
	});

	test('if the revision matches, it goes through', () => {
		expect(failure(9n, '9')).toBeUndefined();
	});

	test('if someone wrote in between, there is a 409 instead of a silent loss', () => {
		const error = failure(9n, '7');
		expect(error?.status).toBe(409);
		expect(error?.code).toBe(ErrorCodes.REVISION_CONFLICT);
	});

	test('a revision beyond 2^53 stays exact', () => {
		expect(failure(9007199254740993n, '9007199254740993')).toBeUndefined();
		expect(failure(9007199254740993n, '9007199254740992')?.status).toBe(
			409
		);
	});
});

describe('since from the query', () => {
	test('if it is missing, the sync starts from the beginning', () => {
		expect(parseRevision(undefined)).toBe(0n);
		expect(parseRevision('')).toBe(0n);
	});

	test('anything that is not a number does not get through', () => {
		expect(() => parseRevision('-1')).toThrow();
		expect(() => parseRevision('1e9')).toThrow();
		expect(() => parseRevision('12345678901234567890')).toThrow();
	});
});
