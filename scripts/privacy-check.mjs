import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "vendor"]);
const allowedExtensions = new Set([".js", ".mjs", ".html", ".css", ".md", ".json"]);
const forbidden = [
  { label: "private absolute path", pattern: /\/Users\/(?!grace\/Code\/job-pipeline-web)/ },
  { label: "credential assignment", pattern: /(?:api[_-]?key|access[_-]?token|password|cookie)\s*[:=]\s*["'][^"'\s]{8,}/i },
  { label: "private key", pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : allowedExtensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

const findings = [];
for (const file of files(root)) {
  const text = fs.readFileSync(file, "utf8");
  forbidden.forEach(rule => { if (rule.pattern.test(text)) findings.push(`${path.relative(root, file)}: ${rule.label}`); });
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Privacy check passed.");
