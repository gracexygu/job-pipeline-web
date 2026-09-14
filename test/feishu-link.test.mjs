import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("header keeps the Feishu Base shortcut before refresh", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const link = '<a class="web-lark-link" href="https://my.feishu.cn/base/G5xUbSCRFaEViosGhntcyCWanzc?table=ldx1rDVnmT1I8eNp" target="_blank" rel="noreferrer">多维表格</a>';

  assert.ok(html.includes(link));
  assert.ok(html.indexOf(link) < html.indexOf('id="refresh"'));
});
