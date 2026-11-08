import { describe, expect, test } from 'vitest';
import { ROUTE_DOCS, routeKey } from '../../src/config/apiDocs';
import app from '../../src/index';
import { getTestApp } from '../helpers/app';

// Registered after `documentRoutes`, so it sees each route as the reference
// will: with the tag and summary attached, or hidden.
const registered: { key: string; hidden: boolean }[] = [];
app.addHook('onRoute', (route) => {
	const methods = Array.isArray(route.method) ? route.method : [route.method];
	for (const method of methods) {
		if (method === 'HEAD') continue;
		registered.push({
			key: routeKey(method, route.url),
			hidden: Boolean(route.schema?.hide),
		});
	}
});

describe('API reference', () => {
	test('every visible route has a tag and a summary', async () => {
		await getTestApp();
		const missing = registered
			.filter((route) => !route.hidden && !(route.key in ROUTE_DOCS))
			.map((route) => route.key);
		expect(missing).toEqual([]);
	});

	test('no entry describes a route that does not exist', async () => {
		await getTestApp();
		const keys = new Set(registered.map((route) => route.key));
		expect(Object.keys(ROUTE_DOCS).filter((key) => !keys.has(key))).toEqual(
			[]
		);
	});
});
