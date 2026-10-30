// postinstall: make Next's WebAssembly compiler available offline.
//
// On hosts with an old glibc (Hostinger shared hosting, some cPanel servers)
// Next cannot load its native SWC binary and falls back to
// @next/swc-wasm-nodejs, which it expects at node_modules/next/wasm/ and
// otherwise downloads from npm during the build. We install that package as a
// normal dependency and copy it into place here so the build never depends on
// a download. No-op when the package is missing (e.g. --omit=optional).
const fs = require("node:fs");
const path = require("node:path");

function main() {
  let pkgJson;
  try {
    pkgJson = require.resolve("@next/swc-wasm-nodejs/package.json");
  } catch {
    return; // not installed; Next will download on demand if it needs it
  }
  let nextPkg;
  try {
    nextPkg = require.resolve("next/package.json");
  } catch {
    return;
  }
  const src = path.dirname(pkgJson);
  const dest = path.join(path.dirname(nextPkg), "wasm", "@next", "swc-wasm-nodejs");
  const srcVersion = require(pkgJson).version;
  const destPkg = path.join(dest, "package.json");
  if (fs.existsSync(destPkg)) {
    try {
      if (require(destPkg).version === srcVersion) return; // already in place
    } catch {
      /* fall through and re-copy */
    }
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`prepared @next/swc-wasm-nodejs ${srcVersion} at ${path.relative(process.cwd(), dest)}`);
}

try {
  main();
} catch (err) {
  // Never fail an install because of this helper.
  console.warn("prepare-wasm-swc: skipped —", err && err.message ? err.message : err);
}
