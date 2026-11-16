#!/usr/bin/env node
import { main } from '../src/cli.js';
import { sinControl } from '../src/util.js';

main(process.argv.slice(2)).then(
  (codigo) => process.exit(codigo),
  (e) => {
    process.stderr.write(`Error: ${sinControl(e.message)}\n`);
    process.exit(2);
  },
);
