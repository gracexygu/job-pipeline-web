export const DATA_CONTRACT = "job-pipeline-data/v1";
export const WEB_STAGES = ["待投递", "筛选中", "待测评", "面试中"];
export const WEB_TRANSITIONS = {
  待投递: ["筛选中"],
  筛选中: ["待测评", "面试中"],
  待测评: ["筛选中", "面试中"],
  面试中: ["面试中"],
};

export const WEB_COLUMNS = [
  { id: "company", label: "公司", source_field: "company", kind: "text", width: 180 },
  { id: "role", label: "岗位", source_field: "role_name", kind: "text", width: 190 },
  { id: "stage", label: "阶段", source_field: "stage", kind: "select", width: 125 },
  { id: "deadline", label: "截止 / 提醒", source_field: "deadline", kind: "datetime", width: 170 },
  { id: "recommendation", label: "下一步", source_field: "recommendation", kind: "select", width: 130 },
  { id: "official_url", label: "投递链接", source_field: "official_url", kind: "url", width: 210 },
  { id: "assessment_content", label: "测评", source_field: "assessment_content", kind: "textarea", width: 180 },
  { id: "category", label: "方向", source_field: "category", kind: "text", width: 130 },
];

export const isoNow = () => new Date().toISOString();
export const newId = prefix => prefix + "_" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "_" + Math.random().toString(16).slice(2));
export const canWebTransition = (from, to) => from === to || Boolean(WEB_TRANSITIONS[from]?.includes(to));

export function createWebState(mode = "local") {
  const timestamp = isoNow();
  return { contract: DATA_CONTRACT, metadata: { schemaVersion: 1, mode, revision: 0, createdAt: timestamp, updatedAt: timestamp, lastBackupAt: null }, positions: [], assessments: [], interviewRounds: [], events: [] };
}

export function assertWebState(value) {
  if (!value || value.contract !== DATA_CONTRACT || !value.metadata || !Array.isArray(value.positions) || !Array.isArray(value.assessments) || !Array.isArray(value.interviewRounds) || !Array.isArray(value.events)) throw new Error("导入文件不是 job-pipeline-data/v1 格式。");
  const positionIds = new Set();
  for (const position of value.positions) {
    if (!position?.id || !position.company || !position.role_name || !WEB_STAGES.includes(position.stage)) throw new Error("导入文件含无效岗位记录。");
    if (positionIds.has(position.id)) throw new Error("导入文件含重复岗位 ID。");
    positionIds.add(position.id);
  }
  for (const collection of [value.assessments, value.interviewRounds]) for (const item of collection) if (!item?.id || !positionIds.has(item.position_id)) throw new Error("导入文件含无效关联记录。");
  return value;
}

export function normalizeWebImport(value) {
  const state = migrateWebState(value);
  assertWebState(state);
  state.metadata = { ...createWebState().metadata, ...state.metadata, schemaVersion: 1, mode: state.metadata.mode === "sample" ? "sample" : "local", revision: Number(state.metadata.revision) || 0, updatedAt: isoNow(), importedAt: isoNow() };
  return state;
}

export function migrateWebState(value) {
  const state = structuredClone(value);
  if (state?.contract === DATA_CONTRACT && state.metadata?.schemaVersion === 0) {
    state.assessments ||= [];
    state.interviewRounds ||= [];
    state.events ||= [];
    state.metadata.schemaVersion = 1;
  }
  return state;
}

export function createSampleState() {
  const state = createWebState("sample");
  const timestamp = isoNow();
  const first = newId("position");
  const second = newId("position");
  state.positions = [
    { id: first, company: "星河科技", role_name: "产品培训生", stage: "待测评", deadline: "2026-09-18T18:00:00+08:00", recommendation: "准备测评", official_url: "", jd: "SAMPLE：虚构岗位说明", assessment_content: "在线能力测评", assessment_start: "", category: "产品", stage_notes: [], final_result: "未定", deleted_at: null, local_revision: 1, created_at: timestamp, updated_at: timestamp },
    { id: second, company: "远岸网络", role_name: "用户研究实习生", stage: "面试中", deadline: "2026-09-21T18:00:00+08:00", recommendation: "准备面试", official_url: "", jd: "SAMPLE：虚构岗位说明", assessment_content: "", assessment_start: "", category: "研究", stage_notes: [], final_result: "未定", deleted_at: null, local_revision: 1, created_at: timestamp, updated_at: timestamp },
  ];
  state.assessments = [{ id: newId("assessment"), position_id: first, title: "在线能力测评", due_at: "2026-09-12T18:00:00+08:00", status: "待完成", notes: "SAMPLE：虚构示例", created_at: timestamp, updated_at: timestamp }];
  state.interviewRounds = [{ id: newId("round"), position_id: second, sequence: 1, stage: "一面", scheduled_at: "2026-09-14T10:00:00+08:00", status: "待进行", notes: "SAMPLE：虚构示例", created_at: timestamp, updated_at: timestamp }];
  state.events = [{ id: newId("event"), position_id: first, type: "created", detail: "载入虚构 SAMPLE 数据", created_at: timestamp }];
  return state;
}
