const SENSITIVE = /(证件号码|身份证|电话|手机|邮箱|微信|QQ|出生日期|现居住地|通信地址|户籍|籍贯|生源地|紧急联系人|家庭)/i;

export function renderMarkdownPreview(source, { showSensitive = false } = {}) {
  const lines = String(source || "").split(/\r?\n/);
  const sections = splitSections(lines);
  return {
    navigation: buildNavigation(sections),
    html: sections.map(section => renderSection(section, showSensitive)).join(""),
  };
}

export function markdownSections(source) {
  return splitSections(String(source || "").split(/\r?\n/)).map(section => ({
    id: section.id,
    level: section.level,
    title: section.title,
    text: section.lines.join("\n").trim(),
  }));
}

function splitSections(lines) {
  const sections = [];
  let current = { id: "document-intro", level: 1, title: "说明", lines: [] };
  let h2 = "document";
  let count = 0;
  let fenced = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      fenced = !fenced;
      current.lines.push(line);
      continue;
    }
    const heading = fenced ? null : line.match(/^(#{1,3})\s+(.+)$/);
    if (!heading) { current.lines.push(line); continue; }
    if (current.id !== "document-intro" || current.lines.some(value => value.trim())) sections.push(current);
    const level = heading[1].length;
    const title = cleanText(heading[2]);
    if (level === 2) h2 = slug(title) || `section-${sections.length + 1}`;
    count += 1;
    current = { id: level === 2 ? h2 : `${h2}-${slug(title) || count}`, level, title, lines: [] };
  }
  if (current.id !== "document-intro" || current.lines.some(value => value.trim())) sections.push(current);
  return sections;
}

function buildNavigation(sections) {
  const navigation = [];
  let parent = null;
  for (const section of sections) {
    if (section.level === 2) {
      parent = { id: section.id, title: section.title, children: [] };
      navigation.push(parent);
    } else if (section.level === 3 && parent) {
      parent.children.push({ id: section.id, title: section.title });
    }
  }
  return navigation;
}

function renderSection(section, showSensitive) {
  const copy = section.level >= 3 ? `<button class="md-copy-section" type="button" data-copy-section="${attr(section.id)}" title="复制本节">复制本节</button>` : "";
  return `<section class="md-section level-${section.level}" id="${attr(section.id)}" data-md-section="${attr(section.id)}" data-search="${attr(`${section.title}\n${section.lines.join("\n")}`.toLowerCase())}"><header class="md-section-head"><h${Math.max(2, section.level)}>${inline(section.title)}</h${Math.max(2, section.level)}>${copy}</header>${renderBlocks(section.lines, showSensitive)}</section>`;
}

function renderBlocks(lines, showSensitive) {
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim() || /^---+$/.test(line.trim())) { index += 1; continue; }
    if (/^```/.test(line.trim())) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) code.push(lines[index++]);
      index += 1;
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim().startsWith("|") && /^\|?\s*:?-{3,}/.test(lines[index + 1]?.trim() || "")) {
      const headers = tableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(tableRow(lines[index++]));
      output.push(renderTable(headers, rows, showSensitive));
      continue;
    }
    if (/^>\s?/.test(line.trim())) {
      const values = [];
      while (index < lines.length && /^>/.test(lines[index].trim())) values.push(lines[index++].trim().replace(/^>\s?/, ""));
      const text = values.join("\n");
      output.push(copyable("blockquote", text, inline(text).replace(/\n/g, "<br>")));
      continue;
    }
    if (/^[-*]\s+/.test(line.trim()) || /^\d+\.\s+/.test(line.trim())) {
      const ordered = /^\d+\./.test(line.trim());
      const items = [];
      while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index].trim()) : /^[-*]\s+/.test(lines[index].trim()))) {
        items.push(lines[index++].trim().replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""));
      }
      const tag = ordered ? "ol" : "ul";
      output.push(`<${tag}>${items.map(item => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++].trim());
    if (!paragraph.length) paragraph.push(lines[index++].trim());
    const text = paragraph.join("\n");
    output.push(copyable("p", text, inline(text).replace(/\n/g, "<br>")));
  }
  return output.join("");
}

function renderTable(headers, rows, showSensitive) {
  return `<div class="md-table-wrap"><table><thead><tr>${headers.map(header => `<th>${inline(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => {
    const label = cleanText(row[0] || "");
    return `<tr>${row.map((value, index) => {
      const clean = cleanText(value);
      const sensitive = index > 0 && SENSITIVE.test(label);
      const display = sensitive && !showSensitive ? "••••••••" : inline(value);
      const button = index > 0 ? `<button class="md-copy-value" type="button" data-copy-value="${attr(clean)}" title="复制${attr(label || "字段")}">⧉</button>` : "";
      return `<td class="${sensitive ? "md-sensitive" : ""}"><span>${display}</span>${button}</td>`;
    }).join("")}</tr>`;
  }).join("")}</tbody></table></div>`;
}

function copyable(tag, text, html) {
  return `<div class="md-copy-block"><${tag}>${html}</${tag}><button type="button" data-copy-value="${attr(cleanText(text))}" title="复制这段内容">复制</button></div>`;
}

function isBlockStart(lines, index) {
  const value = lines[index].trim();
  return value.startsWith("|") || value.startsWith(">") || /^```/.test(value) || /^[-*]\s+/.test(value) || /^\d+\.\s+/.test(value);
}

function tableRow(line) { return line.trim().replace(/^\||\|$/g, "").split("|").map(value => value.trim()); }
function slug(value) { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, ""); }
function cleanText(value) { return String(value || "").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/\*\*/g, "").trim(); }
function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
}
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function attr(value) { return escapeHtml(value).replace(/\n/g, "&#10;"); }
