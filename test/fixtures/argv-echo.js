'use strict';
// Writes argv[2] (the first user argument) to the file named in ARGV_OUT.
// Not to stdout: ConPTY wraps and escapes terminal output, so the bytes
// would not compare cleanly.
const fs = require('node:fs');
fs.writeFileSync(process.env.ARGV_OUT, process.argv[2] === undefined ? '' : process.argv[2], 'utf8');
