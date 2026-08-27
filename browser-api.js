import { IndexedDBStore } from "./data-store.js";
import { WEB_STAGES, canWebTransition, createWebState, isoNow, normalizeWebImport } from "./data-contract.js";

const store = new IndexedDBStore();

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function fail(error, status = 400) {
  return response({ error: error.message || String(error) }, status);
}

function nextId(data, key) {
  data.counters[key] = (Number(data.counters[key]) || 0) + 1;
  return data.counters[key];
}

function activePositions(data) {
  return data.positions.filter(position => !position.deleted_at);
}

function position(data, id) {
  const found = data.positions.find(item => item.id === Number(id) && !item.deleted_at);
  if (!found) throw new Error("岗位不存在。");
  return found;
}

function checkRevision(record, expected) {
  if (expected != null && record.local_revision !== Number(expected)) throw new Error("数据已在另一页面更新，请刷新后重试。");
}

function event(data, positionId, type, note = "") {
  data.events.push({ id: nextId(data, "event"), position_id: positionId, event_type: type, note, actor: "owner", created_at: isoNow() });
}

function newPosition(data, input) {
  const company = String(input.company || "").trim();
  const role = String(input.role_name || "").trim();
  if (!company || !role) throw new Error("公司和岗位为必填项。");
  const now = isoNow();
  const item = {
    id: nextId(data, "position"), company, role_name: role, jd: input.jd || "", official_url: input.official_url || "",
    deadline: input.deadline || "", category: input.category || "", job_natures: [], formal_validity: "不确定",
    recommendation: input.recommendation || "补信息", stage: "待投递", final_result: input.final_result || "未定",
    stage_notes: input.stage_notes || [], assessment_start: input.assessment_start || "", assessment_content: input.assessment_content || "",
    resume_version: input.resume_version || "", next_action: input.next_action || "", next_action_due: input.next_action_due || "",
    discovery_run_id: input.discovery_run_id || null, discovery_rank: input.discovery_rank || null, custom_values: {},
    local_revision: 1, created_at: now, updated_at: now, deleted_at: null,
  };
  data.positions.push(item);
  event(data, item.id, "created", "新增岗位");
  return item;
}

function updatePosition(data, id, patch, expectedRevision) {
  const item = position(data, id);
  checkRevision(item, expectedRevision);
  const allowed = ["company", "role_name", "jd", "official_url", "deadline", "assessment_start", "assessment_content", "category", "formal_validity", "recommendation", "final_result", "resume_version", "stage_notes", "next_action", "next_action_due"];
  for (const [key, value] of Object.entries(patch || {})) if (allowed.includes(key)) item[key] = value ?? "";
  if (!String(item.company).trim() || !String(item.role_name).trim()) throw new Error("公司和岗位为必填项。");
  item.local_revision += 1;
  item.updated_at = isoNow();
  event(data, item.id, "updated", "更新岗位");
  return item;
}

function transition(data, id, stage, expectedRevision) {
  const item = position(data, id);
  checkRevision(item, expectedRevision);
  if (!WEB_STAGES.includes(stage) || !canWebTransition(item.stage, stage)) throw new Error(`不能从 ${item.stage} 直接流转到 ${stage}。`);
  const from = item.stage;
  item.stage = stage;
  item.local_revision += 1;
  item.updated_at = isoNow();
  event(data, item.id, "transition", `${from} -> ${stage}`);
  return item;
}

function dashboard(data) {
  const positions = activePositions(data);
  const counts = Object.fromEntries(WEB_STAGES.map(stage => [stage, positions.filter(item => item.stage === stage).length]));
  const categories = {};
  positions.forEach(item => { categories[item.category || "未分类"] = (categories[item.category || "未分类"] || 0) + 1; });
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000);
  return {
    total: positions.length, counts, categories,
    immediate: positions.filter(item => item.stage === "待投递" && ["立即投递", "尽快投递"].includes(item.recommendation)),
    expiring: positions.filter(item => item.deadline && new Date(item.deadline) >= now && new Date(item.deadline) <= soon),
    lastImport: data.metadata.importedAt ? { created_at: data.metadata.importedAt } : null,
    pendingIntentCount: data.intents.filter(item => item.status === "pending").length,
    discoveryRun: data.discoveryRun,
  };
}

function intentView(data, item) {
  const linked = data.positions.find(position => position.id === item.position_id);
  return { ...item, company: linked?.company || item.payload?.company || "", role_name: linked?.role_name || item.payload?.role_name || "", current_stage: linked?.stage || null };
}

function promptFor(run) {
  return `请执行 Job Pipeline 机会检索工作流。

目标：搜索近期适合我的岗位，并完成第一轮筛选。开始前先向我确认目标方向、地区和时间范围；不得替我投递。

每条结果必须包含：company、role_name、official_url、match_reason、deadline（如可见）、source_evidence。不要猜测缺失事实，只保留可核验的官方或原始来源链接。

完成方式：
1. 如果你能操作当前 Job Pipeline 网页，请把结果登记到“待确认”。
2. 否则输出 UTF-8 CSV，表头固定为：公司,岗位,阶段,投递链接,匹配理由,截止时间,来源证据；阶段统一填写“待确认”。

所有结果必须先进入待确认，由我确认后才进入正式投递看板。

参考工作流：https://gracexygu.github.io/job-pipeline-web/skill/job-pipeline-web/SKILL.md
任务编号：${run.id}`;
}

async function mutate(change) {
  const current = await store.initialize();
  const next = structuredClone(current);
  const result = change(next);
  const saved = await store.write(next, current.metadata.revision);
  return { saved, result };
}

async function body(options) {
  if (!options?.body) return {};
  return typeof options.body === "string" ? JSON.parse(options.body || "{}") : options.body;
}

export async function browserApiFetch(input, options = {}) {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin);
  if (!url.pathname.startsWith("/api/")) return globalThis.fetch(input, options);
  const method = String(options.method || "GET").toUpperCase();
  try {
    const data = await store.initialize();
    if (method === "GET" && url.pathname === "/api/bootstrap") return response({ dashboard: dashboard(data), positions: activePositions(data), columns: data.columns.filter(item => !item.deleted_at).sort((a, b) => a.position - b.position) });
    if (method === "GET" && url.pathname === "/api/sources") return response({ sources: data.sources });
    if (method === "GET" && url.pathname === "/api/intents") return response({ intents: data.intents.filter(item => item.status === "pending").map(item => intentView(data, item)).reverse() });
    if (method === "GET" && url.pathname === "/api/interview-pipelines") return response({ pipelines: activePositions(data).filter(item => item.stage === "面试中").map(item => ({ ...item, rounds: data.interviewRounds.filter(round => round.position_id === item.id).sort((a, b) => a.sequence - b.sequence) })) });
    if (method === "GET" && url.pathname === "/api/application-facts") return response(data.applicationFacts);
    if (method === "GET" && url.pathname === "/api/discovery-runs/latest") return response({ run: data.discoveryRun });

    const inputBody = await body(options);
    if (method === "POST" && url.pathname === "/api/positions") {
      const { result } = await mutate(next => newPosition(next, inputBody));
      return response(result, 201);
    }
    if (method === "POST" && url.pathname === "/api/discovery-runs") {
      const { result } = await mutate(next => {
        if (next.discoveryRun?.status === "queued") return { run: next.discoveryRun, created: false, summon_prompt: promptFor(next.discoveryRun) };
        const now = isoNow();
        const run = { id: nextId(next, "discovery"), status: "queued", phase: "awaiting_agent", message: "已创建，等待 Agent 接单", executor: "assisted", task_type: "opportunity_discovery", candidates_found: 0, positions_added: 0, duplicates_skipped: 0, candidates_rejected: 0, created_at: now, finished_at: null };
        next.discoveryRun = run;
        return { run, created: true, summon_prompt: promptFor(run) };
      });
      return response(result, result.created ? 202 : 200);
    }
    if (method === "PUT" && url.pathname === "/api/application-facts") {
      const { result } = await mutate(next => {
        if (inputBody.expectedRevision != null && next.applicationFacts.revision !== Number(inputBody.expectedRevision)) throw new Error("Markdown 已在另一页面更新，请刷新后重试。");
        next.applicationFacts = { source: String(inputBody.source || ""), revision: next.applicationFacts.revision + 1, updatedAt: isoNow() };
        return next.applicationFacts;
      });
      return response(result);
    }

    let match = url.pathname.match(/^\/api\/positions\/(\d+)$/);
    if (match && method === "PATCH") {
      const { result } = await mutate(next => updatePosition(next, match[1], inputBody.patch || inputBody, inputBody.expectedRevision));
      return response(result);
    }
    if (match && method === "DELETE") {
      const { result } = await mutate(next => {
        const item = position(next, match[1]); checkRevision(item, inputBody.expectedRevision);
        item.deleted_at = isoNow(); item.updated_at = item.deleted_at; item.local_revision += 1; event(next, item.id, "deleted", "删除岗位");
        return item;
      });
      return response(result);
    }
    match = url.pathname.match(/^\/api\/positions\/(\d+)\/transition$/);
    if (match && method === "POST") {
      const { result } = await mutate(next => transition(next, match[1], inputBody.stage, inputBody.expectedRevision));
      return response(result);
    }
    match = url.pathname.match(/^\/api\/positions\/(\d+)\/table-values\/(\d+)$/);
    if (match && method === "PATCH") {
      const { result } = await mutate(next => {
        const item = position(next, match[1]); checkRevision(item, inputBody.expectedRevision);
        const column = next.columns.find(column => column.id === Number(match[2]) && !column.deleted_at);
        if (!column) throw new Error("列不存在。");
        if (column.source_field === "stage") return transition(next, item.id, inputBody.value, inputBody.expectedRevision);
        if (column.source_field) return updatePosition(next, item.id, { [column.source_field]: inputBody.value }, inputBody.expectedRevision);
        item.custom_values[column.id] = inputBody.value; item.local_revision += 1; item.updated_at = isoNow(); return item;
      });
      return response(result);
    }

    match = url.pathname.match(/^\/api\/positions\/(\d+)\/interview-rounds(?:\/(\d+))?$/);
    if (match && method === "POST" && !match[2]) {
      const { result } = await mutate(next => {
        const item = position(next, match[1]);
        if (item.stage !== "面试中") throw new Error("岗位进入面试中后才能建立轮次。");
        const sequence = Math.max(0, ...next.interviewRounds.filter(round => round.position_id === item.id).map(round => round.sequence)) + 1;
        const now = isoNow();
        const round = { id: nextId(next, "round"), position_id: item.id, sequence, label: `第 ${sequence} 轮`, status: "waiting", result: "未定", scheduled_at: "", transcript_ref: "", created_at: now, updated_at: now };
        next.interviewRounds.push(round); return round;
      });
      return response(result, 201);
    }
    if (match && match[2] && method === "PATCH") {
      const { result } = await mutate(next => {
        const round = next.interviewRounds.find(item => item.position_id === Number(match[1]) && item.sequence === Number(match[2]));
        if (!round) throw new Error("面试轮次不存在。");
        Object.assign(round, inputBody, { updated_at: isoNow() }); return round;
      });
      return response(result);
    }
    if (match && match[2] && method === "DELETE") {
      const { result } = await mutate(next => {
        const index = next.interviewRounds.findIndex(item => item.position_id === Number(match[1]) && item.sequence === Number(match[2]));
        if (index < 0) throw new Error("面试轮次不存在。");
        return next.interviewRounds.splice(index, 1)[0];
      });
      return response(result);
    }

    match = url.pathname.match(/^\/api\/intents\/(\d+)\/(accept|reject)$/);
    if (match && method === "POST") {
      const { result } = await mutate(next => {
        const intent = next.intents.find(item => item.id === Number(match[1]));
        if (!intent || intent.status !== "pending") throw new Error("待确认记录不存在或已处理。");
        intent.status = match[2] === "accept" ? "accepted" : "rejected";
        intent.decided_at = isoNow();
        let savedPosition = null;
        if (intent.status === "accepted" && intent.action === "create") savedPosition = newPosition(next, intent.payload);
        return { intent: intentView(next, intent), position: savedPosition };
      });
      return response(result);
    }

    if (method === "POST" && url.pathname === "/api/table-columns") {
      const { result } = await mutate(next => {
        const now = isoNow(); const kind = inputBody.kind || "text";
        const column = { id: nextId(next, "column"), column_key: `custom_${crypto.randomUUID()}`, label: String(inputBody.label || "").trim(), kind, source_field: null, position: next.columns.filter(item => !item.deleted_at).length, width: Math.min(600, Math.max(90, Number(inputBody.width) || 160)), options: kind === "select" ? (inputBody.options || []).map(String).map(item => item.trim()).filter(Boolean) : [], local_revision: 1, created_at: now, updated_at: now, deleted_at: null };
        if (!column.label) throw new Error("请填写列名。"); next.columns.push(column); return column;
      });
      return response(result, 201);
    }
    if (method === "POST" && url.pathname === "/api/table-columns/reorder") {
      const { result } = await mutate(next => {
        inputBody.ids.map(Number).forEach((id, index) => { const column = next.columns.find(item => item.id === id && !item.deleted_at); if (!column) throw new Error("列顺序无效。"); column.position = index; column.local_revision += 1; });
        return next.columns.filter(item => !item.deleted_at).sort((a, b) => a.position - b.position);
      });
      return response({ columns: result });
    }
    match = url.pathname.match(/^\/api\/table-columns\/(\d+)$/);
    if (match && method === "PATCH") {
      const { result } = await mutate(next => {
        const column = next.columns.find(item => item.id === Number(match[1]) && !item.deleted_at); if (!column) throw new Error("列不存在。"); checkRevision(column, inputBody.expectedRevision);
        Object.assign(column, inputBody.patch || inputBody, { local_revision: column.local_revision + 1, updated_at: isoNow() }); return column;
      });
      return response(result);
    }
    if (match && method === "DELETE") {
      const { result } = await mutate(next => {
        const column = next.columns.find(item => item.id === Number(match[1]) && !item.deleted_at); if (!column) throw new Error("列不存在。"); checkRevision(column, inputBody.expectedRevision);
        column.deleted_at = isoNow(); column.local_revision += 1; return { id: column.id, label: column.label, deleted_at: column.deleted_at };
      });
      return response(result);
    }
    return response({ error: "网页本地模式暂不支持此操作。" }, 404);
  } catch (error) {
    return fail(error, /另一页面|更新/.test(error.message) ? 409 : 400);
  }
}

export async function readBrowserState() { return store.initialize(); }
export async function replaceBrowserState(value, expectedRevision) { return store.write(normalizeWebImport(value), expectedRevision); }
export async function updateBrowserState(change) {
  const current = await store.initialize();
  const next = structuredClone(current);
  change(next);
  return store.write(next, current.metadata.revision);
}
export { createWebState };
