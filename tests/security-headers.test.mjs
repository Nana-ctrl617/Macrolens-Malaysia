import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("production config applies baseline security headers to every public route", () => {
  for (const [header, value] of [
    ["Content-Security-Policy", "frame-ancestors 'none'"],
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Strict-Transport-Security", "max-age=31536000"],
    ["Permissions-Policy", "geolocation=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
  ]) {
    assert.match(config, new RegExp(`${header.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}[^\\n]*${value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`));
  }
  assert.match(config, /source:\s*"\/\(\.\*\)"/);
});
