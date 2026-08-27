export const DATA_CONTRACT = "job-pipeline-data/v1";
export const WEB_STAGES = ["待投递", "筛选中", "待测评", "面试中"];
export const WEB_TRANSITIONS = {
  待投递: ["筛选中"],
  筛选中: ["待测评", "面试中"],
  待测评: ["筛选中", "面试中"],
  面试中: ["面试中"],
};

const DEFAULT_FACTS = `# 网申通用事实表

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 姓名 | 待填写 |
| 手机 | 待填写 |
| 邮箱 | 待填写 |

## 教育经历

请填写学校、专业、学历和起止时间。

## 实习经历

请填写可复用的实习经历事实。

## 项目经历

请填写项目背景、行动和结果。

## 常用网申答案

请整理自我介绍、求职动机等常用答案。
`;

export const DEFAULT_COLUMNS = [
  ["company", "公司", "text", "company", 145, []],
  ["role_name", "岗位", "text", "role_name", 205, []],
  ["recommendation", "推荐动作", "select", "recommendation", 115, ["立即投递", "补信息", "等开放", "准备测评", "准备面试", "跟进", "复盘", "暂不投", "尽快投递"]],
  ["stage", "当前阶段", "select", "stage", 105, []],
  ["deadline", "截止 / 提醒", "datetime", "deadline", 190, []],
  ["final_result", "结果", "select", "final_result", 100, ["未定", "通过", "挂了", "放弃", "岗位关闭", "资格不符", "已 Offer"]],
  ["resume_version", "投递简历", "resume", "resume_version", 190, []],
  ["official_url", "投递链接", "url", "official_url", 205, []],
  ["jd", "岗位 JD", "textarea", "jd", 345, []],
];

export const isoNow = () => new Date().toISOString();
export const canWebTransition = (from, to) => from === to || Boolean(WEB_TRANSITIONS[from]?.includes(to));

function columnsAt(timestamp) {
  return DEFAULT_COLUMNS.map(([column_key, label, kind, source_field, width, options], position) => ({
    id: position + 1, column_key, label, kind, source_field, position, width, options,
    local_revision: 1, created_at: timestamp, updated_at: timestamp, deleted_at: null,
  }));
}

export function createWebState() {
  const timestamp = isoNow();
  return {
    contract: DATA_CONTRACT,
    metadata: { schemaVersion: 2, mode: "local", revision: 0, createdAt: timestamp, updatedAt: timestamp, lastBackupAt: null },
    counters: { position: 0, column: DEFAULT_COLUMNS.length, intent: 0, round: 0, event: 0, discovery: 0 },
    positions: [], columns: columnsAt(timestamp), intents: [], interviewRounds: [], events: [], sources: [],
    applicationFacts: { source: DEFAULT_FACTS, revision: 1, updatedAt: timestamp },
    discoveryRun: null,
  };
}

export function migrateWebState(value) {
  if (!value || value.contract !== DATA_CONTRACT) throw new Error("导入文件不是 job-pipeline-data/v1 格式。");
  const state = structuredClone(value);
  const timestamp = isoNow();
  state.metadata ||= {};
  state.positions ||= [];
  state.interviewRounds ||= [];
  state.events ||= [];
  state.intents ||= [];
  state.sources ||= [];
  state.columns ||= columnsAt(timestamp);
  state.applicationFacts ||= { source: DEFAULT_FACTS, revision: 1, updatedAt: timestamp };
  state.discoveryRun ||= null;

  const idMap = new Map();
  state.positions.forEach((position, index) => {
    const next = index + 1;
    idMap.set(String(position.id), next);
    position.id = next;
    position.local_revision = Number(position.local_revision) || 1;
    position.custom_values ||= {};
  });
  (state.assessments || []).forEach(assessment => {
    const positionId = idMap.get(String(assessment.position_id)) ?? Number(assessment.position_id);
    const linked = state.positions.find(position => position.id === positionId);
    if (!linked) return;
    linked.assessment_content ||= [assessment.title, assessment.notes].filter(Boolean).join("｜");
    linked.deadline ||= assessment.due_at || "";
  });
  state.interviewRounds.forEach((round, index) => {
    round.id = index + 1;
    round.position_id = idMap.get(String(round.position_id)) ?? Number(round.position_id);
    round.sequence ||= index + 1;
    round.label ||= round.stage || `第 ${round.sequence} 轮`;
    round.result ||= "未定";
    round.transcript_ref ||= round.notes || "";
  });
  state.events.forEach((event, index) => {
    event.id = index + 1;
    event.position_id = event.position_id == null ? null : idMap.get(String(event.position_id)) ?? Number(event.position_id);
  });
  state.intents.forEach((intent, index) => {
    intent.id = index + 1;
    intent.position_id = intent.position_id == null ? null : idMap.get(String(intent.position_id)) ?? Number(intent.position_id);
  });
  state.columns.forEach((column, index) => {
    column.id = index + 1;
    column.position = index;
    column.local_revision = Number(column.local_revision) || 1;
    column.options ||= [];
  });
  state.counters = {
    position: state.positions.length, column: state.columns.length, intent: state.intents.length,
    round: state.interviewRounds.length, event: state.events.length, discovery: Number(state.discoveryRun?.id) || 0,
  };
  state.metadata.schemaVersion = 2;
  return state;
}

export function assertWebState(value) {
  if (!value || value.contract !== DATA_CONTRACT || !value.metadata || !Array.isArray(value.positions) || !Array.isArray(value.columns) || !Array.isArray(value.intents) || !Array.isArray(value.interviewRounds) || !Array.isArray(value.events)) throw new Error("导入文件不是 job-pipeline-data/v1 格式。");
  const ids = new Set();
  for (const position of value.positions) {
    if (!Number.isInteger(position.id) || !position.company || !position.role_name || !WEB_STAGES.includes(position.stage)) throw new Error("导入文件含无效岗位记录。");
    if (ids.has(position.id)) throw new Error("导入文件含重复岗位 ID。");
    ids.add(position.id);
  }
  for (const round of value.interviewRounds) if (!Number.isInteger(round.id) || !ids.has(round.position_id)) throw new Error("导入文件含无效面试记录。");
  return value;
}

export function normalizeWebImport(value) {
  const state = migrateWebState(value);
  assertWebState(state);
  state.metadata = { ...createWebState().metadata, ...state.metadata, schemaVersion: 2, mode: "local", revision: Number(state.metadata.revision) || 0, updatedAt: isoNow() };
  return state;
}
