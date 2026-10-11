#!/usr/bin/env node
// Fausse CLI Claude : rejoue un flux stream-json et enregistre argv + stdin pour vérification.
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("2.1.296 (Claude Code)");
  process.exit(0);
}
const stdin = readFileSync(0, "utf8");
if (process.env.FAKE_RECORD)
  writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args, stdin, envKeys: Object.keys(process.env) }));
const scenario = process.env.FAKE_SCENARIO ?? "ok";
if (scenario === "slow") {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s-slow" }));
  setInterval(() => {}, 1000);
} else {
  const file = new URL(`./claude-stream-${scenario === "ok" ? "ok" : "not-logged-in"}.jsonl`, import.meta.url);
  process.stdout.write(readFileSync(file, "utf8"));
  process.exit(scenario === "ok" ? 0 : 1);
}
