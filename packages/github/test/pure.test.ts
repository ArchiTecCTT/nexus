import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSafePushArgs,
  cleanOutput,
  extractPullRequestUrl,
  isGitHubError,
  parseGhAuthStatus,
  protocolConfigArgs,
  remoteProtocol,
} from "../src/index.ts";

test("remoteProtocol : schémas, scp, helpers, chemins locaux", () => {
  assert.equal(remoteProtocol("https://github.com/o/r.git"), "https");
  assert.equal(remoteProtocol("ssh://git@github.com/o/r.git"), "ssh");
  assert.equal(remoteProtocol("git+ssh://git@github.com/o/r.git"), "ssh");
  assert.equal(remoteProtocol("git@github.com:o/r.git"), "ssh");
  assert.equal(remoteProtocol("file:///tmp/r.git"), "file");
  assert.equal(remoteProtocol("/tmp/r.git"), "file");
  assert.equal(remoteProtocol("ext::sh -c touch% /tmp/pwned"), "ext");
  assert.equal(remoteProtocol("http://example.com/r.git"), "http");
  assert.equal(remoteProtocol(""), "unknown");
});

test("assertSafePushArgs : aucune option de force, suppression, miroir ou refspec forcé", () => {
  assertSafePushArgs(["--porcelain", "--no-verify", "--no-recurse-submodules", "origin", "abc:refs/heads/x"]);
  for (const bad of [
    "--force",
    "--force-with-lease",
    "--force-with-lease=x",
    "--force-if-includes",
    "-f",
    "-uf",
    "--delete",
    "-d",
    "--mirror",
    "--prune",
    "+main",
    ":main",
    "--all",
    "--tags",
  ]) {
    assert.throws(
      () => assertSafePushArgs(["origin", bad]),
      (e) => isGitHubError(e, "invalid_argument"),
      bad,
    );
  }
});

test("protocolConfigArgs : tout interdit puis autorisation explicite", () => {
  assert.deepEqual(protocolConfigArgs(["https", "ssh"]), [
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.https.allow=always",
    "-c",
    "protocol.ssh.allow=always",
  ]);
});

test("extractPullRequestUrl et cleanOutput", () => {
  assert.equal(extractPullRequestUrl("Creating…\nhttps://github.com/o/r/pull/7\n"), "https://github.com/o/r/pull/7");
  assert.equal(
    extractPullRequestUrl("https://ghe.corp.example:8443/team/app/pull/123"),
    "https://ghe.corp.example:8443/team/app/pull/123",
  );
  assert.equal(extractPullRequestUrl("aucune url"), null);
  const c = cleanOutput(`fatal: https://x:ghp_${"a".repeat(36)}@github.com/o/r\n\u001b[31m`, 500);
  assert.ok(!c.includes("ghp_a") && !c.includes("\u001b"));
  assert.match(c, /https:\/\/github\.com\/o\/r/);
});

test("parseGhAuthStatus : cas connus et indéterminé", () => {
  const ok = parseGhAuthStatus("github.com\n  ✓ Logged in to github.com account octo (keyring)", 0);
  assert.equal(ok.state, "authenticated");
  const failed = parseGhAuthStatus("github.com\n  X Failed to log in to github.com account octo (keyring)", 1);
  assert.equal(failed.state, "unauthenticated");
  const weird = parseGhAuthStatus("quelque chose d'inattendu", 2);
  assert.equal(weird.state, "unknown");
});
