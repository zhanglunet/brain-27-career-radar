import assert from "node:assert/strict";
import test from "node:test";

import { translatePaperText } from "../lib/paper-translator.ts";

test("translates English paper text with the configured Workers AI model", async () => {
  const calls = [];
  const ai = {
    async run(model, input) {
      calls.push({ model, input });
      return { translated_text: "脑机接口研究" };
    },
  };

  assert.equal(await translatePaperText(ai, "  Brain-computer interface research  "), "脑机接口研究");
  assert.deepEqual(calls, [{
    model: "@cf/meta/m2m100-1.2b",
    input: { text: "Brain-computer interface research", source_lang: "en", target_lang: "zh" },
  }]);
});

test("keeps Chinese text and rejects an empty translation", async () => {
  let calls = 0;
  const ai = { async run() { calls += 1; return { translated_text: "" }; } };

  assert.equal(await translatePaperText(ai, "脑科学研究 2027"), "脑科学研究 2027");
  assert.equal(calls, 0);
  await assert.rejects(() => translatePaperText(ai, "Neuroscience"), /empty translation/);
});
