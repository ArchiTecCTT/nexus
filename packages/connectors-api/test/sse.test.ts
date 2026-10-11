import { test } from "node:test";
import assert from "node:assert/strict";
import { SseParser, type SseEvent } from "../src/sse.ts";
import { REDACTED, makeRedactor } from "../src/redact.ts";
import { fixture } from "./helpers.ts";

function parseAll(chunks: string[]): SseEvent[] {
  const p = new SseParser();
  return [...chunks.flatMap((c) => p.push(c)), ...p.end()];
}

test("SSE : événements, champ event, commentaires ignorés", () => {
  const evs = parseAll([": commentaire\n\nevent: ping\ndata: {}\n\ndata: a\n\n"]);
  assert.deepEqual(evs, [
    { event: "ping", data: "{}" },
    { event: "message", data: "a" },
  ]);
});

test("SSE : lignes data multiples jointes par \\n, espace initial unique retiré", () => {
  const evs = parseAll(["data: ligne1\ndata:ligne2\ndata:  deux espaces\n\n"]);
  assert.deepEqual(evs, [{ event: "message", data: "ligne1\nligne2\n deux espaces" }]);
});

test("SSE : découpage caractère par caractère identique au flux entier (LF, CRLF, CR)", () => {
  for (const name of ["openai.sse", "anthropic.sse", "google.sse", "openrouter.sse"]) {
    const body = fixture(name);
    const whole = parseAll([body]);
    assert.ok(whole.length >= 2, name);
    assert.deepEqual(parseAll([...body]), whole, `${name} découpé`);
  }
  const crlf = "data: x\r\n\r\ndata: y\r\rdata: z\n\n";
  assert.deepEqual(
    parseAll([...crlf]).map((e) => e.data),
    ["x", "y", "z"],
  );
  // CR et LF d'un même CRLF dans deux chunks : pas de ligne vide fantôme.
  assert.deepEqual(
    parseAll(["data: a\r", "\ndata: b\r", "\n\r", "\n"]).map((e) => e.data),
    ["a\nb"],
  );
});

test("SSE : [DONE] est une donnée ; dernier événement sans ligne vide toléré à la fin", () => {
  assert.deepEqual(
    parseAll(["data: [DONE]\n\ndata: fin"]).map((e) => e.data),
    ["[DONE]", "fin"],
  );
});

test("SSE : événement sans data ignoré, id conservé", () => {
  assert.deepEqual(parseAll(["event: vide\n\nid: 7\ndata: x\n\n"]), [{ event: "message", data: "x", id: "7" }]);
});

test("Expurgation : clé exacte, fragments, formes encodées et motifs génériques", () => {
  const key = "sk-proj-AbCdEf0123456789SeCrEt";
  const r = makeRedactor([key]);
  assert.equal(r(`clé ${key} invalide`), `clé ${REDACTED} invalide`);
  assert.ok(!r(`Incorrect API key provided: sk-proj-AbCd****SeCrEt`).includes("AbCd"));
  assert.ok(!r(JSON.stringify({ k: key })).includes("AbCdEf"));
  assert.ok(!makeRedactor([])("Authorization: Bearer abc.def").includes("abc.def"));
  assert.ok(!makeRedactor([])("x AIzaSyA1234567890abcdefghijklmn y").includes("AIzaSy"));
  assert.equal(r("texte ordinaire sans secret"), "texte ordinaire sans secret");
});
