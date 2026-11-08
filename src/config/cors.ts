import { CORS_ORIGIN } from 'globals';

/// Which browser origins may call this backend, comma-separated. Without
/// `CORS_ORIGIN` none may: the desktop client sends no `Origin` and is not
/// affected, a web frontend has to be listed explicitly.
const config: { origin: false | string[]; credentials: boolean } = {
	origin: CORS_ORIGIN
		? CORS_ORIGIN.split(',')
				.map((o) => o.trim())
				.filter(Boolean)
		: false,
	credentials: true,
};

export default config;
