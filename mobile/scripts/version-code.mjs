// Semver -> Android versionCode. A sideloaded update only installs over the
// previous APK when its versionCode is higher, so the mapping must be strictly
// monotonic: major*10000 + minor*100 + patch, with minor/patch capped at 99.
//
// CLI (used by the release workflow): node scripts/version-code.mjs 1.2.3
import { fileURLToPath } from 'node:url';

const ANDROID_MAX = 2100000000;

export function versionCode(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ''));
  if (!m) throw new Error(`Not a plain semver version: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99) throw new Error(`minor ${minor} > 99 breaks the versionCode scheme`);
  if (patch > 99) throw new Error(`patch ${patch} > 99 breaks the versionCode scheme`);
  const code = major * 10000 + minor * 100 + patch;
  if (code < 1) throw new Error('versionCode must be >= 1 (0.0.0 is not releasable)');
  if (code > ANDROID_MAX) throw new Error(`versionCode ${code} exceeds Android's maximum`);
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(versionCode(process.argv[2]));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
