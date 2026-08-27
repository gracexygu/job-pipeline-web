import { WEB_COLUMNS, WEB_STAGES, canWebTransition, createWebState, isoNow, normalizeWebImport } from "./data-contract.js";
import { IndexedDBStore, RevisionConflictError } from "./data-store.js";
import { addAssessment as addAssessmentRecord, addInterviewRound, createPosition, restorePosition as restorePositionRecord, softDeletePosition, updatePosition } from "./web-operations.js";
import { IMPORT_FIELDS, buildImportPlan, defaultMapping, displayValue, parseCsv } from "./tabular-import.js";

const store = new IndexedDBStore();
const channel = "BroadcastChannel" in window ? new BroadcastChannel("job-pipeline-web-sync") : null;
const state = { data: null, stage: "", q: "", recommendation: "", sort: "updated" };
let importDraft = null;
const $ = selector => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function status(message, isError = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = "notice" + (isError ? "" : " status");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "-";
}

function inputDate(value) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }
function storageDate(value) { return value ? value + ":00+08:00" : ""; }
function active(position) { return !position.deleted_at; }
function findPosition(id) { return state.data.positions.find(position => position.id === id); }
function currentPositions() { return state.data.positions.filter(active); }

function configureShell() {
  document.documentElement.dataset.mode = "web";
  document.title = "Job Pipeline Web";
  $(".brand-lockup .eyebrow").textContent = "WEB MODE";
  $(".top-tabs").innerHTML = "<button class=\"active\" type=\"button\">投递管理</button>";
  $("#refresh").insertAdjacentHTML("beforebegin", "<a class=\"web-lark-link\" href=\"https://my.feishu.cn/base/G5xUbSCRFaEViosGhntcyCWanzc?table=ldx1rDVnmT1I8eNp\" target=\"_blank\" rel=\"noreferrer\">多维表格</a>");
  $("#addColumn").remove();
  $("#positionViewSwitch").remove();
  $("#dashboardWorkspace").remove();
  $("#assessmentWorkspace").remove();
  $("#intentsWorkspace").remove();
  $("#sourcesWorkspace").remove();
  $("#interviewWorkspace").remove();
  $("#resumeView").remove();
  $("#applicationView").remove();
  $("#columnDialog").remove();
  $("#refresh").onclick = reload;
  $("#add").onclick = () => openPosition();
  $("#search").oninput = event => { state.q = event.target.value; renderRows(); };
  $("#recommendation").innerHTML = "<option value=\"\">全部动作</option><option>立即投递</option><option>补信息</option><option>尽快投递</option><option>准备测评</option><option>准备面试</option><option>跟进</option><option>复盘</option>";
  $("#recommendation").onchange = event => { state.recommendation = event.target.value; renderRows(); };
  $(".filter-tools").insertAdjacentHTML("beforeend", "<select id=\"webSort\" aria-label=\"排序\"><option value=\"updated\">最近更新</option><option value=\"deadline\">截止时间</option><option value=\"company\">公司名称</option></select><button id=\"webBackup\" class=\"secondary-action\" type=\"button\">导出 JSON</button><button id=\"webData\" class=\"secondary-action\" type=\"button\">本地数据</button>");
  $("#webSort").onchange = event => { state.sort = event.target.value; renderRows(); };
  $("#webBackup").onclick = exportData;
  $("#webData").onclick = () => $("#webDataDialog").showModal();
  $("#rowDialog").innerHTML = rowDialogMarkup();
  document.body.insertAdjacentHTML("beforeend", dataDialogMarkup() + tabularImportMarkup() + conflictDialogMarkup());
  $("#webRowForm").onsubmit = savePosition;
  $("#webAddAssessment").onclick = addAssessment;
  $("#webAddInterview").onclick = addInterview;
  $("#webDelete").onclick = softDelete;
  $("#webDataForm").onsubmit = importData;
  $("#webTableImport").onclick = () => $("#webTableImportFile").click();
  $("#webTableImportFile").onchange = openTabularImport;
  $("#webTableImportConfirm").onclick = confirmTabularImport;
  $("#webBlank").onclick = () => replaceData(createWebState(), "已切换为空白本地数据。");
  $("#webClear").onclick = clearData;
  $("#webTrash").onclick = showTrash;
  $("#webReloadConflict").onclick = () => { $("#webConflictDialog").close(); reload(); };
  document.querySelectorAll("[data-web-close]").forEach(button => button.onclick = () => button.closest("dialog").close());
  document.querySelectorAll("[data-table-import-close]").forEach(button => button.onclick = () => $("#webTableImportDialog").close());
}

function rowDialogMarkup() {
  return "<form id=\"webRowForm\" method=\"dialog\"><header><div><span class=\"eyebrow\">WEB POSITION</span><h2 id=\"webRowTitle\">新增岗位</h2></div><button class=\"dialog-close\" value=\"cancel\" aria-label=\"关闭\">×</button></header><input id=\"webRowId\" type=\"hidden\"><div class=\"dialog-grid\"><label>公司<input id=\"webCompany\" required maxlength=\"120\"></label><label>岗位<input id=\"webRole\" required maxlength=\"120\"></label></div><div class=\"dialog-grid\"><label>阶段<select id=\"webStage\"></select></label><label>截止 / 提醒<input id=\"webDeadline\" type=\"datetime-local\"></label></div><div class=\"dialog-grid\"><label>下一步<select id=\"webRecommendation\"><option>补信息</option><option>立即投递</option><option>尽快投递</option><option>准备测评</option><option>准备面试</option><option>跟进</option><option>复盘</option></select></label><label>方向<input id=\"webCategory\" maxlength=\"80\"></label></div><label>投递链接<input id=\"webUrl\" type=\"url\" placeholder=\"https://\"></label><label>岗位 JD<textarea id=\"webJd\" rows=\"4\"></textarea></label><label>测评内容<textarea id=\"webAssessmentContent\" rows=\"3\"></textarea></label><section class=\"web-related\"><div><strong>测评与面试</strong><span id=\"webRelatedSummary\"></span></div><button id=\"webAddAssessment\" class=\"secondary-action\" type=\"button\">新增测评</button><button id=\"webAddInterview\" class=\"secondary-action\" type=\"button\">新增面试轮次</button></section><footer><button id=\"webDelete\" type=\"button\" class=\"danger-action hidden\">移至回收站</button><span></span><button type=\"button\" data-web-close>取消</button><button class=\"primary\" type=\"submit\">保存</button></footer></form>";
}

function dataDialogMarkup() {
  return "<dialog id=\"webDataDialog\" class=\"editor-dialog\"><form id=\"webDataForm\" method=\"dialog\"><header><div><span class=\"eyebrow\">WEB DATA</span><h2>本地数据与恢复</h2></div><button class=\"dialog-close\" type=\"button\" data-web-close aria-label=\"关闭\">×</button></header><p class=\"web-data-copy\">数据仅保存在当前浏览器。可导入飞书导出的 Excel 或本地 Excel / CSV；JSON 用于完整恢复。</p><input id=\"webTableImportFile\" type=\"file\" accept=\".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\" hidden><label>恢复 JSON<input id=\"webImportFile\" type=\"file\" accept=\"application/json,.json\"></label><div class=\"web-data-actions\"><button id=\"webTableImport\" class=\"secondary-action\" type=\"button\">导入 Excel / CSV</button><button id=\"webBlank\" class=\"secondary-action\" type=\"button\">切换为空白本地数据</button><button id=\"webTrash\" class=\"secondary-action\" type=\"button\">查看回收站</button><button id=\"webClear\" class=\"danger-action\" type=\"button\">清空本地数据</button></div><div id=\"webTrashList\" class=\"web-trash-list\"></div><footer><span></span><button type=\"button\" data-web-close>关闭</button><button class=\"primary\" type=\"submit\">导入 JSON</button></footer></form></dialog>";
}

function tabularImportMarkup() {
  return "<dialog id=\"webTableImportDialog\" class=\"editor-dialog\"><form method=\"dialog\"><header><div><span class=\"eyebrow\">TABLE IMPORT</span><h2 id=\"webTableImportTitle\">导入表格</h2></div><button class=\"dialog-close\" type=\"button\" data-table-import-close aria-label=\"关闭\">×</button></header><div id=\"webTableImportContent\"></div><footer><span></span><button type=\"button\" data-table-import-close>取消</button><button id=\"webTableImportConfirm\" class=\"primary\" type=\"button\">确认导入</button></footer></form></dialog>";
}

function conflictDialogMarkup() {
  return "<dialog id=\"webConflictDialog\" class=\"editor-dialog\"><form method=\"dialog\"><header><div><span class=\"eyebrow\">MULTI-TAB PROTECTION</span><h2>另一标签页已更新数据</h2></div></header><p class=\"web-data-copy\">当前页面未保存。重新载入后会显示最新本地数据，避免旧页面静默覆盖。</p><footer><span></span><button id=\"webReloadConflict\" class=\"primary\" type=\"button\">重新载入</button></footer></form></dialog>";
}

function render() {
  const metadata = state.data.metadata;
  $("#importMeta").textContent = "LOCAL · 当前浏览器" + (metadata.lastBackupAt ? " · 已备份" : " · 未备份");
  renderStages();
  renderRows();
}

function renderStages() {
  const labels = ["全部", ...WEB_STAGES];
  $("#stages").innerHTML = labels.map(label => "<button class=\"" + ((label === "全部" ? !state.stage : state.stage === label) ? "active" : "") + "\" data-web-stage=\"" + label + "\">" + label + "</button>").join("");
  document.querySelectorAll("[data-web-stage]").forEach(button => button.onclick = () => { state.stage = button.dataset.webStage === "全部" ? "" : button.dataset.webStage; render(); });
}

function filtered() {
  const query = state.q.trim().toLowerCase();
  const items = currentPositions().filter(position => !state.stage || position.stage === state.stage).filter(position => !state.recommendation || position.recommendation === state.recommendation).filter(position => !query || (position.company + " " + position.role_name + " " + position.jd + " " + position.assessment_content).toLowerCase().includes(query));
  return items.sort((left, right) => state.sort === "company" ? left.company.localeCompare(right.company, "zh-CN") : state.sort === "deadline" ? (left.deadline || "9999").localeCompare(right.deadline || "9999") : right.updated_at.localeCompare(left.updated_at));
}

function renderRows() {
  const positions = filtered();
  $("#resultCount").textContent = positions.length + " 条";
  $("#columnHeaders").innerHTML = WEB_COLUMNS.map(column => "<th style=\"width:" + column.width + "px\"><div class=\"column-heading\"><span class=\"column-label\">" + column.label + "</span></div></th>").join("") + "<th class=\"row-actions-heading\"></th>";
  $(".data-grid").style.width = "max(100%, " + WEB_COLUMNS.reduce((sum, column) => sum + column.width, 44) + "px)";
  const empty = state.data.positions.length ? "<strong>没有匹配岗位</strong><p>调整阶段或搜索词后再试。</p>" : "<strong>从第一条岗位开始</strong><p>可导入已有的飞书或 Excel 投递表，也可手动新增。</p><div><button id=\"webEmptyImport\" class=\"secondary-action\" type=\"button\">导入 Excel / CSV</button><button id=\"webEmptyAdd\" class=\"add-position\" type=\"button\">新增岗位</button></div>";
  $("#rows").innerHTML = positions.map(position => "<tr data-web-id=\"" + position.id + "\">" + WEB_COLUMNS.map(column => cell(position, column)).join("") + "<td class=\"row-actions\"><button class=\"delete-position\" data-web-edit=\"" + position.id + "\" title=\"编辑岗位\" aria-label=\"编辑岗位\">•••</button></td></tr>").join("") || "<tr class=\"no-results\"><td colspan=\"" + (WEB_COLUMNS.length + 1) + "\"><div class=\"empty\">" + empty + "</div></td></tr>";
  document.querySelectorAll("[data-web-edit]").forEach(button => button.onclick = () => openPosition(button.dataset.webEdit));
  document.querySelectorAll("[data-web-cell]").forEach(cell => cell.onclick = () => openPosition(cell.closest("tr").dataset.webId));
  $("#webEmptyImport") && ($("#webEmptyImport").onclick = () => $("#webTableImportFile").click());
  $("#webEmptyAdd") && ($("#webEmptyAdd").onclick = () => openPosition());
}

function cell(position, column) {
  const value = position[column.source_field] || "";
  if (column.source_field === "stage") return "<td class=\"editable-cell\" data-web-cell><span class=\"stage\">" + esc(value) + "</span></td>";
  if (column.source_field === "deadline") return "<td class=\"deadline-cell\" data-web-cell><span class=\"" + (isSoon(value) ? "soon" : "deadline") + "\">" + esc(formatDate(value)) + "</span></td>";
  if (column.source_field === "official_url") return "<td class=\"application-link-cell\" data-web-cell>" + (value ? "<a class=\"application-link\" href=\"" + esc(value) + "\" target=\"_blank\" rel=\"noreferrer\">" + esc(value) + "</a>" : "<button class=\"add-link\" type=\"button\">添加链接</button>") + "</td>";
  return "<td class=\"editable-cell " + (column.kind === "textarea" ? "jd-cell" : "") + "\" data-web-cell><span>" + esc(value || (column.source_field === "role_name" ? "待补岗位" : "")) + "</span></td>";
}

function isSoon(value) { return value && new Date(value).getTime() < Date.now() + 7 * 86400000; }

function openPosition(id = null) {
  const position = id ? findPosition(id) : null;
  $("#webRowId").value = position?.id || "";
  $("#webRowTitle").textContent = position ? "编辑 " + position.company + " · " + position.role_name : "新增岗位";
  const options = position ? [position.stage, ...WEB_STAGES.filter(stage => canWebTransition(position.stage, stage) && stage !== position.stage)] : WEB_STAGES;
  $("#webStage").innerHTML = options.map(stage => "<option>" + stage + "</option>").join("");
  const fields = [["#webCompany", "company"], ["#webRole", "role_name"], ["#webRecommendation", "recommendation"], ["#webCategory", "category"], ["#webUrl", "official_url"], ["#webJd", "jd"], ["#webAssessmentContent", "assessment_content"]];
  fields.forEach(([selector, field]) => { $(selector).value = position?.[field] || ""; });
  $("#webDeadline").value = inputDate(position?.deadline);
  $("#webDelete").classList.toggle("hidden", !position);
  $("#webAddAssessment").disabled = !position;
  $("#webAddInterview").disabled = !position;
  $("#webRelatedSummary").textContent = position ? state.data.assessments.filter(item => item.position_id === id).length + " 项测评 · " + state.data.interviewRounds.filter(item => item.position_id === id).length + " 轮面试" : "请先保存岗位";
  $("#rowDialog").showModal();
  $("#webCompany").focus();
}

async function commit(change) {
  try {
    state.data = await store.write(change(structuredClone(state.data)), state.data.metadata.revision);
    channel?.postMessage({ type: "changed", revision: state.data.metadata.revision });
    render();
    return true;
  } catch (error) {
    if (error instanceof RevisionConflictError) { $("#webConflictDialog").showModal(); return false; }
    status(error.message, true);
    return false;
  }
}

async function savePosition(event) {
  event.preventDefault();
  const id = $("#webRowId").value;
  const existing = id ? findPosition(id) : null;
  const input = { company: $("#webCompany").value.trim(), role_name: $("#webRole").value.trim(), stage: $("#webStage").value, deadline: storageDate($("#webDeadline").value), recommendation: $("#webRecommendation").value, category: $("#webCategory").value.trim(), official_url: $("#webUrl").value.trim(), jd: $("#webJd").value.trim(), assessment_content: $("#webAssessmentContent").value.trim() };
  if (!input.company || !input.role_name) return status("公司和岗位为必填项。", true);
  if (existing && !canWebTransition(existing.stage, input.stage)) return status("不能从 " + existing.stage + " 直接流转到 " + input.stage + "。", true);
  const saved = await commit(data => existing ? updatePosition(data, id, input) : createPosition(data, input));
  if (saved) { $("#rowDialog").close(); status("已保存，并已从本地数据读回。"); }
}

async function softDelete() {
  const id = $("#webRowId").value;
  const position = findPosition(id);
  if (!position || !confirm("将「" + position.company + " · " + position.role_name + "」移至回收站？")) return;
  if (await commit(data => softDeletePosition(data, id))) { $("#rowDialog").close(); status("已移至回收站。"); }
}

async function addAssessment() {
  const id = $("#webRowId").value;
  await commit(data => addAssessmentRecord(data, id));
  openPosition(id);
}

async function addInterview() {
  const id = $("#webRowId").value;
  await commit(data => addInterviewRound(data, id));
  openPosition(id);
}

async function parseTabularFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return [{ name: "CSV", rows: parseCsv(await file.text()) }];
  if (!/\.xlsx$/i.test(file.name)) throw new Error("请选择 .xlsx 或 .csv 文件。" );
  if (typeof globalThis.readXlsxFile !== "function") throw new Error("Excel 解析器未能载入，请刷新页面后重试。" );
  const parsed = await globalThis.readXlsxFile(file);
  return parsed[0]?.data ? parsed.map(sheet => ({ name: sheet.name || "工作表", rows: sheet.data })) : [{ name: "工作表", rows: parsed }];
}

function selectedSheet() { return importDraft.sheets[importDraft.sheetIndex]; }

function tableForSheet(sheet) {
  const headerIndex = sheet.rows.findIndex(row => row.some(cell => displayValue(cell)));
  return headerIndex < 0 ? { headers: [], rows: [] } : { headers: sheet.rows[headerIndex].map(displayValue), rows: sheet.rows.slice(headerIndex + 1) };
}

function tableImportPlan() {
  const { headers, rows } = tableForSheet(selectedSheet());
  return buildImportPlan({ headers, rows, mapping: importDraft.mapping, existingPositions: importDraft.strategy === "replace" ? [] : state.data.positions, duplicatePolicy: importDraft.duplicatePolicy });
}

function renderTabularImport() {
  const { headers } = tableForSheet(selectedSheet());
  const plan = tableImportPlan();
  $("#webTableImportTitle").textContent = "导入 " + importDraft.fileName;
  const sheetSelect = importDraft.sheets.length > 1 ? `<label>工作表<select id="webImportSheet">${importDraft.sheets.map((sheet, index) => `<option value="${index}" ${index === importDraft.sheetIndex ? "selected" : ""}>${esc(sheet.name)}（${Math.max(sheet.rows.length - 1, 0)} 行）</option>`).join("")}</select></label>` : "";
  const mapping = IMPORT_FIELDS.map(field => `<label>${field.label}${field.required ? " <em>必填</em>" : ""}<select data-import-field="${field.key}"><option value="-1">不导入</option>${headers.map((header, index) => `<option value="${index}" ${importDraft.mapping[field.key] === index ? "selected" : ""}>${esc(header || `第 ${index + 1} 列`)}</option>`).join("")}</select></label>`).join("");
  const messages = [...plan.conversions, ...plan.warnings, ...plan.skipped.slice(0, 3).map(item => `第 ${item.rowNumber} 行：${item.reason}`)];
  const preview = plan.records.slice(0, 5).map(record => `<tr><td>${record.rowNumber}</td><td>${esc(record.company)}</td><td>${esc(record.role_name)}</td><td>${esc(record.stage)}</td><td>${esc(record.deadline ? record.deadline.slice(0, 10) : "-")}</td></tr>`).join("");
  $("#webTableImportContent").innerHTML = `<div class="web-import-controls">${sheetSelect}<label>导入方式<select id="webImportStrategy"><option value="append" ${importDraft.strategy === "append" ? "selected" : ""}>追加到当前看板</option><option value="replace" ${importDraft.strategy === "replace" ? "selected" : ""}>替换当前岗位</option></select></label><label>重复岗位<select id="webDuplicatePolicy"><option value="skip" ${importDraft.duplicatePolicy === "skip" ? "selected" : ""}>跳过同公司同岗位</option><option value="keep" ${importDraft.duplicatePolicy === "keep" ? "selected" : ""}>保留全部记录</option></select></label></div><section class="web-import-section"><h3>字段识别</h3><p>公司和岗位为必填项，可按你的表头调整。</p><div class="web-import-mapping">${mapping}</div></section><section class="web-import-section"><h3>导入预览</h3><p><b>${plan.records.length}</b> 条岗位将导入${plan.skipped.length ? `，${plan.skipped.length} 行将跳过` : ""}。</p>${plan.unmappedHeaders.length ? `<p class="web-import-warning">未映射列：${esc(plan.unmappedHeaders.join("、"))}</p>` : ""}${messages.length ? `<ul class="web-import-messages">${messages.map(message => `<li>${esc(message)}</li>`).join("")}</ul>` : ""}<div class="web-import-preview"><table><thead><tr><th>行</th><th>公司</th><th>岗位</th><th>阶段</th><th>截止</th></tr></thead><tbody>${preview || "<tr><td colspan=5>没有可导入的岗位，请检查必填字段映射。</td></tr>"}</tbody></table></div></section>`;
  $("#webTableImportConfirm").disabled = plan.records.length === 0;
  $("#webImportSheet")?.addEventListener("change", event => { importDraft.sheetIndex = Number(event.target.value); importDraft.mapping = defaultMapping(tableForSheet(selectedSheet()).headers); renderTabularImport(); });
  document.querySelectorAll("[data-import-field]").forEach(select => select.onchange = () => { importDraft.mapping[select.dataset.importField] = Number(select.value); renderTabularImport(); });
  $("#webImportStrategy").onchange = event => { importDraft.strategy = event.target.value; renderTabularImport(); };
  $("#webDuplicatePolicy").onchange = event => { importDraft.duplicatePolicy = event.target.value; renderTabularImport(); };
}

async function openTabularImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const sheets = await parseTabularFile(file);
    const first = sheets.find(sheet => tableForSheet(sheet).headers.length) || sheets[0];
    importDraft = { fileName: file.name, sheets, sheetIndex: sheets.indexOf(first), mapping: defaultMapping(tableForSheet(first).headers), strategy: "append", duplicatePolicy: "skip" };
    $("#webDataDialog").close();
    renderTabularImport();
    $("#webTableImportDialog").showModal();
  } catch (error) { status(error.message || "无法读取文件。", true); }
  event.target.value = "";
}

async function confirmTabularImport() {
  const plan = tableImportPlan();
  if (!plan.records.length) return;
  const backupAt = isoNow();
  if (importDraft.strategy === "replace" && currentPositions().length) {
    const backup = structuredClone(state.data);
    backup.metadata.lastBackupAt = backupAt;
    downloadJson(backup, "job-pipeline-before-import-" + backupAt.slice(0, 10) + ".json");
  }
  let next = importDraft.strategy === "replace" ? createWebState() : structuredClone(state.data);
  for (const record of plan.records) next = createPosition(next, record);
  next.metadata = { ...next.metadata, mode: "local", lastBackupAt: importDraft.strategy === "replace" && currentPositions().length ? backupAt : next.metadata.lastBackupAt };
  const saved = await commit(() => next);
  if (saved) { $("#webTableImportDialog").close(); status(`已导入 ${plan.records.length} 条岗位${plan.skipped.length ? `，跳过 ${plan.skipped.length} 条` : ""}。`); }
}

async function reload() {
  try {
    const existing = await store.read();
    state.data = existing || await store.write(createWebState(), null);
    render();
  } catch (error) { status("无法读取浏览器本地数据：" + error.message, true); }
}

function downloadJson(snapshot, filename) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportData() {
  const backup = structuredClone(state.data);
  backup.metadata.lastBackupAt = isoNow();
  downloadJson(backup, "job-pipeline-data-v1-" + new Date().toISOString().slice(0, 10) + ".json");
  commit(data => ({ ...data, metadata: { ...data.metadata, lastBackupAt: backup.metadata.lastBackupAt } }));
  status("已导出 JSON 备份。");
}

async function importData(event) {
  event.preventDefault();
  const file = $("#webImportFile").files[0];
  if (!file) return status("请选择要恢复的 JSON 文件。", true);
  try {
    const imported = normalizeWebImport(JSON.parse(await file.text()));
    state.data = await store.write(imported, state.data.metadata.revision);
    channel?.postMessage({ type: "changed", revision: state.data.metadata.revision });
    $("#webDataDialog").close();
    render();
    status("已导入并从本地数据读回。");
  } catch (error) {
    if (error instanceof RevisionConflictError) $("#webConflictDialog").showModal();
    else status(error.message, true);
  }
}

async function replaceData(next, message) {
  if (!confirm("这会替换当前浏览器中的本地记录。请先导出需要保留的数据。")) return;
  try {
    state.data = await store.write(next, state.data.metadata.revision);
    channel?.postMessage({ type: "changed", revision: state.data.metadata.revision });
    $("#webDataDialog").close();
    render();
    status(message);
  } catch (error) {
    if (error instanceof RevisionConflictError) $("#webConflictDialog").showModal();
    else status(error.message, true);
  }
}

async function clearData() {
  if (!confirm("确认清空当前浏览器全部数据？只有之前导出的 JSON 才能恢复。")) return;
  await store.clear();
  state.data = await store.initialize();
  channel?.postMessage({ type: "changed", revision: state.data.metadata.revision });
  $("#webDataDialog").close();
  render();
  status("已清空本地数据。");
}

async function showTrash() {
  const trash = state.data.positions.filter(position => position.deleted_at);
  const target = $("#webTrashList");
  if (!trash.length) { target.textContent = "回收站为空。"; return; }
  target.innerHTML = trash.map(position => "<button class=\"secondary-action\" type=\"button\" data-web-restore=\"" + position.id + "\">恢复 " + esc(position.company) + " · " + esc(position.role_name) + "</button>").join("");
  target.querySelectorAll("[data-web-restore]").forEach(button => button.onclick = () => restorePosition(button.dataset.webRestore));
}

async function restorePosition(id) {
  const position = findPosition(id);
  if (!position) return;
  await commit(data => restorePositionRecord(data, position.id));
  showTrash();
}

channel && (channel.onmessage = event => {
  if (event.data.type === "changed" && event.data.revision !== state.data?.metadata.revision) status("另一标签页已更新数据；保存时将进行冲突保护。");
});

configureShell();
reload();
