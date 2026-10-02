'use strict';

// Regenerates test/fixtures/remote-proto/cert.pem + cert.json: a cert made by
// the desktop's real generator (remotecert.js) plus the fingerprint the desktop
// puts in the pairing QR. The phone app's Kotlin tests load both to prove the
// two sides compute the same pin. Only the certificate is written, never a key.
//
//   node scripts/make-fixture-cert.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { regenerateCert } = require('../remotecert');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-fixture-cert-'));
  try {
    const { cert, fingerprint } = await regenerateCert(tmp, { hosts: ['100.101.102.103'] });
    const out = path.join(__dirname, '..', 'test', 'fixtures', 'remote-proto');
    fs.writeFileSync(path.join(out, 'cert.pem'), cert);
    const json = {
      description: 'Pin for cert.pem as the desktop computes it (normalized fingerprint256) and as raw Node output.',
      fingerprint,
      fingerprint256: new crypto.X509Certificate(cert).fingerprint256,
    };
    fs.writeFileSync(path.join(out, 'cert.json'), JSON.stringify(json, null, 2) + '\n');
    console.log(`wrote cert.pem + cert.json (${fingerprint})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
