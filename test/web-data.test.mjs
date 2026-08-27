import test from "node:test";
import assert from "node:assert/strict";
import { createWebState, migrateWebState } from "../data-contract.js";
import { applyImport } from "../web-tools.js";
import { buildImportPlan, defaultMapping, parseCsv } from "../tabular-import.js";

test("blank state contains full browser-only collections and no sample positions", () => {
  const state = createWebState();
  assert.equal(state.positions.length, 0);
  assert.equal(state.intents.length, 0);
  assert.equal(state.columns.length, 9);
  assert.match(state.applicationFacts.source, /待填写/);
});

test("legacy string IDs migrate without breaking interview references", () => {
  const legacy = {
    contract: "job-pipeline-data/v1",
    metadata: { schemaVersion: 1, revision: 4 },
    positions: [{ id: "position_old", company: "示例公司", role_name: "示例岗位", stage: "面试中", local_revision: 1 }],
    assessments: [{ id: "assessment_old", position_id: "position_old", title: "在线测评", due_at: "2026-09-01" }],
    interviewRounds: [{ id: "round_old", position_id: "position_old", sequence: 1, stage: "一面", notes: "逐字稿-旧" }],
    events: [],
  };
  const migrated = migrateWebState(legacy);
  assert.equal(migrated.positions[0].id, 1);
  assert.equal(migrated.interviewRounds[0].position_id, 1);
  assert.equal(migrated.positions[0].assessment_content, "在线测评");
  assert.equal(migrated.interviewRounds[0].label, "一面");
  assert.equal(migrated.interviewRounds[0].transcript_ref, "逐字稿-旧");
  assert.equal(migrated.metadata.schemaVersion, 2);
});

test("spreadsheet pending rows retain evidence while formal stages become positions", () => {
  const rows = parseCsv("公司,岗位,阶段,匹配理由,来源证据\n示例甲,产品经理,待确认,方向匹配,https://example.com/source\n示例乙,AI 产品经理,待测评,,");
  const headers = rows[0];
  const plan = buildImportPlan({ headers, rows: rows.slice(1), mapping: defaultMapping(headers) });
  assert.deepEqual(plan.records.map(record => record.stage), ["待确认", "待测评"]);
  const state = createWebState();
  applyImport(state, plan.records, false);
  assert.equal(state.intents.length, 1);
  assert.equal(state.intents[0].payload.stage, "待投递");
  assert.deepEqual(state.intents[0].evidence, ["方向匹配", "https://example.com/source", "从 Excel / CSV 导入"]);
  assert.equal(state.positions.length, 1);
  assert.equal(state.positions[0].stage, "待测评");
});

test("replace import clears pipeline records but preserves columns and application facts", () => {
  const state = createWebState();
  state.positions.push({ id: 1, company: "旧公司", role_name: "旧岗位", stage: "待投递" });
  state.counters.position = 1;
  const facts = state.applicationFacts.source;
  applyImport(state, [{ company: "新公司", role_name: "新岗位", stage: "筛选中", deadline: "", recommendation: "", official_url: "", category: "", jd: "", assessment_content: "" }], true);
  assert.deepEqual(state.positions.map(item => item.company), ["新公司"]);
  assert.equal(state.columns.length, 9);
  assert.equal(state.applicationFacts.source, facts);
});
