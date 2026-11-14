#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (codigo) => process.exit(codigo),
  (e) => {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(2);
  },
);
