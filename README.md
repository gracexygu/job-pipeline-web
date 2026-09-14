# Job Pipeline Web

这是 Job Pipeline 的静态浏览器版，采用黄色看板的信息架构，用户数据保存在当前浏览器的 IndexedDB。

通过 GitHub Pages 打开本项目。页面运行在浏览器中，数据和文件处理保持在当前浏览器环境。

首次打开是空白看板。可导入飞书导出的 Excel、本地 Excel、CSV 和网申事实 Markdown，也可导出或恢复完整 JSON 备份。

`skill/job-pipeline-web/` 是 Agent 引导入口，包含机会检索、招聘通知更新、每日复盘和表格迁移工作流。网页提供可复制的任务内容，用户可交给自己选择的 Agent 执行。
