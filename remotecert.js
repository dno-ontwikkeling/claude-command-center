'use strict';

// ---------------------------------------------------------------------------
// Self-signed TLS cert for the remote-access server. No electron dependency
// (see test/remoteserver.test.js). The phone pins this exact cert's SHA-256
// fingerprint (carried in the pairing QR), so the cert is persisted and reused
// across restarts — regenerating it un-pairs every phone. Because the phone
// pins the leaf and ignores expiry, a long validity is fine.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const selfsigned = require('selfsigned');
const { normalizeFingerprint } = require('./remoteauth');

const CERT_FILE = 'remote-cert.pem';
const KEY_FILE = 'remote-key.pem';
const VALIDITY_YEARS = 10;

function fingerprintOf(certPem) {
  return normalizeFingerprint(new crypto.X509Certificate(certPem).fingerprint256);
}

function sanList(hosts) {
  const all = [...new Set([...(hosts || []).filter(Boolean), 'localhost', '127.0.0.1'])];
  return all.map((h) => (net.isIP(h) ? { type: 7, ip: h } : { type: 2, value: h }));
}

async function generate(hosts) {
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + VALIDITY_YEARS);
  // selfsigned v5 is async-only; `days` was replaced by notBefore/notAfterDate.
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Command Center Remote' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [{ name: 'subjectAltName', altNames: sanList(hosts) }],
  });
  return { cert: pems.cert, key: pems.private };
}

function writeAtomic(file, data, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

function save(dir, { cert, key }) {
  fs.mkdirSync(dir, { recursive: true });
  // Key first: a crash between the two writes leaves a cert without its key,
  // which load() treats as missing and regenerates.
  writeAtomic(path.join(dir, KEY_FILE), key, 0o600);
  writeAtomic(path.join(dir, CERT_FILE), cert, 0o644);
}

function load(dir) {
  try {
    const cert = fs.readFileSync(path.join(dir, CERT_FILE), 'utf8');
    const key = fs.readFileSync(path.join(dir, KEY_FILE), 'utf8');
    // Validate both parse and belong together before trusting them.
    const x = new crypto.X509Certificate(cert);
    if (!x.checkPrivateKey(crypto.createPrivateKey(key))) return null;
    return { cert, key };
  } catch {
    return null;
  }
}

// Reuse the persisted cert, or create one. `hosts` (IPs / DNS names the phone
// may connect to) only matters at creation; the pin, not the SAN, is what the
// phone trusts.
async function loadOrCreateCert(dir, { hosts = [] } = {}) {
  let pems = load(dir);
  if (!pems) {
    pems = await generate(hosts);
    save(dir, pems);
  }
  return { ...pems, fingerprint: fingerprintOf(pems.cert) };
}

async function regenerateCert(dir, { hosts = [] } = {}) {
  const pems = await generate(hosts);
  save(dir, pems);
  return { ...pems, fingerprint: fingerprintOf(pems.cert) };
}

module.exports = { loadOrCreateCert, regenerateCert, fingerprintOf };
