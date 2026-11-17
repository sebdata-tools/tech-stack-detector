// `npm test`: runs the unit tests in lib.test.js when the saved responses they read are present
// in test/fixtures/. Those files are copies of third-party pages and API answers and are not
// redistributed in this repository, so without them this prints a note and exits cleanly.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const dir = new URL('./fixtures/', import.meta.url);
if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
    console.log('Unit tests skipped: test/fixtures/ is not part of this repository (see README, "Tests").');
    console.log('For a live check run: node test/run_local.mjs @input.json');
    process.exit(0);
}
const run = spawnSync(process.execPath, ['--test', 'test/lib.test.js'], { stdio: 'inherit' });
process.exit(run.status ?? 1);
