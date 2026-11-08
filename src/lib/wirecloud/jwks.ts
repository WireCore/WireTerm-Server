import { createLocalJWKSet, errors } from 'jose';
import type {
	FlattenedJWSInput,
	JSONWebKeySet,
	JWSHeaderParameters,
} from 'jose';
import { TokenError } from './errors';

export type JwksCacheOptions = {
	/// Where WireCloud publishes its JWKS, e.g.
	/// `http://wirecloud_backend:8080/.well-known/jwks.json`.
	url: string;
	/// How long a loaded JWKS counts as fresh.
	ttlMs?: number;
	/// An unknown `kid` reloads the JWKS at most this often, so that an
	/// attacker cannot flood WireCloud with made-up key IDs.
	unknownKidRefreshMinIntervalMs?: number;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	now?: () => number;
};

const MAX_BODY_BYTES = 64 * 1024;

/// Keeps WireCloud's JWKS in memory (VERTRAG.md 6.4):
///
/// - It is loaded on first use and renewed after `ttlMs` from then on.
/// - An unknown `kid` triggers a reload, at most every
///   `unknownKidRefreshMinIntervalMs`. That way a tool sees a key that
///   WireCloud published in advance for a rotation without waiting.
/// - If WireCloud is unreachable, the last loaded JWKS stays in use. Without
///   a loaded JWKS there is no verification (`jwks_unavailable`).
export class JwksCache {
	private jwks: JSONWebKeySet | undefined;
	private resolver: ReturnType<typeof createLocalJWKSet> | undefined;
	private fetchedAt = 0;
	private lastAttempt = Number.NEGATIVE_INFINITY;
	private inflight: Promise<boolean> | undefined;

	constructor(private readonly options: JwksCacheOptions) {}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	/// Key resolution for `jwtVerify`.
	readonly getKey = async (
		header: JWSHeaderParameters,
		token: FlattenedJWSInput
	) => {
		await this.ensureLoaded();
		const resolve = this.resolver;
		if (!resolve) throw new TokenError('jwks_unavailable');
		try {
			return await resolve(header, token);
		} catch (error) {
			if (
				error instanceof errors.JWKSNoMatchingKey &&
				(await this.refreshIfAllowed())
			) {
				// Resolve with the freshly loaded JWKS; if it does not match
				// again, the key is unknown.
				return this.resolver!(header, token);
			}
			throw error;
		}
	};

	private async ensureLoaded(): Promise<void> {
		const ttl = this.options.ttlMs ?? 3_600_000;
		if (!this.jwks) {
			if (!(await this.refresh()))
				throw new TokenError('jwks_unavailable');
			return;
		}
		if (this.now() - this.fetchedAt > ttl) {
			// Stale: renew, keep the old one on failure.
			await this.refresh();
		}
	}

	private async refreshIfAllowed(): Promise<boolean> {
		const interval = this.options.unknownKidRefreshMinIntervalMs ?? 30_000;
		if (this.now() - this.lastAttempt < interval) return false;
		return this.refresh();
	}

	private refresh(): Promise<boolean> {
		this.inflight ??= this.load().finally(() => {
			this.inflight = undefined;
		});
		return this.inflight;
	}

	private async load(): Promise<boolean> {
		this.lastAttempt = this.now();
		try {
			const response = await (this.options.fetchImpl ?? fetch)(
				this.options.url,
				{
					headers: { accept: 'application/json' },
					signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
				}
			);
			if (!response.ok) return false;
			const text = await response.text();
			if (text.length > MAX_BODY_BYTES) return false;
			const parsed = JSON.parse(text) as unknown;
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				!Array.isArray((parsed as { keys?: unknown }).keys)
			) {
				return false;
			}
			this.jwks = parsed as JSONWebKeySet;
			this.resolver = createLocalJWKSet(this.jwks);
			this.fetchedAt = this.now();
			return true;
		} catch {
			return false;
		}
	}
}
