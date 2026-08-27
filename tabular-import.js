import { WEB_STAGES } from "./data-contract.js";

export const IMPORT_FIELDS = [
  { key: "company", label: "公司", required: true, aliases: ["公司", "公司名称", "单位", "企业"] },
  { key: "role_name", label: "岗位", required: true, aliases: ["岗位", "职位", "投递岗位名称", "职位名称", "role"] },
  { key: "stage", label: "阶段", aliases: ["阶段", "投递阶段", "状态", "进度"] },
  { key: "deadline", label: "截止日期", aliases: ["截止日期", "投递截止时间", "截止时间", "deadline"] },
  { key: "recommendation", label: "下一步", aliases: ["下一步", "推荐动作", "下一步动作", "待办"] },
  { key: "official_url", label: "投递链接", aliases: ["官方投递链接", "投递链接", "岗位链接", "链接", "url"] },
  { key: "category", label: "方向", aliases: ["方向", "岗位方向", "职能", "类别"] },
  { key: "jd", label: "岗位 JD / 备注", aliases: ["岗位jd", "jd", "岗位描述", "备注", "阶段备注", "备注信息"] },
  { key: "assessment_content", label: "测评内容", aliases: ["测评", "测评内容", "笔试内容", "在线测评"] },
];

const stageAliases = new Map([
  ["待确认", "待投递"], ["检索新机会", "待投递"], ["待投递", "待投递"], ["未投递", "待投递"],
  ["已投递", "筛选中"], ["筛选中", "筛选中"], ["简历筛选", "筛选中"], ["简历筛选中", "筛选中"],
  ["待测评", "待测评"], ["测评中", "待测评"], ["笔试", "待测评"], ["在线测评", "待测评"],
  ["面试中", "面试中"],
]);

export const normalizeHeader = value => String(value ?? "").trim().toLowerCase().replace(/[\s_\-\/（）()【】\[\]：:]/g, "");
export const displayValue = value => value == null ? "" : value instanceof Date ? formatDate(value) : String(value).trim();

export function defaultMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  return Object.fromEntries(IMPORT_FIELDS.map(field => [field.key, field.aliases.map(normalizeHeader).map(alias => normalized.indexOf(alias)).find(index => index >= 0) ?? -1]));
}

export function parseCsv(text) {
  const rows = [[]]; let value = ""; let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]; const next = source[index + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { rows.at(-1).push(value); value = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index += 1; rows.at(-1).push(value); rows.push([]); value = ""; continue; }
    value += char;
  }
  rows.at(-1).push(value);
  return rows.filter(row => row.some(cell => displayValue(cell)));
}

export function formatDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const source = displayValue(value).replace(/[年月]/g, "-").replace(/日/g, "").replace(/[./]/g, "-");
  const match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(`${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`);
  return Number.isNaN(date.valueOf()) || date.getMonth() + 1 !== month || date.getDate() !== day ? null : `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function keyFor(company, role) { return `${String(company).trim().toLocaleLowerCase("zh-CN")}\u0000${String(role).trim().toLocaleLowerCase("zh-CN")}`; }
function rowValue(row, mapping, key) { const index = mapping[key]; return index == null || index < 0 ? "" : displayValue(row[index]); }
function normalizeStage(value) {
  const source = displayValue(value);
  if (!source) return { stage: "待投递", conversion: null };
  const stage = stageAliases.get(normalizeHeader(source));
  return stage ? { stage, conversion: stage === source ? null : `“${source}”已转换为“${stage}”` } : { stage: "待投递", conversion: `“${source}”无法识别，已设为“待投递”` };
}

export function buildImportPlan({ headers, rows, mapping, existingPositions = [], duplicatePolicy = "skip" }) {
  const existing = new Set(existingPositions.filter(position => !position.deleted_at).map(position => keyFor(position.company, position.role_name)));
  const imported = new Set(); const records = []; const skipped = []; const warnings = []; const conversions = [];
  const unmappedHeaders = headers.map(displayValue).filter((header, index) => header && !Object.values(mapping).includes(index));
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!row.some(cell => displayValue(cell))) return;
    const company = rowValue(row, mapping, "company"); const role_name = rowValue(row, mapping, "role_name");
    if (!company || !role_name) { skipped.push({ rowNumber, reason: "缺少公司或岗位" }); return; }
    const stageInfo = normalizeStage(rowValue(row, mapping, "stage"));
    const deadlineRaw = rowValue(row, mapping, "deadline"); const deadlineDate = deadlineRaw ? formatDate(row[mapping.deadline]) : null;
    if (deadlineRaw && !deadlineDate) warnings.push(`第 ${rowNumber} 行的截止日期无法识别，已留空。`);
    if (stageInfo.conversion) conversions.push(`第 ${rowNumber} 行：${stageInfo.conversion}`);
    const duplicate = existing.has(keyFor(company, role_name)) || imported.has(keyFor(company, role_name));
    if (duplicate && duplicatePolicy === "skip") { skipped.push({ rowNumber, reason: "与现有或本次导入岗位重复" }); return; }
    imported.add(keyFor(company, role_name));
    records.push({ company, role_name, stage: WEB_STAGES.includes(stageInfo.stage) ? stageInfo.stage : "待投递", deadline: deadlineDate ? `${deadlineDate}T23:59:00+08:00` : "", recommendation: rowValue(row, mapping, "recommendation"), official_url: rowValue(row, mapping, "official_url"), category: rowValue(row, mapping, "category"), jd: rowValue(row, mapping, "jd"), assessment_content: rowValue(row, mapping, "assessment_content"), rowNumber, duplicate });
  });
  return { records, skipped, warnings, conversions, unmappedHeaders };
}
