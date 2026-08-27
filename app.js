import { markdownSections, renderMarkdownPreview } from "./markdown-preview.js";
import { browserApiFetch as fetch } from "./browser-api.js";
import { setupWebTools } from "./web-tools.js";
const validViews = ["pipeline", "resume", "application"];
const viewFromLocation = () => {
  const view = new URLSearchParams(location.search).get("view");
  if (validViews.includes(view)) return view;
  if (view) {
    const url = new URL(location.href);
    url.searchParams.delete("view");
    history.replaceState({}, "", url);
  }
  return "pipeline";
};
const storedCompanySort = localStorage.getItem("job-pipeline-company-sort");
const storedPositionView = localStorage.getItem("job-pipeline-position-view");
const state = { positions: [], columns: [], sources: [], intents: [], interviewPipelines: [], resumeLinks: new Map(), applicationFacts: null, factsEditing: false, dashboard: null, discoveryRun: null, view: viewFromLocation(), section: "positions", stage: "", positionView: storedPositionView === "dashboard" ? "dashboard" : "table", recommendation: "", companySort: storedCompanySort === "desc" ? "desc" : "asc", q: "", factsQuery: "", showSensitive: false, loading: false, notesEditing: new Set(), expandedAssessmentId: null, editingColumnId: null };
const stages = ["待确认", "检索新机会", "全部", "待投递", "筛选中", "待测评", "面试中"];
const stageTransitions = { "待投递": ["筛选中"], "筛选中": ["待测评", "面试中"], "待测评": ["筛选中"], "面试中": ["面试中"] };
const recommendations = ["立即投递", "补信息", "等开放", "准备测评", "准备面试", "跟进", "复盘", "暂不投", "尽快投递"];
const finalResults = ["未定", "通过", "挂了", "放弃", "岗位关闭", "资格不符", "已 Offer"];
const viewIds = { pipeline: "pipelineView", resume: "resumeView", application: "applicationView" };
let discoveryPoll = null;

document.querySelector("#refresh").onclick = load;
document.querySelector("#add").onclick = openRowDialog;
document.querySelector("#addColumn").onclick = () => openColumnDialog();
document.querySelector("#search").oninput = event => { state.q = event.target.value; renderRows(); renderAssessments(); };
document.querySelector("#recommendation").onchange = event => { state.recommendation = event.target.value; renderRows(); };
document.querySelector("#factsSearch").oninput = event => { state.factsQuery = event.target.value.trim().toLowerCase(); filterMarkdownPreview(); };
document.querySelector("#showSensitive").onchange = event => { state.showSensitive = event.target.checked; renderFacts(); };
document.querySelector("#editFacts").onclick = startFactsEdit;
document.querySelector("#cancelFactsEdit").onclick = cancelFactsEdit;
document.querySelector("#saveFacts").onclick = saveFacts;
document.querySelector("#factsEditor").oninput = updateFactsEditState;
document.querySelector("#factsEditor").onkeydown = event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveFacts();
  }
};
document.querySelector("#columnKind").onchange = renderColumnOptionsField;
document.querySelector("#columnForm").onsubmit = event => { event.preventDefault(); saveColumn(); };
document.querySelector("#rowForm").onsubmit = event => { event.preventDefault(); createPosition(); };
document.querySelector("#deleteColumn").onclick = deleteColumn;
document.querySelector("#moveColumnLeft").onclick = () => moveColumn(-1);
document.querySelector("#moveColumnRight").onclick = () => moveColumn(1);
document.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.onclick = () => document.querySelector(`#${button.dataset.closeDialog}`).close();
});
document.querySelectorAll("[data-position-view]").forEach(button => { button.onclick = () => switchPositionView(button.dataset.positionView); });
document.querySelectorAll("[data-view]").forEach(button => { button.onclick = () => switchView(button.dataset.view, true); });
window.addEventListener("popstate", () => {
  switchView(viewFromLocation());
});
window.addEventListener("beforeunload", event => {
  if (!state.factsEditing || document.querySelector("#factsEditor").value === state.applicationFacts?.source) return;
  event.preventDefault();
  event.returnValue = "";
});

async function load() {
  setLoading(true);
  clearNotice();
  try {
    const [bootstrap, sources, intents, interviewPipelines, resumeLinks, applicationFacts] = await Promise.all([
      getJson("/api/bootstrap"),
      getJson("/api/sources"),
      getJson("/api/intents"),
      getJson("/api/interview-pipelines"),
      listResumeLinks(),
      getJson("/api/application-facts"),
    ]);
    state.positions = bootstrap.positions;
    state.columns = bootstrap.columns;
    state.sources = sources.sources;
    state.intents = intents.intents;
    state.interviewPipelines = interviewPipelines.pipelines;
    state.resumeLinks = new Map(resumeLinks.map(link => [link.positionId, link]));
    state.applicationFacts = applicationFacts;
    state.dashboard = bootstrap.dashboard;
    state.discoveryRun = bootstrap.dashboard.discoveryRun;
    render();
  } catch (error) {
    showError(error);
  } finally {
    setLoading(false);
  }
}

function render() {
  switchView(viewFromLocation());
  renderStages();
  renderRows();
  renderDashboard();
  renderAssessments();
  renderIntents();
  renderSources();
  renderInterviewPipelines();
  renderFacts();
  scheduleDiscoveryPoll();
  const run = state.dashboard.lastImport;
  document.querySelector("#importMeta").textContent = run
    ? `当前浏览器 · 最近导入 ${new Date(run.created_at).toLocaleDateString("zh-CN")}`
    : "当前浏览器 · 尚未导入";
  renderSection();
}

function switchView(view, updateUrl = false) {
  if (!viewIds[view]) view = "pipeline";
  state.view = view;
  Object.entries(viewIds).forEach(([name, id]) => document.querySelector(`#${id}`).classList.toggle("hidden", name !== view));
  document.querySelectorAll("[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  const resume = view === "resume";
  const tool = resume || view === "application";
  document.body.classList.toggle("resume-tool-active", resume);
  document.querySelector(".header-meta").classList.toggle("hidden", tool);
  document.querySelector("#add").classList.toggle("hidden", view !== "pipeline" || state.section !== "positions");
  const frame = document.querySelector("#resumeFormatter");
  if (resume && !frame.src) frame.src = "https://gracexygu.github.io/resume-formatter/";
  if (updateUrl) {
    const url = new URL(location.href);
    if (view === "pipeline") url.searchParams.delete("view"); else url.searchParams.set("view", view);
    history.pushState({}, "", url);
  }
}

function switchPositionView(view) {
  state.positionView = view === "dashboard" ? "dashboard" : "table";
  localStorage.setItem("job-pipeline-position-view", state.positionView);
  renderPositionViewSwitch();
  renderSection();
}

function renderPositionViewSwitch() {
  document.querySelectorAll("[data-position-view]").forEach(button => {
    const active = button.dataset.positionView === state.positionView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderStages() {
  document.querySelector("#stages").innerHTML = stages.map(label => {
    const isSource = label === "检索新机会";
    const isIntent = label === "待确认";
    const isInterview = label === "面试中";
    const active = isIntent ? state.section === "intents" : isSource ? state.section === "sources" : isInterview ? state.section === "interviews" : state.section === "positions" && (label === "全部" ? "" : label) === state.stage;
    return `<button class="${active ? "active" : ""} ${isSource ? "source-tab" : ""}" data-stage="${label}" aria-pressed="${active}">${label}</button>`;
  }).join("");
  document.querySelectorAll("[data-stage]").forEach(button => button.onclick = () => {
    if (button.dataset.stage === "待确认") {
      state.section = "intents";
    } else if (button.dataset.stage === "检索新机会") {
      state.section = "sources";
    } else if (button.dataset.stage === "面试中") {
      state.section = "interviews";
      state.stage = "面试中";
    } else {
      state.section = "positions";
      state.stage = button.dataset.stage === "全部" ? "" : button.dataset.stage;
      if (state.stage) state.positionView = "table";
      if (state.stage) {
        state.recommendation = "";
        document.querySelector("#recommendation").value = "";
      }
    }
    renderStages();
    renderPositionViewSwitch();
    if (state.section === "positions") renderRows();
    renderSection();
  });
}

function renderSection() {
  const sources = state.section === "sources";
  const intents = state.section === "intents";
  const interviews = state.section === "interviews";
  const allPositions = state.section === "positions" && !state.stage;
  const dashboard = allPositions && state.positionView === "dashboard";
  const assessments = state.section === "positions" && state.stage === "待测评";
  const stageView = state.section === "positions" && Boolean(state.stage);
  document.querySelector(".filter-tools").classList.toggle("hidden", sources || intents || interviews || dashboard);
  document.querySelector(".recommendation-filter").classList.toggle("hidden", stageView);
  document.querySelector("#positionViewSwitch").classList.toggle("hidden", !allPositions);
  document.querySelector(".workspace").classList.toggle("hidden", sources || intents || interviews || dashboard || assessments);
  document.querySelector("#dashboardWorkspace").classList.toggle("hidden", !dashboard);
  document.querySelector("#assessmentWorkspace").classList.toggle("hidden", !assessments);
  document.querySelector("#intentsWorkspace").classList.toggle("hidden", !intents);
  document.querySelector("#sourcesWorkspace").classList.toggle("hidden", !sources);
  document.querySelector("#interviewWorkspace").classList.toggle("hidden", !interviews);
  document.querySelector("#add").classList.toggle("hidden", sources || intents || interviews || dashboard || assessments || state.view !== "pipeline");
  document.querySelector("#search").placeholder = assessments ? "搜索公司、岗位或测评内容" : "搜索公司、岗位或 JD";
  renderPositionViewSwitch();
}

function renderDashboard() {
  const target = document.querySelector("#dashboardWorkspace");
  if (!state.dashboard) return;
  const stageOrder = ["待投递", "筛选中", "待测评", "面试中"];
  const counts = state.dashboard.counts || {};
  const total = state.dashboard.total || 0;
  const maxCount = Math.max(1, ...stageOrder.map(stage => counts[stage] || 0));
  const stages = stageOrder.map(stage => `<button class="dashboard-stage" type="button" data-dashboard-stage="${stage}"><span>${stage}</span><strong>${counts[stage] || 0}</strong><i><b style="width:${Math.max(4, ((counts[stage] || 0) / maxCount) * 100)}%"></b></i></button>`).join("");
  const actionItems = dashboardActions();
  const deadlines = (state.dashboard.expiring || []).slice(0, 6);
  const categories = Object.entries(state.dashboard.categories || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const stageColors = ["#bd5d3e", "#a77a2a", "#4e7393", "#557961"];
  const categoryColors = ["#557961", "#bd5d3e", "#4e7393", "#a77a2a", "#7b6e8f", "#8b7760"];
  const pie = dashboardPie(stageOrder.map((stage, index) => ({ label: stage, count: counts[stage] || 0, color: stageColors[index] })), total);
  target.innerHTML = `<header class="dashboard-head"><div><span class="eyebrow">APPLICATION OVERVIEW</span><h2>投递仪表盘</h2></div><div class="dashboard-total"><span>全部岗位</span><strong>${total}</strong></div></header>
    <div class="dashboard-stage-grid">${stages}</div>
    <div class="dashboard-chart-grid">
      <section class="dashboard-panel chart-panel"><header><div><span class="eyebrow">STAGE SHARE</span><h3>投递阶段占比</h3></div><span>${total} 个岗位</span></header><div class="donut-layout"><div class="donut-chart" style="background:${pie.gradient}" role="img" aria-label="${attr(pie.label)}"><div><strong>${total}</strong><span>全部</span></div></div><div class="donut-legend">${stageOrder.map((stage, index) => `<button type="button" data-dashboard-stage="${stage}"><i style="background:${stageColors[index]}"></i><span>${stage}</span><strong>${counts[stage] || 0}</strong><small>${total ? Math.round(((counts[stage] || 0) / total) * 100) : 0}%</small></button>`).join("")}</div></div></section>
      <section class="dashboard-panel chart-panel"><header><div><span class="eyebrow">CATEGORY TREEMAP</span><h3>岗位方向树图</h3></div><span>Top ${categories.length}</span></header><div class="treemap">${categories.map(([label, count], index) => `<button type="button" data-dashboard-category="${attr(label)}" style="--tree-color:${categoryColors[index]}"><span>${esc(label)}</span><strong>${count}</strong><small>${total ? Math.round((count / total) * 100) : 0}%</small></button>`).join("") || dashboardEmpty("暂无分类数据")}</div></section>
    </div>
    <div class="dashboard-layout">
      <section class="dashboard-panel dashboard-actions-panel"><header><div><span class="eyebrow">NEXT ACTIONS</span><h3>当前队列</h3></div><span>${actionItems.length} 项</span></header><div class="dashboard-list">${actionItems.map(dashboardActionRow).join("") || dashboardEmpty("当前没有紧急队列")}</div></section>
      <section class="dashboard-panel"><header><div><span class="eyebrow">DEADLINES & REMINDERS</span><h3>7 天内截止 / 提醒</h3></div><span>${(state.dashboard.expiring || []).length} 项</span></header><div class="dashboard-list">${deadlines.map(position => dashboardPositionRow(position, formatDeadline(position.deadline), "deadline")).join("") || dashboardEmpty("近期没有截止或提醒")}</div></section>
    </div>`;
  target.querySelectorAll("[data-dashboard-stage]").forEach(button => button.onclick = () => openDashboardStage(button.dataset.dashboardStage));
  target.querySelectorAll("[data-dashboard-action]").forEach(button => button.onclick = () => openDashboardAction(button.dataset.dashboardAction));
  target.querySelectorAll("[data-dashboard-position]").forEach(button => button.onclick = () => openDashboardPosition(Number(button.dataset.dashboardPosition), button.dataset.dashboardKind));
  target.querySelectorAll("[data-dashboard-category]").forEach(button => button.onclick = () => openDashboardCategory(button.dataset.dashboardCategory));
}

function dashboardPie(items, total) {
  if (!total) return { gradient: "#e9e5dc", label: "暂无投递阶段数据" };
  let cursor = 0;
  const stops = items.map(item => {
    const start = cursor;
    cursor += (item.count / total) * 100;
    return `${item.color} ${start}% ${cursor}%`;
  });
  return {
    gradient: `conic-gradient(${stops.join(",")})`,
    label: items.map(item => `${item.label} ${item.count} 个`).join("，"),
  };
}

function dashboardActions() {
  const actions = [];
  if (state.intents.length) actions.push({ key: "intents", label: "待确认变更", detail: `${state.intents.length} 条等待确认`, tone: "gate" });
  const assessments = state.positions.filter(position => position.stage === "待测评");
  if (assessments.length) actions.push({ key: "待测评", label: "待完成测评", detail: `${assessments.length} 个岗位`, tone: "assessment" });
  const interviews = state.positions.filter(position => position.stage === "面试中");
  if (interviews.length) actions.push({ key: "面试中", label: "面试进程", detail: `${interviews.length} 个岗位`, tone: "interview" });
  const immediate = (state.dashboard.immediate || []).length;
  if (immediate) actions.push({ key: "immediate", label: "建议尽快投递", detail: `${immediate} 个岗位`, tone: "apply" });
  return actions;
}

function dashboardActionRow(item) {
  return `<button class="dashboard-list-row" type="button" data-dashboard-action="${item.key}"><i class="queue-mark ${item.tone}" aria-hidden="true"></i><span><strong>${item.label}</strong><small>${item.detail}</small></span><b aria-hidden="true">›</b></button>`;
}

function dashboardPositionRow(position, meta, kind) {
  return `<button class="dashboard-list-row" type="button" data-dashboard-position="${position.id}" data-dashboard-kind="${kind}"><span><strong>${esc(position.company)} · ${esc(position.role_name)}</strong><small>${esc(meta || position.stage)}</small></span><b aria-hidden="true">›</b></button>`;
}

function dashboardEmpty(label) { return `<div class="dashboard-empty">${label}</div>`; }

function renderAssessments() {
  const target = document.querySelector("#assessmentWorkspace");
  const items = state.positions
    .filter(position => position.stage === "待测评")
    .filter(position => !state.q || `${position.company} ${position.role_name} ${position.assessment_content}`.toLowerCase().includes(state.q.toLowerCase()))
    .sort((left, right) => assessmentSortValue(left) - assessmentSortValue(right) || companyComparator(state.companySort)(left, right));
  const now = new Date();
  const urgent = items.filter(position => isWithin(position.deadline, now, 3));
  const scheduled = items.filter(position => validDate(position.deadline));
  const overdue = items.filter(position => validDate(position.deadline) && new Date(position.deadline) < now);
  const selected = items.find(position => position.id === state.expandedAssessmentId);
  if (!selected && state.expandedAssessmentId !== null) {
    state.expandedAssessmentId = null;
    state.notesEditing.clear();
  }
  if (state.section === "positions" && state.stage === "待测评") document.querySelector("#resultCount").textContent = `${items.length} 条`;
  target.innerHTML = `<header class="assessment-head">
      <div><span class="eyebrow">ASSESSMENT QUEUE</span><h2>待测评</h2></div>
      <div class="assessment-total"><span>待完成</span><strong>${items.length}</strong></div>
    </header>
    <div class="assessment-metrics" aria-label="测评概览">
      ${assessmentMetric("全部测评", items.length, "岗位")}
      ${assessmentMetric("3 天内截止", urgent.length, urgent.length ? "优先处理" : "暂无紧急项", "urgent")}
      ${assessmentMetric("已设置截止", scheduled.length, "条提醒")}
      ${assessmentMetric("已逾期", overdue.length, overdue.length ? "已截止未完成" : "无逾期", "overdue")}
    </div>
    <section class="assessment-board">
      <header><div><span class="eyebrow">ASSESSMENT CARDS</span><h3>测评任务</h3></div><span>按截止时间排列</span></header>
      <div class="assessment-card-grid${selected ? " is-detail-open" : ""}">${items.length
        ? `<div class="assessment-card-list">${items.map(assessmentRow).join("")}</div>${selected ? assessmentDetail(selected) : ""}`
        : '<div class="assessment-empty"><strong>当前没有待测评岗位</strong></div>'}</div>
    </section>`;
  target.querySelectorAll("[data-assessment-field]").forEach(control => {
    control.addEventListener("change", () => saveAssessmentField(control));
  });
  target.querySelectorAll("[data-expand-assessment]").forEach(button => {
    button.addEventListener("click", () => {
      state.expandedAssessmentId = Number(button.dataset.expandAssessment);
      state.notesEditing.clear();
      renderAssessments();
    });
  });
  target.querySelectorAll("[data-collapse-assessment]").forEach(button => {
    button.addEventListener("click", () => {
      state.expandedAssessmentId = null;
      state.notesEditing.clear();
      renderAssessments();
    });
  });
  target.querySelectorAll("[data-complete-assessment]").forEach(button => {
    button.addEventListener("click", () => completeAssessment(button));
  });
  target.querySelectorAll("[data-notes-edit]").forEach(button => {
    button.addEventListener("click", () => {
      state.notesEditing.add(Number(button.dataset.notesEdit));
      renderAssessments();
      document.querySelector(`[data-notes-editor="${button.dataset.notesEdit}"]`)?.focus();
    });
  });
  target.querySelectorAll("[data-notes-cancel]").forEach(button => {
    button.addEventListener("click", () => {
      state.notesEditing.delete(Number(button.dataset.notesCancel));
      renderAssessments();
    });
  });
  target.querySelectorAll("[data-notes-save]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.notesSave);
      const position = state.positions.find(item => item.id === id);
      const value = document.querySelector(`[data-notes-editor="${id}"]`)?.value || "";
      const note = value.trim();
      const notes = note ? [note] : [];
      if (!position) return;
      button.disabled = true;
      try {
        await fetch(`/api/positions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch: { stage_notes: notes }, expectedRevision: position.local_revision })
        }).then(assertOk);
        position.stage_notes = notes;
        state.notesEditing.delete(id);
        showStatus(`已保存 ${position.company} 的备战笔记`);
        renderAssessments();
      } catch (error) {
        showError(error);
        button.disabled = false;
      }
    });
  });
}

function assessmentMetric(label, value, detail, tone = "") {
  return `<div class="assessment-metric ${tone}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`;
}

function assessmentRow(position) {
  const status = assessmentStatus(position);
  const note = assessmentNote(position.stage_notes);
  const selected = state.expandedAssessmentId === position.id;
  const deadline = assessmentDeadlineLabel(position.deadline);
  const content = assessmentSummary(position.assessment_content);
  return `<article class="assessment-card assessment-card-collapsed is-${status.tone}${selected ? " selected" : ""}" data-assessment-id="${position.id}">
    <button class="assessment-card-summary" type="button" data-expand-assessment="${position.id}" aria-current="${selected ? "true" : "false"}" aria-label="打开 ${attr(`${position.company} ${position.role_name}`)} 的测评准备">
      <header class="assessment-card-head"><div><strong>${esc(position.company)}</strong><span>${esc(position.role_name)}</span></div><em class="${status.tone}">${status.label}</em></header>
      <div class="assessment-summary-fields">
        <span class="assessment-deadline-summary"><small>截止时间</small><b>${esc(deadline)}</b></span>
        <span class="assessment-content-summary"><small>测评内容</small><b>${esc(content)}</b></span>
      </div>
      <footer><span>${note ? "1 条备战笔记" : "尚无备战笔记"}</span><b>${selected ? "正在准备" : "开始准备"} <i aria-hidden="true">›</i></b></footer>
    </button>
    <footer class="assessment-card-quick-actions"><button class="assessment-complete" type="button" data-complete-assessment="${position.id}">已完成</button></footer>
  </article>`;
}

function assessmentDetail(position) {
  const status = assessmentStatus(position);
  const note = assessmentNote(position.stage_notes);
  const editing = state.notesEditing.has(position.id);
  const notesBlock = `
    <details class="assessment-notes" open>
      <summary>真题备战笔记 · ${note ? "1 条" : "暂无"}</summary>
      <div class="assessment-notes-body">
        ${editing
          ? `<textarea class="assessment-notes-editor" data-notes-editor="${position.id}" spellcheck="false" aria-label="${attr(`${position.company} 的真题备战笔记`)}">${attr(note)}</textarea>
             <span class="assessment-notes-actions">
               <button type="button" data-notes-cancel="${position.id}">取消</button>
               <button type="button" class="save" data-notes-save="${position.id}">保存</button>
             </span>`
          : `${note ? `<p>${esc(note)}</p>` : ""}
             <button type="button" class="assessment-notes-edit" data-notes-edit="${position.id}">&#9998; 补充真题 / 笔记</button>`}
      </div>
    </details>`;
  return `<article class="assessment-detail" data-assessment-detail="${position.id}">
    <header class="assessment-detail-head"><div><button class="assessment-back" type="button" data-collapse-assessment="${position.id}">‹ 返回待测评</button><span class="eyebrow">ASSESSMENT PREP</span><h4>${esc(position.company)} · ${esc(position.role_name)}</h4></div><em class="${status.tone}">${status.label}</em></header>
    <div class="assessment-detail-fields">
      <label class="assessment-field assessment-deadline"><span>截止时间</span><input type="datetime-local" value="${attr(dateTimeInput(position.deadline))}" data-assessment-field="deadline" data-position="${position.id}" aria-label="${attr(`${position.company} ${position.role_name}的测评截止时间`)}"></label>
      <label class="assessment-field assessment-content"><span>测评内容</span><input type="text" value="${attr(position.assessment_content || "")}" placeholder="行测 / 产品题 / AI 面试" data-assessment-field="assessment_content" data-position="${position.id}" aria-label="${attr(`${position.company} ${position.role_name}的测评内容`)}"></label>
    </div>
    ${notesBlock}
    <footer><button class="assessment-complete" type="button" data-complete-assessment="${position.id}">已完成</button></footer>
  </article>`;
}

function assessmentNote(notes) {
  return (Array.isArray(notes) ? notes : []).map(note => String(note).trim()).filter(Boolean).join("\n");
}

function assessmentDeadlineLabel(value) {
  const date = validDate(value);
  if (!date) return "待设置截止时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function assessmentSummary(value) {
  const content = String(value || "").trim();
  if (!content) return "待补充测评内容";
  return content.split("｜链接：", 1)[0];
}

function assessmentStatus(position, now = new Date()) {
  const deadline = validDate(position.deadline);
  if (deadline && deadline < now) return { label: "已截止", tone: "overdue" };
  if (deadline && deadline <= new Date(now.getTime() + 3 * 86400000)) return { label: "临近截止", tone: "urgent" };
  if (deadline) return { label: "待完成", tone: "scheduled" };
  return { label: "待补截止", tone: "missing" };
}

function assessmentSortValue(position) {
  return validDate(position.deadline)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function isWithin(value, now, days) {
  const date = validDate(value);
  return Boolean(date && date >= now && date <= new Date(now.getTime() + days * 86400000));
}

async function saveAssessmentField(control) {
  const position = state.positions.find(item => item.id === Number(control.dataset.position));
  if (!position) return;
  const field = control.dataset.assessmentField;
  const value = control.type === "datetime-local" ? deadlineStorageValue(control.value) : control.value.trim();
  if (value === (position[field] || "")) return;
  control.disabled = true;
  await saveCell(position, field, value);
}

async function completeAssessment(button) {
  const position = state.positions.find(item => item.id === Number(button.dataset.completeAssessment));
  if (!position) return;
  button.disabled = true;
  try {
    await fetch(`/api/positions/${position.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "筛选中", note: "Owner completed assessment in local dashboard", expectedRevision: position.local_revision }),
    }).then(assertOk);
    await load();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

function openDashboardStage(stage) {
  state.positionView = "table";
  state.section = stage === "面试中" ? "interviews" : "positions";
  state.stage = stage;
  renderStages(); renderRows(); renderSection();
}

function openDashboardAction(action) {
  if (action === "intents") { state.section = "intents"; renderStages(); renderSection(); return; }
  if (action === "immediate") {
    state.positionView = "table"; state.section = "positions"; state.stage = "待投递"; state.recommendation = "立即投递";
    document.querySelector("#recommendation").value = "立即投递";
    renderStages(); renderRows(); renderSection(); return;
  }
  openDashboardStage(action);
}

function openDashboardPosition(id, kind) {
  const position = state.positions.find(item => item.id === id);
  if (!position) return;
  state.positionView = "table"; state.section = "positions"; state.stage = position.stage; state.q = position.role_name;
  document.querySelector("#search").value = position.role_name;
  renderStages(); renderRows(); renderSection();
}

function openDashboardCategory(category) {
  state.positionView = "table"; state.section = "positions"; state.stage = ""; state.q = category;
  document.querySelector("#search").value = category;
  renderStages(); renderRows(); renderSection();
}

function renderIntents() {
  const target = document.querySelector("#intentsWorkspace");
  const cards = state.intents.map(intent => {
    const discovery = intent.action === "create" && Boolean(intent.payload.discovery_run_id);
    const targetStage = intent.action === "create" ? intent.payload.stage : intent.payload.stage || intent.current_stage;
    const action = discovery ? "Agent 发现" : ({
      create: "新增岗位", transition: "更新阶段", update: "更新信息", delete: "删除岗位",
      interview_create: "新增面试轮次", interview_update: "更新面试轮次",
    })[intent.action] || "待确认变更";
    const source = discovery ? extractUrl(intent.payload.source_url) : "";
    const sourceLink = source ? `<a class="intent-source" href="${attr(source)}" target="_blank" rel="noreferrer">查看来源</a>` : "";
    const acceptLabel = discovery ? "确认加入待投递" : intent.action === "delete" ? "确认删除" : "接受并登记";
    return `<article class="intent-card"><header><div><span class="eyebrow">${esc(action)}</span><h2>${esc(intent.company)} · ${esc(intent.role_name)}</h2></div><span class="badge">${esc(discovery ? "确认后待投递" : targetStage || "待确认")}</span></header><p class="evidence">证据：${esc(intent.evidence.join("；") || "未提供")}</p><div class="intent-actions">${sourceLink}<button data-intent-id="${intent.id}" data-intent-decision="reject">拒绝</button><button class="primary" data-intent-id="${intent.id}" data-intent-decision="accept">${acceptLabel}</button></div></article>`;
  }).join("");
  target.innerHTML = `<div class="view-head"><div><span class="eyebrow">HUMAN GATE</span><h2>待确认机会与变更</h2><p>接受后才写入正式岗位状态。</p></div><span class="badge">${state.intents.length} 条</span></div>${cards || '<div class="empty"><strong>当前没有待确认机会</strong></div>'}`;
  target.querySelectorAll("[data-intent-decision]").forEach(button => button.onclick = () => decideIntent(button));
}

async function decideIntent(button) {
  button.disabled = true;
  try {
    await fetch(`/api/intents/${button.dataset.intentId}/${button.dataset.intentDecision}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(assertOk);
    await load();
  } catch (error) { button.disabled = false; showError(error); }
}

function filtered() {
  const q = state.q.toLowerCase();
  const positions = state.positions.filter(position => (!state.stage || position.stage === state.stage)
    && (!state.recommendation || position.recommendation === state.recommendation)
    && (!q || `${position.company} ${position.role_name} ${position.category} ${position.jd} ${position.assessment_content || ""}`.toLowerCase().includes(q)));
  if (state.stage === "待投递") return positions.sort(pendingPositionComparator(state.companySort));
  return positions.sort(companyComparator(state.companySort));
}

function pendingPositionComparator(direction) {
  const byCompany = companyComparator(direction);
  return (left, right) => {
    const leftRun = Number(left.discovery_run_id || 0);
    const rightRun = Number(right.discovery_run_id || 0);
    if (leftRun !== rightRun) return rightRun - leftRun;
    if (leftRun && left.discovery_rank !== right.discovery_rank) return Number(left.discovery_rank || 0) - Number(right.discovery_rank || 0);
    return byCompany(left, right);
  };
}

function companyComparator(direction) {
  const text = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-CN", { numeric: true, sensitivity: "base" });
  return (left, right) => {
    const companyOrder = text(left.company, right.company) * (direction === "desc" ? -1 : 1);
    return companyOrder || text(left.role_name, right.role_name) || left.id - right.id;
  };
}

function renderRows() {
  const positions = filtered();
  renderColumnHeaders();
  renderCompanySort();
  document.querySelector("#resultCount").textContent = `${positions.length} 条`;
  const rows = positions.map(position => `<tr data-id="${position.id}">
    ${state.columns.map(column => renderColumnCell(position, column)).join("")}
    ${deleteCell(position)}
  </tr>`).join("");
  const columnCount = state.columns.length + 1;
  document.querySelector("#rows").innerHTML = rows || `<tr class="no-results"><td colspan="${columnCount}"><div class="empty"><strong>没有匹配岗位</strong><p>调整阶段或搜索词</p></div></td></tr>`;
  bindGrid();
  bindResumeLinks(document.querySelector("#rows"));
}

function renderColumnHeaders() {
  const headers = state.columns.map(column => {
    const sort = column.source_field === "company"
      ? `<button id="companySort" class="column-sort" type="button" aria-label="公司名称排序">${esc(column.label)} <span aria-hidden="true">↑</span></button>`
      : `<span class="column-label">${esc(column.label)}</span>`;
    return `<th style="width:${column.width}px" data-column-id="${column.id}"><div class="column-heading">${sort}<button class="column-menu" type="button" data-edit-column="${column.id}" title="管理列" aria-label="管理 ${attr(column.label)} 列">•••</button></div></th>`;
  }).join("");
  document.querySelector("#columnHeaders").innerHTML = `${headers}<th class="row-actions-heading"><span class="visually-hidden">操作</span></th>`;
  document.querySelector(".data-grid").style.width = `max(100%, ${state.columns.reduce((sum, column) => sum + column.width, 44)}px)`;
  document.querySelector("#companySort")?.addEventListener("click", () => {
    state.companySort = state.companySort === "asc" ? "desc" : "asc";
    localStorage.setItem("job-pipeline-company-sort", state.companySort);
    renderRows();
  });
  document.querySelectorAll("[data-edit-column]").forEach(button => button.addEventListener("click", () => openColumnDialog(Number(button.dataset.editColumn))));
}

function renderColumnCell(position, column) {
  const field = column.source_field;
  const value = field ? position[field] : position.custom_values?.[column.id] ?? "";
  if (field === "deadline") return deadlineCell(position);
  if (field === "resume_version") return resumeCell(position);
  if (field === "official_url") return applicationLinkCell(position);
  if (field === "stage") return selectCell(position, field, value, [value, ...(stageTransitions[value] || []).filter(option => option !== value)], column.id);
  if (column.kind === "select") return selectCell(position, field, value, column.options, column.id);
  return cell(position, field, value || (field === "role_name" ? "待补岗位" : ""), column.label, column.kind, column.id);
}

function applicationLinkCell(position) {
  const url = extractUrl(position.official_url);
  const content = url
    ? `<div class="application-link-controls">
        <a class="application-link" href="${attr(url)}" target="_blank" rel="noreferrer" title="打开投递链接">${esc(applicationLinkLabel(url))}</a>
        <span class="application-link-actions">
          <button class="link-action edit-link" type="button" data-edit-link="${position.id}" title="编辑投递链接" aria-label="编辑 ${attr(position.company)} 的投递链接">&#9998;</button>
          <button class="link-action delete-link" type="button" data-delete-link="${position.id}" title="删除投递链接" aria-label="删除 ${attr(position.company)} 的投递链接">&#215;</button>
        </span>
      </div>`
    : `<button class="add-link" type="button" data-edit-link="${position.id}">添加链接</button>`;
  return `<td class="application-link-cell" data-field="official_url" data-editor="url" tabindex="0" aria-label="${url ? "投递链接，可点击空白处编辑" : "添加投递链接"}">${content}</td>`;
}

function applicationLinkLabel(url) {
  try {
    return new URL(url).hostname.endsWith("xiaohongshu.com") ? "查看小红书原帖" : url;
  } catch { return url; }
}

function deadlineCell(position) {
  const value = dateTimeInput(position.deadline);
  const label = `${position.company} ${position.role_name}的截止或提醒时间`;
  return `<td class="deadline-cell ${soon(position.deadline) ? "soon" : ""}"><input type="datetime-local" value="${attr(value)}" data-deadline-position="${position.id}" aria-label="${attr(label)}" title="精确到分钟"></td>`;
}

function renderCompanySort() {
  const button = document.querySelector("#companySort");
  if (!button) return;
  const ascending = state.companySort === "asc";
  button.setAttribute("aria-label", `公司名称${ascending ? "正序" : "倒序"}排列，点击切换`);
  button.closest("th").setAttribute("aria-sort", ascending ? "ascending" : "descending");
  button.querySelector("span").textContent = ascending ? "↑" : "↓";
}

function renderSources() {
  const target = document.querySelector("#sourcesWorkspace");
  const run = state.discoveryRun;
  const active = ["queued", "running"].includes(run?.status);
  const rows = state.sources.map(source => {
    const url = extractUrl(source.url);
    const current = active && run.task_type === "source_sync" && run.source_id === source.id;
    const label = current ? run.phase === "awaiting_agent" ? "重新复制" : "同步中" : active ? "任务进行中" : "一键同步";
    return `<tr><td><strong>${esc(source.name || "未命名来源")}</strong></td><td><span class="badge">${esc(source.source_type || "待补充")}</span></td><td>${esc(source.credibility || "待补充")}</td><td>${source.source_revision ?? "-"}</td><td>${url ? `<div class="source-link-cell"><a class="source-link" href="${attr(url)}" target="_blank" rel="noreferrer" title="打开来源链接">${esc(url)}</a><button type="button" data-sync-source="${source.id}" ${active && !current || current && run.phase !== "awaiting_agent" ? "disabled" : ""}>${label}</button></div>` : '<span class="muted">链接待补充</span>'}</td></tr>`;
  }).join("");
  const awaitingAgent = run?.executor === "assisted" && run.status === "queued" && run.phase === "awaiting_agent";
  target.innerHTML = `<div class="sources-head discovery-head"><div><span class="eyebrow">OPPORTUNITY SEARCH</span><h2>检索新机会</h2><p>${discoverySubtitle(run)}</p></div><button id="startDiscovery" class="discovery-action" type="button" ${active && !awaitingAgent ? "disabled" : ""}>${active ? awaitingAgent ? "重新复制任务" : "正在检索" : "检索新机会"}</button></div>
    ${discoveryRunView(run)}
    <div class="source-list-head"><div><span class="eyebrow">SOURCES</span><h3>稳定信息源</h3></div><span>${state.sources.length} 个</span></div>
    <div class="sources-table-wrap"><table class="sources-table"><thead><tr><th>来源名称</th><th>来源类型</th><th>可信度</th><th>迁移版本</th><th>链接</th></tr></thead><tbody>${rows || '<tr><td colspan="5"><div class="empty">尚未登记稳定信息源</div></td></tr>'}</tbody></table></div>`;
  target.querySelector("#startDiscovery").onclick = startDiscovery;
  target.querySelectorAll("[data-sync-source]").forEach(button => button.onclick = () => startSourceSync(Number(button.dataset.syncSource), button));
  target.querySelector("[data-open-intents]")?.addEventListener("click", openPendingIntents);
}

function discoveryExecutorLabel(source = "") {
  return source === "codex" ? "Codex" : source === "qwenwork_builtin_browser" ? "千问办公" : source === "agent_runner" ? "外部 Agent" : source || "";
}

function discoverySubtitle(run) {
  if (!run) return "让你的本地 Agent 搜索并初筛机会";
  if (["queued", "running"].includes(run.status)) {
    if (run.task_type === "source_sync") return run.phase === "awaiting_agent" ? `${run.source_name} 等待 Agent 接单` : `${discoveryExecutorLabel(run.submitted_source) || "Agent"} 正在同步 ${run.source_name}`;
    if (run.executor === "assisted") return run.phase === "awaiting_agent" ? "复制任务后交给你的本地 Agent" : `${discoveryExecutorLabel(run.submitted_source) || "Agent"} 正在检索机会`;
    return "Agent 正在检索机会";
  }
  if (!run.finished_at) return "让你的本地 Agent 搜索并初筛机会";
  return `${run.status === "completed" ? "上次完成于" : "上次结束于"} ${new Date(run.finished_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function discoveryRunView(run) {
  if (!run) return '<div class="discovery-state idle"><strong>尚未检索</strong><span>结果会先进入待确认</span></div>';
  if (run.executor === "assisted" && run.status === "queued" && run.phase === "awaiting_agent") {
    return `<div class="discovery-state running" aria-live="polite"><i aria-hidden="true"></i><div><strong>${run.task_type === "source_sync" ? `${esc(run.source_name)} 同步任务已创建` : "检索任务已创建"}</strong><span>将已复制的任务发送给任一支持浏览器的 Agent</span></div></div>`;
  }
  if (["queued", "running"].includes(run.status)) return `<div class="discovery-state running" aria-live="polite"><i aria-hidden="true"></i><div><strong>${esc(run.message)}</strong><span>请保留 Chrome 登录状态，出现平台风险提示时会自动停止</span></div></div>`;
  if (run.status === "completed") return `<div class="discovery-state complete"><div><strong>${esc(run.message)}</strong><span>发现 ${run.candidates_found} 条，去重 ${run.duplicates_skipped} 条，排除 ${run.candidates_rejected} 条${run.submitted_source ? ` · 执行方 ${discoveryExecutorLabel(run.submitted_source)}` : ""}</span></div>${run.positions_added ? '<button type="button" data-open-intents>查看待确认</button>' : ""}</div>`;
  if (/人工中止|会话中断|本轮检索作废/.test(run.message || "")) return '<div class="discovery-state idle"><strong>可以开始新一轮检索</strong><span>上一次任务已结束</span></div>';
  const label = run.status === "blocked" ? "检索已暂停" : "检索未完成";
  return `<div class="discovery-state ${run.status}"><div><strong>${label}</strong><span>${esc(run.message)}</span></div></div>`;
}

async function startDiscovery() {
  const button = document.querySelector("#startDiscovery");
  if (button) button.disabled = true;
  try {
    const result = await fetch("/api/discovery-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ executor: "assisted" }) }).then(assertOk);
    if (!result.summon_prompt) throw new Error("检索任务未返回召唤指令");
    await copyText(result.summon_prompt);
    state.discoveryRun = result.run;
    renderSources();
    scheduleDiscoveryPoll();
    showStatus("检索任务已复制，可发送给任一支持浏览器的 Agent");
  } catch (error) {
    if (button) button.disabled = false;
    showError(error);
  }
}

async function startSourceSync(sourceId, button) {
  button.disabled = true;
  try {
    const result = await fetch(`/api/sources/${sourceId}/sync-runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(assertOk);
    if (!result.summon_prompt) throw new Error("同步任务未返回召唤指令");
    await copyText(result.summon_prompt);
    state.discoveryRun = result.run;
    renderSources();
    scheduleDiscoveryPoll();
    showStatus(`${result.source.name} 同步任务已复制`);
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

function scheduleDiscoveryPoll() {
  if (discoveryPoll) clearTimeout(discoveryPoll);
  discoveryPoll = null;
  if (!["queued", "running"].includes(state.discoveryRun?.status) || state.discoveryRun?.phase === "awaiting_agent") return;
  discoveryPoll = setTimeout(refreshDiscoveryRun, 2000);
}

async function refreshDiscoveryRun() {
  try {
    const result = await getJson("/api/discovery-runs/latest");
    state.discoveryRun = result.run;
    if (["queued", "running"].includes(result.run?.status)) {
      renderSources();
      scheduleDiscoveryPoll();
      return;
    }
    await load();
    if (result.run?.status === "completed") showStatus(result.run.message);
  } catch (error) {
    showError(error);
    scheduleDiscoveryPoll();
  }
}

function openPendingIntents() {
  state.section = "intents";
  renderStages();
  renderSection();
}

function renderFacts() {
  const target = document.querySelector("#factsContent");
  const nav = document.querySelector("#factsNav");
  const facts = state.applicationFacts;
  if (!facts) {
    target.innerHTML = '<div class="empty"><strong>正在读取事实表</strong></div>';
    return;
  }
  const rendered = renderMarkdownPreview(facts.source, { showSensitive: state.showSensitive });
  nav.innerHTML = rendered.navigation.map((item, index) => factsNavigationItem(item, index === 0)).join("");
  target.innerHTML = rendered.html;
  nav.querySelectorAll("summary[data-facts-target]").forEach(summary => summary.onclick = () => {
    requestAnimationFrame(() => document.getElementById(summary.dataset.factsTarget)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
  document.querySelector("#factsMeta").textContent = `当前浏览器 Markdown · 更新于 ${new Date(facts.updatedAt).toLocaleString("zh-CN")}`;
  target.querySelectorAll("[data-copy-value]").forEach(button => button.onclick = async () => {
    await copyText(button.dataset.copyValue);
    flashCopied(button, "已复制");
  });
  const sections = new Map(markdownSections(facts.source).map(section => [section.id, section]));
  target.querySelectorAll("[data-copy-section]").forEach(button => button.onclick = async () => {
    const section = sections.get(button.dataset.copySection);
    if (!section) return;
    await copyText(section.text);
    flashCopied(button, "已复制");
  });
  filterMarkdownPreview();
}

function startFactsEdit() {
  if (!state.applicationFacts) return;
  state.factsEditing = true;
  document.querySelector("#factsEditor").value = state.applicationFacts.source;
  renderFactsMode();
  updateFactsEditState();
  document.querySelector("#factsEditor").focus();
}

function cancelFactsEdit() {
  const editor = document.querySelector("#factsEditor");
  if (editor.value !== state.applicationFacts.source && !window.confirm("放弃未保存的 Markdown 修改？")) return;
  state.factsEditing = false;
  renderFactsMode();
}

async function saveFacts() {
  if (!state.factsEditing || !state.applicationFacts) return;
  const button = document.querySelector("#saveFacts");
  button.disabled = true;
  try {
    const result = await fetch("/api/application-facts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: document.querySelector("#factsEditor").value, expectedRevision: state.applicationFacts.revision }),
    }).then(assertOk);
    state.applicationFacts = result;
    state.factsEditing = false;
    renderFacts();
    renderFactsMode();
    showStatus("网申事实库已保存到当前浏览器");
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

function renderFactsMode() {
  document.querySelector("#factsPreviewTools").classList.toggle("hidden", state.factsEditing);
  document.querySelector("#factsEditTools").classList.toggle("hidden", !state.factsEditing);
  document.querySelector("#factsNav").classList.toggle("hidden", state.factsEditing);
  document.querySelector("#factsContent").classList.toggle("hidden", state.factsEditing);
  document.querySelector("#factsEditorPane").classList.toggle("hidden", !state.factsEditing);
  document.querySelector(".facts-layout").classList.toggle("is-editing", state.factsEditing);
}

function updateFactsEditState() {
  if (!state.applicationFacts) return;
  const changed = document.querySelector("#factsEditor").value !== state.applicationFacts.source;
  document.querySelector("#factsEditState").textContent = changed ? "有未保存修改" : "没有修改";
  document.querySelector("#saveFacts").disabled = !changed;
}

function factsNavigationItem(item, open) {
  if (!item.children.length) return `<a class="facts-nav-primary" href="#${attr(item.id)}">${esc(item.title)}</a>`;
  return `<details class="facts-nav-group" ${open ? "open" : ""}><summary data-facts-target="${attr(item.id)}"><span>${esc(item.title)}</span><i aria-hidden="true"></i></summary><div class="facts-nav-children">${item.children.map(child => `<a href="#${attr(child.id)}">${esc(child.title)}</a>`).join("")}</div></details>`;
}

function filterMarkdownPreview() {
  const target = document.querySelector("#factsContent");
  if (!target) return;
  let visible = 0;
  target.querySelectorAll("[data-md-section]").forEach(section => {
    const match = !state.factsQuery || section.dataset.search.includes(state.factsQuery);
    section.classList.toggle("hidden", !match);
    if (match) visible += 1;
  });
  target.querySelector(".md-no-results")?.remove();
  if (!visible) target.insertAdjacentHTML("beforeend", '<div class="empty md-no-results"><strong>没有匹配内容</strong><p>换一个关键词继续搜索</p></div>');
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function flashCopied(button, label) {
  const original = button.textContent;
  button.textContent = label;
  button.classList.add("copied");
  setTimeout(() => { button.textContent = original; button.classList.remove("copied"); }, 1100);
}

function renderInterviewPipelines() {
  const target = document.querySelector("#interviewWorkspace");
  const cards = state.interviewPipelines.map(pipeline => {
    const rounds = pipeline.rounds.map(round => interviewRound(pipeline, round)).join("");
    const empty = `<div class="interview-empty"><p>尚未建立面试轮次</p><button class="primary" data-create-round="${pipeline.id}">建立一面</button></div>`;
    return `<article class="interview-card">
      <header class="interview-card-head">
        <div><span class="eyebrow">INTERVIEW PIPELINE</span><h2>${esc(pipeline.company)} · ${esc(pipeline.role_name)}</h2></div>
        <div class="interview-head-actions"><button class="interview-delete-position" type="button" data-delete-interview-position="${pipeline.id}">删除整场</button>${resumeControl(pipeline)}<span class="interview-current">${esc(currentRoundLabel(pipeline.rounds))}</span></div>
      </header>
      <div class="round-timeline">${rounds || empty}</div>
    </article>`;
  }).join("");
  target.innerHTML = cards || '<div class="empty"><strong>当前没有面试中的岗位</strong><p>岗位进入面试中后，会在这里建立轮次记录。</p></div>';
  target.querySelectorAll("[data-create-round]").forEach(button => button.onclick = () => createRound(Number(button.dataset.createRound), button));
  target.querySelectorAll("[data-delete-interview-position]").forEach(button => button.onclick = () => deletePosition(Number(button.dataset.deleteInterviewPosition), button));
  target.querySelectorAll("[data-save-round]").forEach(button => button.onclick = () => saveRound(button));
  target.querySelectorAll("[data-delete-round]").forEach(button => button.onclick = () => deleteRound(button));
  bindResumeLinks(target);
}

function resumeCell(position) {
  if (position.stage === "待投递") return '<td class="resume-cell"><span class="muted">投递后关联</span></td>';
  return `<td class="resume-cell">${resumeControl(position)}</td>`;
}

function resumeControl(position) {
  const link = state.resumeLinks.get(position.id);
  if (!link) return `<button class="resume-action" data-link-resume="${position.id}" title="关联本地 PDF">关联 PDF</button>`;
  return `<div class="resume-reference"><button class="resume-file" data-open-resume="${position.id}" title="打开 ${attr(link.name)}">${esc(link.name)}</button><button class="resume-relink" data-link-resume="${position.id}" title="重新关联本地 PDF" aria-label="重新关联 ${attr(link.name)}">↻</button></div>`;
}

function bindResumeLinks(root) {
  root.querySelectorAll("[data-link-resume]").forEach(button => button.onclick = () => linkResume(Number(button.dataset.linkResume), button));
  root.querySelectorAll("[data-open-resume]").forEach(button => button.onclick = () => openResume(Number(button.dataset.openResume), button));
}

async function linkResume(positionId, button) {
  if (!window.showOpenFilePicker) return showError(new Error("当前浏览器不支持本地文件关联，请使用最新版 Chrome"));
  button.disabled = true;
  try {
    const [handle] = await window.showOpenFilePicker({
      id: `job-pipeline-resume-${positionId}`,
      multiple: false,
      types: [{ description: "PDF 简历", accept: { "application/pdf": [".pdf"] } }],
    });
    const file = await handle.getFile();
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("请选择 PDF 文件");
    const link = { positionId, name: file.name, handle, linkedAt: new Date().toISOString() };
    await saveResumeLink(link);
    state.resumeLinks.set(positionId, link);
    renderRows();
    renderInterviewPipelines();
  } catch (error) {
    if (error.name !== "AbortError") showError(error);
    button.disabled = false;
  }
}

async function openResume(positionId, button) {
  const link = state.resumeLinks.get(positionId);
  if (!link) return;
  const preview = window.open("", "_blank");
  button.disabled = true;
  try {
    const permission = await link.handle.queryPermission({ mode: "read" });
    if (permission !== "granted" && await link.handle.requestPermission({ mode: "read" }) !== "granted") throw new Error("需要允许读取这份 PDF");
    const file = await link.handle.getFile();
    const url = URL.createObjectURL(file);
    if (!preview) throw new Error("浏览器阻止了 PDF 预览窗口，请允许此站点打开新窗口");
    preview.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    preview?.close();
    showError(new Error(error.name === "NotFoundError" ? "原 PDF 已移动或删除，请重新关联" : error.message));
  } finally {
    button.disabled = false;
  }
}

const resumeDb = new Promise((resolve, reject) => {
  const request = indexedDB.open("local-job-pipeline", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("resume-links", { keyPath: "positionId" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function listResumeLinks() {
  const db = await resumeDb;
  return new Promise((resolve, reject) => {
    const request = db.transaction("resume-links").objectStore("resume-links").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveResumeLink(link) {
  const db = await resumeDb;
  return new Promise((resolve, reject) => {
    const request = db.transaction("resume-links", "readwrite").objectStore("resume-links").put(link);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function interviewRound(pipeline, round) {
  const waiting = round.result === "未定";
  return `<section class="round-item ${waiting ? "is-current" : "is-complete"}">
    <span class="round-node" aria-hidden="true"></span>
    <div class="round-content">
      <div class="round-title"><div><strong>${esc(round.label)}</strong><span>${waiting ? "等待面试" : esc(round.result)}</span></div><span class="round-state">${waiting ? "当前轮次" : "已记录"}</span></div>
      <div class="round-fields">
        <label><span>轮次名称</span><input type="text" value="${attr(round.label)}" maxlength="40" data-round-label></label>
        <label><span>面试日期</span><input type="date" value="${attr(dateInput(round.scheduled_at))}" data-round-date></label>
        <label><span>面试结果</span><select data-round-result>${["未定", "通过", "未通过", "加面"].map(value => `<option value="${value}" ${value === round.result ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label class="transcript-field"><span>逐字稿记录</span><div><input type="text" value="${attr(round.transcript_ref)}" placeholder="粘贴逐字稿记录 ID 或备注" data-round-transcript></div></label>
      </div>
      <div class="round-actions"><button class="round-delete" type="button" data-delete-round data-position="${pipeline.id}" data-sequence="${round.sequence}">删除本轮</button><button class="round-save" type="button" data-save-round data-position="${pipeline.id}" data-sequence="${round.sequence}">保存修改</button></div>
    </div>
  </section>`;
}

async function createRound(positionId, button) {
  button.disabled = true;
  try {
    await fetch(`/api/positions/${positionId}/interview-rounds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(assertOk);
    await reloadInterviewView();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

async function saveRound(button) {
  const item = button.closest(".round-item");
  const patch = {
    label: item.querySelector("[data-round-label]").value.trim(),
    scheduled_at: item.querySelector("[data-round-date]").value,
    result: item.querySelector("[data-round-result]").value,
    transcript_ref: item.querySelector("[data-round-transcript]").value.trim(),
  };
  if (!patch.label) return showError(new Error("请填写轮次名称"));
  item.querySelectorAll("input, select, button").forEach(control => { control.disabled = true; });
  try {
    await fetch(`/api/positions/${button.dataset.position}/interview-rounds/${button.dataset.sequence}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(assertOk);
    await reloadInterviewView();
  } catch (error) {
    item.querySelectorAll("input, select, button").forEach(control => { control.disabled = false; });
    showError(error);
  }
}

async function deleteRound(button) {
  const item = button.closest(".round-item");
  const label = item.querySelector("[data-round-label]").value.trim() || `第 ${button.dataset.sequence} 轮`;
  if (!window.confirm(`删除「${label}」？\n\n只删除这轮面试记录，不会删除岗位、简历或逐字稿文件。`)) return;
  item.querySelectorAll("input, select, button").forEach(control => { control.disabled = true; });
  try {
    await fetch(`/api/positions/${button.dataset.position}/interview-rounds/${button.dataset.sequence}`, { method: "DELETE" }).then(assertOk);
    await reloadInterviewView();
  } catch (error) {
    item.querySelectorAll("input, select, button").forEach(control => { control.disabled = false; });
    showError(error);
  }
}

async function reloadInterviewView() {
  const data = await getJson("/api/interview-pipelines");
  state.interviewPipelines = data.pipelines;
  renderInterviewPipelines();
}

function currentRoundLabel(rounds) {
  if (!rounds.length) return "等待建立一面";
  const current = [...rounds].reverse().find(round => round.result === "未定");
  return current ? `${current.label} · 等待面试` : `${rounds.at(-1).label} · ${rounds.at(-1).result}`;
}

function dateInput(value) { return value ? String(value).slice(0, 10) : ""; }
function dateTimeInput(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00`;
  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) return text.slice(0, 16);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function deadlineStorageValue(value) {
  return value ? `${value}:00+08:00` : "";
}

function cell(position, field, value, label, editor = "text", columnId = null) {
  const resolvedUrl = editor === "url" ? extractUrl(value) : "";
  const shown = editor === "textarea" ? truncate(value, 90) : (resolvedUrl || value);
  const content = resolvedUrl
    ? `<a class="application-link" href="${attr(resolvedUrl)}" target="_blank" rel="noreferrer" title="打开投递链接">${esc(shown)}</a>`
    : `<span>${esc(shown)}</span>`;
  return `<td class="editable-cell ${editor === "textarea" ? "jd-cell" : ""} ${field === "deadline" && soon(position.deadline) ? "soon" : ""}" data-field="${field || ""}" data-column-id="${columnId || ""}" data-editor="${editor}" tabindex="0" aria-label="编辑${label}">${content}</td>`;
}

function selectCell(position, field, value, options, columnId = null) {
  return `<td class="editable-cell" data-field="${field || ""}" data-column-id="${columnId || ""}" data-editor="select" data-options="${attr(JSON.stringify(options))}" tabindex="0" aria-label="编辑单元格"><span class="${field === "stage" ? "stage" : "badge"}">${esc(value)}</span></td>`;
}

function deleteCell(position) {
  const label = `删除 ${position.company} · ${position.role_name}`;
  return `<td class="row-actions"><button class="delete-position" type="button" data-delete-position="${position.id}" title="删除岗位" aria-label="${attr(label)}">×</button></td>`;
}

function bindGrid() {
  document.querySelectorAll("td.editable-cell").forEach(target => {
    target.onclick = event => { if (event.target.closest("a")) return; startEdit(target); };
    target.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); startEdit(target); } };
  });
  document.querySelectorAll("[data-delete-position]").forEach(button => {
    button.addEventListener("click", () => deletePosition(Number(button.dataset.deletePosition), button));
  });
  document.querySelectorAll("td.application-link-cell").forEach(target => {
    target.addEventListener("click", event => {
      if (event.target.closest("a, button, input")) return;
      startEdit(target);
    });
    target.addEventListener("keydown", event => {
      if (event.target !== target || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      startEdit(target);
    });
  });
  document.querySelectorAll("[data-edit-link]").forEach(button => {
    button.addEventListener("click", () => startEdit(button.closest("td")));
  });
  document.querySelectorAll("[data-delete-link]").forEach(button => {
    button.addEventListener("click", () => deleteApplicationLink(Number(button.dataset.deleteLink), button));
  });
  document.querySelectorAll("[data-deadline-position]").forEach(control => {
    control.addEventListener("change", () => saveDeadline(control));
  });
}

async function deleteApplicationLink(id, button) {
  const position = state.positions.find(item => item.id === id);
  if (!position || !window.confirm(`删除「${position.company} · ${position.role_name}」的投递链接？`)) return;
  button.disabled = true;
  await saveCell(position, "official_url", "", "投递链接已删除");
}

async function saveDeadline(control) {
  const position = state.positions.find(item => item.id === Number(control.dataset.deadlinePosition));
  if (!position) return;
  const value = deadlineStorageValue(control.value);
  if (value === (position.deadline || "")) return;
  control.disabled = true;
  await saveCell(position, "deadline", value);
}

async function deletePosition(id, button) {
  const position = state.positions.find(item => item.id === id);
  if (!position || !window.confirm(`删除「${position.company} · ${position.role_name}」？\n\n删除后会从主面板隐藏，历史记录仍会保留。`)) return;
  button.disabled = true;
  try {
    await fetch(`/api/positions/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: position.local_revision }),
    }).then(assertOk);
    await load();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

function startEdit(cell) {
  if (cell.classList.contains("editing")) return;
  const position = state.positions.find(item => item.id === Number(cell.closest("tr").dataset.id));
  if (!position) return;
  const field = cell.dataset.field;
  const columnId = Number(cell.dataset.columnId) || null;
  const editor = cell.dataset.editor;
  const original = field ? position[field] ?? "" : position.custom_values?.[columnId] ?? "";
  const editorValue = ["datetime", "datetime-local"].includes(editor) ? dateTimeInput(original) : String(original);
  let control;
  if (editor === "select") {
    control = document.createElement("select");
    JSON.parse(cell.dataset.options).forEach(value => control.add(new Option(value, value, false, value === original)));
  } else if (editor === "textarea") {
    control = document.createElement("textarea");
    control.value = editorValue;
  } else {
    control = document.createElement("input");
    control.type = editor === "url" ? "url" : editor === "datetime" ? "datetime-local" : editor;
    control.value = editorValue;
    if (editor === "url") control.placeholder = "https://";
  }
  cell.classList.add("editing");
  cell.replaceChildren(control);
  control.focus();
  if (control.select) control.select();
  let finished = false;
  const finish = async save => {
    if (finished) return;
    finished = true;
    if (!save || control.value === editorValue) return renderRows();
    await saveCell(
      position,
      field,
      ["datetime", "datetime-local"].includes(editor) ? deadlineStorageValue(control.value) : control.value,
      field === "official_url" ? (original ? "投递链接已更新" : "投递链接已添加") : "",
      columnId,
    );
  };
  control.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
    if (event.key === "Enter" && editor !== "textarea") { event.preventDefault(); finish(true); }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); finish(true); }
  };
  control.onchange = () => { if (["select", "date", "datetime", "datetime-local"].includes(editor)) finish(true); };
  control.onblur = () => setTimeout(() => finish(true), 0);
}

async function saveCell(position, field, value, successMessage = "", columnId = null) {
  try {
    if (columnId) {
      await fetch(`/api/positions/${position.id}/table-values/${columnId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value, expectedRevision: position.local_revision }) }).then(assertOk);
    } else if (field === "stage") {
      await fetch(`/api/positions/${position.id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: value, note: "Owner updated in local dashboard", expectedRevision: position.local_revision }) }).then(assertOk);
    } else {
      await fetch(`/api/positions/${position.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch: { [field]: value }, expectedRevision: position.local_revision }) }).then(assertOk);
    }
    await load();
    if (successMessage) showStatus(successMessage);
  } catch (error) {
    showError(error);
    await load();
  }
}

async function createPosition() {
  const button = document.querySelector("#saveDraft");
  button.disabled = true;
  try {
    await fetch("/api/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      company: document.querySelector("#draftCompany").value,
      role_name: document.querySelector("#draftRole").value,
      official_url: document.querySelector("#draftUrl").value,
      recommendation: document.querySelector("#draftRecommendation").value,
      deadline: deadlineStorageValue(document.querySelector("#draftDeadline").value),
      jd: document.querySelector("#draftJd").value,
    }) }).then(assertOk);
    document.querySelector("#rowDialog").close();
    await load();
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}

function openRowDialog() {
  switchView("pipeline");
  const form = document.querySelector("#rowForm");
  form.reset();
  document.querySelector("#saveDraft").disabled = false;
  document.querySelector("#draftRecommendation").innerHTML = recommendations.map(value => `<option ${value === "补信息" ? "selected" : ""}>${esc(value)}</option>`).join("");
  document.querySelector("#rowDialog").showModal();
  document.querySelector("#draftCompany").focus();
}

function openColumnDialog(id = null) {
  const column = id ? state.columns.find(item => item.id === id) : null;
  state.editingColumnId = column?.id || null;
  document.querySelector("#columnDialogTitle").textContent = column ? `编辑「${column.label}」` : "新增列";
  document.querySelector("#columnLabel").value = column?.label || "";
  document.querySelector("#columnKind").value = column?.kind === "resume" ? "text" : column?.kind || "text";
  document.querySelector("#columnKind").disabled = Boolean(column?.source_field);
  document.querySelector("#columnOptions").value = (column?.options || []).join("\n");
  document.querySelector("#columnWidth").value = column?.width || 160;
  document.querySelector("#deleteColumn").classList.toggle("hidden", !column);
  document.querySelector("#columnOrderActions").classList.toggle("hidden", !column);
  renderColumnOptionsField();
  document.querySelector("#columnDialog").showModal();
  document.querySelector("#columnLabel").focus();
}

function renderColumnOptionsField() {
  document.querySelector("#columnOptionsField").classList.toggle("hidden", document.querySelector("#columnKind").value !== "select");
}

async function saveColumn() {
  const button = document.querySelector("#saveColumn");
  const column = state.columns.find(item => item.id === state.editingColumnId);
  const patch = {
    label: document.querySelector("#columnLabel").value,
    kind: document.querySelector("#columnKind").value,
    width: Number(document.querySelector("#columnWidth").value),
    options: document.querySelector("#columnOptions").value.split("\n"),
  };
  button.disabled = true;
  try {
    await fetch(column ? `/api/table-columns/${column.id}` : "/api/table-columns", {
      method: column ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(column ? { patch, expectedRevision: column.local_revision } : patch),
    }).then(assertOk);
    document.querySelector("#columnDialog").close();
    await load();
  } catch (error) { showError(error); } finally { button.disabled = false; }
}

async function deleteColumn() {
  const column = state.columns.find(item => item.id === state.editingColumnId);
  if (!column || !window.confirm(`删除「${column.label}」列？\n\n这会同步到所有页面。已有岗位数据不会被删除。`)) return;
  const button = document.querySelector("#deleteColumn");
  button.disabled = true;
  try {
    await fetch(`/api/table-columns/${column.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: column.local_revision }),
    }).then(assertOk);
    document.querySelector("#columnDialog").close();
    await load();
  } catch (error) { showError(error); } finally { button.disabled = false; }
}

async function moveColumn(direction) {
  const index = state.columns.findIndex(item => item.id === state.editingColumnId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.columns.length) return;
  const ids = state.columns.map(column => column.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  try {
    const result = await fetch("/api/table-columns/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
    }).then(assertOk);
    state.columns = result.columns;
    renderRows();
  } catch (error) { showError(error); }
}

async function getJson(url) { return fetch(url).then(assertOk); }
async function assertOk(response) { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }
function setLoading(loading) {
  state.loading = loading;
  const button = document.querySelector("#refresh");
  button.disabled = loading;
  button.textContent = loading ? "…" : "↻";
  button.setAttribute("aria-label", loading ? "正在刷新数据" : "刷新数据");
}
function clearNotice() { document.querySelector("#notice").classList.add("hidden"); }
function showStatus(message) {
  const notice = document.querySelector("#notice");
  notice.textContent = message;
  notice.classList.remove("hidden", "error");
  notice.classList.add("status");
}
function showError(error) {
  const notice = document.querySelector("#notice");
  notice.textContent = `操作失败：${error.message || "无法连接本地服务"}`;
  notice.classList.remove("hidden", "status");
  notice.classList.add("error");
}
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("zh-CN"); }
function formatDeadline(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}(?:T00:00(?::00)?(?:\.000)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) return formatDate(value);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date).replaceAll("/", "-");
}
function soon(value) { if (!value) return false; const date = new Date(value), now = new Date(); return date >= now && date <= new Date(now.getTime() + 7 * 86400000); }
function truncate(value, length) { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > length ? `${text.slice(0, length)}…` : text; }
function extractUrl(value) { const text = String(value ?? "").trim(); const markdown = text.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/); return markdown?.[1] || (/^https?:\/\//.test(text) ? text : ""); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function attr(value) { return esc(value); }

setupWebTools({ reload: load, showStatus, showError });
load();
