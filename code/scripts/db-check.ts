import { dbConfigured, saveBlob, loadBlob, flushAll, closeDb } from '../src/db.js';

console.log('configured:', dbConfigured());
saveBlob('connection-test', { ok: true, at: new Date().toISOString() });
await flushAll();
const back = await loadBlob('connection-test');
console.log('round-trip:', JSON.stringify(back));
await closeDb();
