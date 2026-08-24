import { canWebTransition, isoNow, newId } from "./data-contract.js";

function recordEvent(data, positionId, type, detail, timestamp = isoNow()) {
  data.events.push({ id: newId("event"), position_id: positionId, type, detail, created_at: timestamp });
  return data;
}

export function createPosition(data, input) {
  if (!input.company?.trim() || !input.role_name?.trim()) throw new Error("公司和岗位为必填项。");
  const timestamp = isoNow();
  const position = { id: newId("position"), ...input, company: input.company.trim(), role_name: input.role_name.trim(), assessment_start: "", stage_notes: [], final_result: "未定", deleted_at: null, local_revision: 1, created_at: timestamp, updated_at: timestamp };
  data.positions.push(position);
  return recordEvent(data, position.id, "created", "新增岗位", timestamp);
}

export function updatePosition(data, id, input) {
  const current = data.positions.find(position => position.id === id);
  if (!current) throw new Error("岗位不存在。");
  if (!canWebTransition(current.stage, input.stage)) throw new Error("不能从 " + current.stage + " 直接流转到 " + input.stage + "。");
  const timestamp = isoNow();
  data.positions = data.positions.map(position => position.id === id ? { ...position, ...input, company: input.company.trim(), role_name: input.role_name.trim(), local_revision: position.local_revision + 1, updated_at: timestamp } : position);
  return recordEvent(data, id, current.stage === input.stage ? "updated" : "stage_changed", current.stage === input.stage ? "更新岗位" : current.stage + " -> " + input.stage, timestamp);
}

export function softDeletePosition(data, id) {
  const current = data.positions.find(position => position.id === id);
  if (!current) throw new Error("岗位不存在。");
  const timestamp = isoNow();
  data.positions = data.positions.map(position => position.id === id ? { ...position, deleted_at: timestamp, updated_at: timestamp, local_revision: position.local_revision + 1 } : position);
  return recordEvent(data, id, "deleted", "移至回收站", timestamp);
}

export function restorePosition(data, id) {
  const current = data.positions.find(position => position.id === id);
  if (!current) throw new Error("岗位不存在。");
  const timestamp = isoNow();
  data.positions = data.positions.map(position => position.id === id ? { ...position, deleted_at: null, updated_at: timestamp, local_revision: position.local_revision + 1 } : position);
  return recordEvent(data, id, "restored", "从回收站恢复", timestamp);
}

export function addAssessment(data, positionId, title = "在线测评") {
  if (!data.positions.some(position => position.id === positionId && !position.deleted_at)) throw new Error("岗位不存在或已删除。");
  const timestamp = isoNow();
  data.assessments.push({ id: newId("assessment"), position_id: positionId, title, due_at: "", status: "待完成", notes: "", created_at: timestamp, updated_at: timestamp });
  return recordEvent(data, positionId, "assessment_added", title, timestamp);
}

export function addInterviewRound(data, positionId) {
  if (!data.positions.some(position => position.id === positionId && !position.deleted_at)) throw new Error("岗位不存在或已删除。");
  const timestamp = isoNow();
  const sequence = data.interviewRounds.filter(item => item.position_id === positionId).length + 1;
  const stage = "第 " + sequence + " 轮";
  data.interviewRounds.push({ id: newId("round"), position_id: positionId, sequence, stage, scheduled_at: "", status: "待进行", notes: "", created_at: timestamp, updated_at: timestamp });
  return recordEvent(data, positionId, "interview_added", stage, timestamp);
}
