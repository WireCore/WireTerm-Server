// The mail templates are not TypeScript, so tsc does not copy them. Without
// them `app.view` throws into the void in the container.
import { cpSync } from 'node:fs';

cpSync('src/templates', 'dist/templates', { recursive: true });
