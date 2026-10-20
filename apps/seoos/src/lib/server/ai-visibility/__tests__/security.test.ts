import { test } from "node:test";
import assert from "node:assert/strict";

import { guardedLookup, isPrivateAddress, SafeFetchError, validateUrl } from "../safe-fetch";

test("private / reserved address detection", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.72.14", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("URL validation rejects schemes, credentials, ports and internal hosts", () => {
  for (const u of ["file:///etc/passwd", "ftp://x.com", "http://user:pw@x.com", "http://x.com:8080", "http://localhost/", "http://169.254.169.254/latest", "http://[::1]/", "http://metadata.google.internal/", "javascript:alert(1)"]) {
    assert.throws(() => validateUrl(u), SafeFetchError, u);
  }
  assert.equal(validateUrl("example.com").toString(), "https://example.com/");
});

test("guarded DNS lookup refuses names that resolve to private addresses (rebinding-safe)", async () => {
  const err = await new Promise<Error | null>((resolve) => guardedLookup("localhost", {}, (e) => resolve(e)));
  assert.ok(err, "localhost must be refused");
  assert.match(err!.message, /private or reserved/);
});

test("redirect to a private address is refused", async () => {
  // Directly exercise the redirect validator used between hops.
  assert.throws(() => validateUrl(new URL("http://169.254.169.254/", "https://example.com").toString()), SafeFetchError);
});
