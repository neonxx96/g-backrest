import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'frontend', 'src');
const baselinePath = path.resolve(rootDir, 'design', 'lint-baseline.json');

const updateBaseline = process.argv.includes('--update-baseline');

const EXCLUDE_DIRS = [
  path.resolve(srcDir, 'styles'),
  path.resolve(srcDir, 'theme'),
  path.resolve(srcDir, 'components', 'ui'),
];

const EXCLUDE_FILES = [
  path.resolve(srcDir, 'index.css'),
  path.resolve(srcDir, 'components', 'UiKitShowcase.jsx'),
];

const RAW_COLOR_REGEX = /\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/g;
const RAW_BUTTON_REGEX = /<button\b(?![^>]*\b(?:button-base|asChild)\b)/g;
const RAW_SELECT_REGEX = /<select\b(?![^>]*\b(?:select-base)\b)/g;

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.resolve(dir, file);
    if (EXCLUDE_DIRS.some(ex => fullPath.startsWith(ex))) continue;
    if (EXCLUDE_FILES.includes(fullPath)) continue;
    if (file.endsWith('.test.js') || file.endsWith('.test.jsx')) continue;

    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (/\.(jsx?|tsx?)$/.test(file)) {
      results.push(fullPath);
    }
  }
  return results;
}

let baseline = {};
if (fs.existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (_) {
    baseline = {};
  }
}

const files = getFiles(srcDir);
const report = {};
let totalViolations = 0;
let newFileViolations = 0;
let regressions = 0;

for (const filePath of files) {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');

  const rawColors = (content.match(RAW_COLOR_REGEX) || []).length;
  const rawButtons = (content.match(RAW_BUTTON_REGEX) || []).length;
  const rawSelects = (content.match(RAW_SELECT_REGEX) || []).length;

  const count = rawColors + rawButtons + rawSelects;
  if (count > 0) {
    report[relPath] = {
      total: count,
      rawColors,
      rawButtons,
      rawSelects,
    };
    totalViolations += count;

    const baselineCount = baseline[relPath]?.total;
    if (baselineCount === undefined) {
      newFileViolations += count;
    } else if (count > baselineCount) {
      regressions += (count - baselineCount);
    }
  }
}

if (updateBaseline) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[Design Lint] Baseline updated at ${baselinePath}`);
  console.log(`[Design Lint] Total files with violations: ${Object.keys(report).length}`);
  console.log(`[Design Lint] Total baseline violations: ${totalViolations}`);
  process.exit(0);
}

console.log('--- SignalScript Design System Linter ---');
console.log(`Files scanned: ${files.length}`);
console.log(`Current violations: ${totalViolations} across ${Object.keys(report).length} files`);

const baselineTotal = Object.values(baseline).reduce((acc, f) => acc + (f.total || 0), 0);
console.log(`Baseline violations: ${baselineTotal}`);

if (newFileViolations > 0) {
  console.error(`\n[FAIL] Found ${newFileViolations} design system violations in new un-baselined files!`);
  process.exit(1);
}

if (regressions > 0) {
  console.error(`\n[FAIL] Found ${regressions} design system regression(s) exceeding the baseline!`);
  process.exit(1);
}

const delta = baselineTotal - totalViolations;
if (delta > 0) {
  console.log(`\n🎉 Improvement detected: ${delta} violations eliminated compared to baseline!`);
} else {
  console.log('\n[PASS] No design system regressions detected.');
}
process.exit(0);
