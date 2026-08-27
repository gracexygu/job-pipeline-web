---
name: job-pipeline-web
description: Help a user maintain the browser-local Job Pipeline board, discover job opportunities for human confirmation, process recruiting updates, review daily priorities, or prepare Excel and CSV imports.
---

# Job Pipeline Web

Work with the public board at https://gracexygu.github.io/job-pipeline-web/.

The board has no account, server, or built-in Agent. Its state belongs to the user's current browser. Do not claim direct access unless a browser-control tool can actually inspect and operate the open page.

## Shared boundaries

- Never submit an application, send a message, accept an interview result, or delete records without the user's explicit confirmation.
- Keep discovered opportunities in `待确认`. Only the user decides whether they enter `待投递`.
- Preserve original URLs and visible evidence. Mark missing fields as unknown; do not invent them.
- After any browser write, read the changed record back and report the fields that were saved.
- When browser control is unavailable, return an importable UTF-8 CSV instead of pretending the board was changed.

## Choose the workflow

### Discover opportunities

Confirm the user's target role, location, time range, and key exclusions. Search low-frequency, favor official or original recruiting sources, and perform a first relevance screen.

For every candidate, capture:

- `公司`
- `岗位`
- `阶段` with the fixed value `待确认`
- `投递链接`
- `匹配理由`
- `截止时间` when visible
- `来源证据`

If browser control is available, add the candidates to `待确认`. Otherwise return CSV with exactly those headers so the user can use `导入 Excel / CSV`.

### Process a recruiting update

Resolve the target from company and role. If more than one record matches, ask the user to choose. Extract only explicit facts from the message: stage, assessment content, deadline, interview round, date, result, and next action.

Routine factual fields may be prepared for saving. Deletion, ambiguous matching, interview results, and formal confirmations remain with the user.

### Daily review

Read only active records needed for the review. Prioritize:

1. overdue or near-term assessment and application deadlines;
2. confirmed interview preparation;
3. pending human confirmations;
4. follow-ups and incomplete records.

Return one highest-priority action first, followed by a short supporting queue when useful.

### Migrate a spreadsheet

Use the board's `导入 Excel / CSV` flow. Map company and role first, preview conversions and skipped rows, then choose append or replace. `待确认` and `检索新机会` rows must remain pending.

Before replacing, preserve the automatically downloaded JSON recovery file. After import, verify counts in both `待确认` and the formal board.

## CSV fallback

Use UTF-8 CSV. Quote values containing commas, quotes, or line breaks and double embedded quotes. Do not include private data that is unrelated to the application record.
