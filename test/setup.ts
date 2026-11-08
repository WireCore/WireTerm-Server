import { beforeEach, vi } from 'vitest';
import { installAuthMock } from './helpers/auth';

beforeEach(() => {
	vi.resetAllMocks();
	installAuthMock();
});
