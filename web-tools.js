import { createWebState, isoNow, normalizeWebImport } from "./data-contract.js";
import { readBrowserState, replaceBrowserState, updateBrowserState } from "./browser-api.js";
import { IMPORT_FIELDS, buildImportPlan, defaultMapping, displayValue, parseCsv } from "./tabular-import.js";

const $ = selector => document.querySelector(selector);
let callbacks;
let draft = null;

function markup() {
  return `
    <input id="webTableFile" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    <input id="webJsonFile" type="file" accept=".json,application/json" hidden>
    <input id="factsMarkdownFile" type="file" accept=".md,.markdown,text/markdown,text/plain" hidden>
    <dialog id="webDataDialog" class="editor-dialog web-data-dialog">
      <form method="dialog"><header><div><span class="eyebrow">BROWSER DATA</span><h2>导入与备份</h2></div><button class="dialog-close" type="button" data-web-close aria-label="关闭">×</button></header>
      <p class="web-data-copy">Excel、CSV 和 Markdown 只在当前浏览器中读取，不会上传。</p>
      <div class="web-data-actions">
        <button id="chooseTableFile" class="primary" type="button">导入 Excel / CSV</button>
        <button id="exportJson" type="button">导出 JSON 备份</button>
        <button id="chooseJsonFile" type="button">恢复 JSON</button>
        <button id="clearBrowserData" class="danger-action" type="button">清空浏览器数据</button>
      </div><footer><span></span><button type="button" data-web-close>关闭</button></footer></form>
    </dialog>
    <dialog id="tableImportDialog" class="editor-dialog web-table-import-dialog">
      <form method="dialog"><header><div><span class="eyebrow">TABLE IMPORT</span><h2 id="tableImportTitle">导入表格</h2></div><button class="dialog-close" type="button" data-import-close aria-label="关闭">×</button></header>
      <div id="tableImportContent"></div>
      <footer><span></span><button type="button" data-import-close>取消</button><button id="confirmTableImport" class="primary" type="button">确认导入</button></footer></form>
    </dialog>`;
}

function downloadJson(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function sheetsFrom(file) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return [{ name: "CSV", rows: parseCsv(await file.text()) }];
  if (!/\.xlsx$/i.test(file.name)) throw new Error("请选择 .xlsx 或 .csv 文件。");
  if (typeof globalThis.readXlsxFile !== "function") throw new Error("Excel 解析器未载入，请刷新页面。");
  const parsed = await globalThis.readXlsxFile(file);
  return parsed[0]?.data ? parsed.map(sheet => ({ name: sheet.name || "工作表", rows: sheet.data })) : [{ name: "工作表", rows: parsed }];
}

function table(sheet) {
  const headerIndex = sheet.rows.findIndex(row => row.some(displayValue));
  return headerIndex < 0 ? { headers: [], rows: [] } : { headers: sheet.rows[headerIndex].map(displayValue), rows: sheet.rows.slice(headerIndex + 1) };
}

function plan() {
  const selected = table(draft.sheets[draft.sheetIndex]);
  return buildImportPlan({ headers: selected.headers, rows: selected.rows, mapping: draft.mapping, existingPositions: draft.strategy === "replace" ? [] : draft.existing, duplicatePolicy: draft.duplicatePolicy });
}

function renderImport() {
  const selected = table(draft.sheets[draft.sheetIndex]);
  const current = plan();
  const pending = current.records.filter(item => item.stage === "待确认").length;
  const mapping = IMPORT_FIELDS.map(field => `<label>${field.label}${field.required ? " <em>必填</em>" : ""}<select data-map="${field.key}"><option value="-1">不导入</option>${selected.headers.map((header, index) => `<option value="${index}" ${draft.mapping[field.key] === index ? "selected" : ""}>${escapeHtml(header || `第 ${index + 1} 列`)}</option>`).join("")}</select></label>`).join("");
  const preview = current.records.slice(0, 6).map(item => `<tr><td>${item.rowNumber}</td><td>${escapeHtml(item.company)}</td><td>${escapeHtml(item.role_name)}</td><td>${escapeHtml(item.stage)}</td><td>${escapeHtml(item.deadline.slice(0, 10) || "-")}</td></tr>`).join("");
  const sheetPicker = draft.sheets.length > 1 ? `<label>工作表<select id="importSheet">${draft.sheets.map((sheet, index) => `<option value="${index}" ${index === draft.sheetIndex ? "selected" : ""}>${escapeHtml(sheet.name)}</option>`).join("")}</select></label>` : "";
  const notes = [...current.conversions, ...current.warnings, ...current.skipped.slice(0, 4).map(item => `第 ${item.rowNumber} 行：${item.reason}`)];
  $("#tableImportTitle").textContent = `导入 ${draft.fileName}`;
  $("#tableImportContent").innerHTML = `
    <div class="web-import-controls">${sheetPicker}<label>导入方式<select id="importStrategy"><option value="append">追加到当前看板</option><option value="replace" ${draft.strategy === "replace" ? "selected" : ""}>替换当前岗位</option></select></label><label>重复岗位<select id="duplicatePolicy"><option value="skip">跳过同公司同岗位</option><option value="keep" ${draft.duplicatePolicy === "keep" ? "selected" : ""}>保留全部记录</option></select></label></div>
    <section class="web-import-section"><h3>字段识别</h3><p>公司和岗位为必填项；识别不准时可手动调整。</p><div class="web-import-mapping">${mapping}</div></section>
    <section class="web-import-section"><h3>导入预览</h3><p><b>${current.records.length}</b> 条将导入，其中 <b>${pending}</b> 条进入待确认${current.skipped.length ? `，${current.skipped.length} 行跳过` : ""}。</p>
    ${notes.length ? `<ul class="web-import-messages">${notes.map(note => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
    <div class="web-import-preview"><table><thead><tr><th>行</th><th>公司</th><th>岗位</th><th>去向</th><th>截止</th></tr></thead><tbody>${preview || "<tr><td colspan=5>没有可导入记录</td></tr>"}</tbody></table></div></section>`;
  $("#confirmTableImport").disabled = current.records.length === 0;
  $("#importSheet")?.addEventListener("change", event => { draft.sheetIndex = Number(event.target.value); draft.mapping = defaultMapping(table(draft.sheets[draft.sheetIndex]).headers); renderImport(); });
  document.querySelectorAll("[data-map]").forEach(control => control.onchange = () => { draft.mapping[control.dataset.map] = Number(control.value); renderImport(); });
  $("#importStrategy").onchange = event => { draft.strategy = event.target.value; renderImport(); };
  $("#duplicatePolicy").onchange = event => { draft.duplicatePolicy = event.target.value; renderImport(); };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function addPosition(next, record) {
  const now = isoNow();
  const id = ++next.counters.position;
  const stage = record.stage === "待确认" ? "待投递" : record.stage;
  next.positions.push({
    id, company: record.company, role_name: record.role_name, stage, deadline: record.deadline, recommendation: record.recommendation || "补信息",
    official_url: record.official_url || "", category: record.category || "", jd: record.jd || "", assessment_content: record.assessment_content || "",
    assessment_start: "", final_result: "未定", resume_version: "", formal_validity: "不确定", job_natures: [], stage_notes: [record.match_reason, record.source_evidence].filter(Boolean), next_action: "", next_action_due: "",
    discovery_run_id: null, discovery_rank: null, custom_values: {}, local_revision: 1, created_at: now, updated_at: now, deleted_at: null,
  });
  return id;
}

function applyImport(next, records, replace) {
  if (replace) {
    next.positions = []; next.intents = []; next.interviewRounds = []; next.events = [];
    next.counters.position = 0; next.counters.intent = 0; next.counters.round = 0; next.counters.event = 0;
  }
  records.forEach(record => {
    if (record.stage === "待确认") {
      const evidence = [record.match_reason, record.source_evidence, "从 Excel / CSV 导入"].filter(Boolean);
      next.intents.push({ id: ++next.counters.intent, position_id: null, action: "create", payload: { ...record, stage: "待投递", stage_notes: [record.match_reason, record.source_evidence].filter(Boolean) }, evidence, status: "pending", expected_revision: null, created_at: isoNow(), decided_at: null });
      return;
    }
    const id = addPosition(next, record);
    next.events.push({ id: ++next.counters.event, position_id: id, event_type: "created", note: "从 Excel / CSV 导入", actor: "owner", created_at: isoNow() });
  });
  next.metadata.importedAt = isoNow();
}

async function chooseTable(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const current = await readBrowserState();
    const sheets = await sheetsFrom(file);
    const index = Math.max(0, sheets.findIndex(sheet => table(sheet).headers.length));
    draft = { fileName: file.name, sheets, sheetIndex: index, mapping: defaultMapping(table(sheets[index]).headers), strategy: "append", duplicatePolicy: "skip", existing: current.positions };
    $("#webDataDialog").close();
    renderImport();
    $("#tableImportDialog").showModal();
  } catch (error) { callbacks.showError(error); }
}

async function confirmImport() {
  const current = plan();
  if (!current.records.length) return;
  try {
    if (draft.strategy === "replace") {
      const snapshot = await readBrowserState();
      downloadJson(snapshot, `job-pipeline-before-import-${new Date().toISOString().slice(0, 10)}.json`);
    }
    await updateBrowserState(next => applyImport(next, current.records, draft.strategy === "replace"));
    $("#tableImportDialog").close();
    await callbacks.reload();
    callbacks.showStatus(`已导入 ${current.records.length} 条；待确认机会不会自动进入投递看板。`);
  } catch (error) { callbacks.showError(error); }
}

async function importJson(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const current = await readBrowserState();
    await replaceBrowserState(normalizeWebImport(JSON.parse(await file.text())), current.metadata.revision);
    $("#webDataDialog").close();
    await callbacks.reload();
    callbacks.showStatus("JSON 备份已恢复并读回验证。");
  } catch (error) { callbacks.showError(error); }
}

async function importMarkdown(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const source = await file.text();
    if (!source.trim()) throw new Error("Markdown 文件为空。");
    await updateBrowserState(next => { next.applicationFacts = { source, revision: next.applicationFacts.revision + 1, updatedAt: isoNow() }; });
    await callbacks.reload();
    callbacks.showStatus("Markdown 已导入，仅保存在当前浏览器。");
  } catch (error) { callbacks.showError(error); }
}

export function setupWebTools(options) {
  callbacks = options;
  document.body.insertAdjacentHTML("beforeend", markup());
  $("#webData").onclick = () => $("#webDataDialog").showModal();
  $("#chooseTableFile").onclick = () => $("#webTableFile").click();
  $("#chooseJsonFile").onclick = () => $("#webJsonFile").click();
  $("#exportJson").onclick = async () => {
    const current = await readBrowserState();
    current.metadata.lastBackupAt = isoNow();
    downloadJson(current, `job-pipeline-data-v1-${new Date().toISOString().slice(0, 10)}.json`);
    await updateBrowserState(next => { next.metadata.lastBackupAt = current.metadata.lastBackupAt; });
    callbacks.showStatus("已导出 JSON 备份。");
  };
  $("#clearBrowserData").onclick = async () => {
    if (!confirm("确认清空当前浏览器中的全部 Job Pipeline 数据？请先导出需要保留的 JSON。")) return;
    const current = await readBrowserState();
    await replaceBrowserState(createWebState(), current.metadata.revision);
    $("#webDataDialog").close();
    await callbacks.reload();
    callbacks.showStatus("浏览器本地数据已清空。");
  };
  $("#importFacts").onclick = () => $("#factsMarkdownFile").click();
  $("#webTableFile").onchange = chooseTable;
  $("#webJsonFile").onchange = importJson;
  $("#factsMarkdownFile").onchange = importMarkdown;
  $("#confirmTableImport").onclick = confirmImport;
  document.querySelectorAll("[data-web-close]").forEach(button => button.onclick = () => $("#webDataDialog").close());
  document.querySelectorAll("[data-import-close]").forEach(button => button.onclick = () => $("#tableImportDialog").close());
}

export { applyImport };
