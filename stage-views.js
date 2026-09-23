export const POSITION_STAGE_VIEWS = ["全部", "待投递", "简历筛选", "待测评", "面试"];

export const STAGE_VIEW_STATUSES = Object.freeze({
  待投递: Object.freeze(["待补信息", "待投递"]),
  简历筛选: Object.freeze(["简历初筛中", "业务复筛中", "简历挂"]),
  待测评: Object.freeze(["待测评"]),
  面试: Object.freeze(["待面试", "面试中", "面试挂"]),
});

export function statusesForStageView(view, allStatuses = []) {
  if (!view) return allStatuses;
  return STAGE_VIEW_STATUSES[view] || [view];
}

export function matchesStageView(stage, view) {
  return !view || statusesForStageView(view).includes(stage);
}
