import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envLocal = join(root, '.env.local');

if (existsSync(envLocal)) {
  loadDotenv({ path: envLocal });
} else {
  console.warn('[aegis-loop] No .env.local found — copy .env.example to .env.local');
}
