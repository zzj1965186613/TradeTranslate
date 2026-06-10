import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/offline.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});

const source = bundle.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString(
  "base64"
)}`;
const { OFFLINE_DICTIONARY_NO_MATCH, offlineTranslate } = await import(
  moduleUrl
);

async function assertTranslation(
  text,
  sourceLang,
  targetLang,
  expected,
  customDictionary = []
) {
  const translated = await offlineTranslate(
    text,
    sourceLang,
    targetLang,
    "local-dictionary",
    customDictionary
  );
  assert.equal(translated, expected);
}

await assertTranslation("\u4f60\u597d", "zh", "en", "hello");
await assertTranslation("\u6d4b\u8bd5", "zh", "en", "test");
await assertTranslation("\u5e74\u540e", "zh", "en", "after the New Year");
await assertTranslation("\u4f60\u597d\uff0c\u6d4b\u8bd5", "zh", "en", "hello, test");
await assertTranslation(
  "\u5e74\u540e",
  "zh",
  "en",
  "after the holiday",
  [
    {
      source: "\u5e74\u540e",
      target: "after the holiday",
      sourceLang: "zh",
      targetLang: "en",
    },
  ]
);
await assertTranslation(
  "\u4f60\u597d\uff0c\u6d4b\u8bd5",
  "zh",
  "en",
  "hello, exam",
  [
    {
      source: "\u6d4b\u8bd5",
      target: "exam",
      sourceLang: "zh",
      targetLang: "en",
    },
  ]
);
await assertTranslation("hello, test", "en", "zh", "\u4f60\u597d\uff0c\u6d4b\u8bd5");

const started = Date.now();
await assert.rejects(
  () => offlineTranslate("\u706b\u661f\u8bed", "zh", "en", "local-dictionary"),
  (err) => err?.message === OFFLINE_DICTIONARY_NO_MATCH
);
assert.ok(Date.now() - started < 1500, "unknown text should fail quickly");

console.log("Offline dictionary verification passed");
