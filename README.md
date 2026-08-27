# Job Pipeline Web

这是 Job Pipeline 的静态浏览器版。它与本地高级版共用黄色看板的信息架构，但所有用户数据只保存在当前浏览器的 IndexedDB。

通过 GitHub Pages 打开本项目。公开站点不包含服务器、账号、遥测、Node 运行时、SQLite 数据库或网络数据 API。

首次打开是空白看板。可导入飞书导出的 Excel、本地 Excel、CSV 和网申事实 Markdown，也可导出或恢复完整 JSON 备份。

`skill/job-pipeline-web/` 是唯一的 Agent 引导入口，包含机会检索、招聘通知更新、每日复盘和表格迁移工作流。网页只复制任务，不会直接启动或收费调用 Agent。
