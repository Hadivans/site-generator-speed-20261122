// The driver the harness runs: it reads every case from the input
// directory, answers each one alone with run() from solve.js, and writes
// the answers in order to the output directory. Each case is answered
// alone, nothing is shared between cases.

import { readFileSync as read, writeFileSync as write } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Incremental marking off, set before solve.js is imported, so all of its
// work runs under it.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const list = JSON.parse(read(join(inDir, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers = list.map((c) => run(c.input));
write(join(outDir, 'answers.json'), JSON.stringify(answers));
