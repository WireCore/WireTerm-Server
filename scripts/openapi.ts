// Writes the OpenAPI description of the server — its own routes and
// better-auth's — to a file, for the API reference published on GitHub Pages.
//
//   npm run openapi -- site/openapi.json
//
// Needs no database: the app is only assembled, never started.
import { writeFileSync } from 'node:fs';
import fastifySwagger from '@fastify/swagger';
import app from '../src/index';
import router from '../src/config/routes';
import { auth } from '../src/lib/auth';
import { swaggerOptions } from '../src/config/apiDocs';

const target = process.argv[2] ?? 'openapi.json';

await app.register(
	fastifySwagger,
	swaggerOptions(await auth.api.generateOpenAPISchema())
);
await app.after();
router(app);
await app.ready();

writeFileSync(target, `${JSON.stringify(app.swagger(), null, '\t')}\n`);
await app.close();
console.log(`OpenAPI description written to ${target}`);
process.exit(0);
