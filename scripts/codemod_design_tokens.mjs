import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'frontend', 'src');

const apply = process.argv.includes('--apply');
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const targetFilter = targetArg ? targetArg.split('=')[1] : null;

const EXCLUDE_DIRS = [
  path.resolve(srcDir, 'styles'),
  path.resolve(srcDir, 'theme'),
  path.resolve(srcDir, 'components', 'ui'),
];

const EXCLUDE_FILES = [
  path.resolve(srcDir, 'index.css'),
  path.resolve(srcDir, 'components', 'UiKitShowcase.jsx'),
  // Canvas 2D / WebGL math files
  path.resolve(srcDir, 'components', 'chart', 'densityHeatmapMath.js'),
  path.resolve(srcDir, 'components', 'chart', 'footprintLayerMath.js'),
  path.resolve(srcDir, 'components', 'chart', 'liquidationHeatmapMath.js'),
  path.resolve(srcDir, 'components', 'chart', 'onChartDomMath.js'),
];

// Token replacement rules (order matters: more specific before general)
const REPLACEMENTS = [
  // Backgrounds
  [/\bbg-neutral-950\b/g, 'bg-background'],
  [/\bbg-zinc-950\b/g, 'bg-background'],
  [/\bbg-gray-950\b/g, 'bg-background'],

  [/\bbg-neutral-900\b/g, 'bg-card'],
  [/\bbg-zinc-900\b/g, 'bg-card'],
  [/\bbg-gray-900\b/g, 'bg-card'],

  [/\bbg-neutral-800\b/g, 'bg-muted'],
  [/\bbg-zinc-800\b/g, 'bg-muted'],
  [/\bbg-gray-800\b/g, 'bg-muted'],

  [/\bhover:bg-neutral-800\b/g, 'hover:bg-muted'],
  [/\bhover:bg-zinc-800\b/g, 'hover:bg-muted'],
  [/\bhover:bg-gray-800\b/g, 'hover:bg-muted'],

  [/\bhover:bg-neutral-700\b/g, 'hover:bg-muted/80'],
  [/\bhover:bg-zinc-700\b/g, 'hover:bg-muted/80'],
  [/\bhover:bg-gray-700\b/g, 'hover:bg-muted/80'],

  // Text
  [/\btext-white\b/g, 'text-foreground'],
  [/\btext-neutral-100\b/g, 'text-foreground'],
  [/\btext-zinc-100\b/g, 'text-foreground'],
  [/\btext-gray-100\b/g, 'text-foreground'],

  [/\btext-neutral-200\b/g, 'text-foreground'],
  [/\btext-zinc-200\b/g, 'text-foreground'],
  [/\btext-gray-200\b/g, 'text-foreground'],

  [/\btext-neutral-300\b/g, 'text-foreground/80'],
  [/\btext-zinc-300\b/g, 'text-foreground/80'],
  [/\btext-gray-300\b/g, 'text-foreground/80'],

  [/\btext-neutral-400\b/g, 'text-muted-foreground'],
  [/\btext-neutral-500\b/g, 'text-muted-foreground'],
  [/\btext-neutral-600\b/g, 'text-muted-foreground'],
  [/\btext-zinc-400\b/g, 'text-muted-foreground'],
  [/\btext-zinc-500\b/g, 'text-muted-foreground'],
  [/\btext-zinc-600\b/g, 'text-muted-foreground'],
  [/\btext-gray-400\b/g, 'text-muted-foreground'],
  [/\btext-gray-500\b/g, 'text-muted-foreground'],
  [/\btext-gray-600\b/g, 'text-muted-foreground'],

  [/\bhover:text-white\b/g, 'hover:text-foreground'],

  // Borders & Dividers
  [/\bborder-neutral-800\b/g, 'border-border'],
  [/\bborder-zinc-800\b/g, 'border-border'],
  [/\bborder-gray-800\b/g, 'border-border'],
  [/\bborder-neutral-700\b/g, 'border-border'],
  [/\bborder-zinc-700\b/g, 'border-border'],
  [/\bborder-gray-700\b/g, 'border-border'],

  [/\bdivide-neutral-800\b/g, 'divide-border'],
  [/\bdivide-zinc-800\b/g, 'divide-border'],
  [/\bdivide-gray-800\b/g, 'divide-border'],

  // Bullish / Bearish
  [/\btext-emerald-400\b/g, 'text-bull'],
  [/\btext-green-400\b/g, 'text-bull'],
  [/\btext-emerald-500\b/g, 'text-bull'],
  [/\bbg-emerald-500\/20\b/g, 'bg-bull-soft'],
  [/\bbg-emerald-950\b/g, 'bg-bull-soft'],
  [/\bbg-green-950\b/g, 'bg-bull-soft'],

  [/\btext-rose-400\b/g, 'text-bear'],
  [/\btext-red-400\b/g, 'text-bear'],
  [/\btext-rose-500\b/g, 'text-bear'],
  [/\btext-red-500\b/g, 'text-bear'],
  [/\bbg-rose-500\/20\b/g, 'bg-bear-soft'],
  [/\bbg-rose-950\b/g, 'bg-bear-soft'],
  [/\bbg-red-950\b/g, 'bg-bear-soft'],

  // Warning & Alert
  [/\btext-amber-400\b/g, 'text-warning'],
  [/\btext-yellow-400\b/g, 'text-warning'],
  [/\bborder-amber-500\/40\b/g, 'border-warning/40'],
];

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.resolve(dir, file);
    if (EXCLUDE_DIRS.some((ex) => fullPath.startsWith(ex))) continue;
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

const allFiles = getFiles(srcDir);
const files = targetFilter
  ? allFiles.filter((f) => f.replace(/\\/g, '/').includes(targetFilter))
  : allFiles;

console.log(`--- SignalScript Design Token Codemod ---`);
console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
console.log(`Files to process: ${files.length} (out of ${allFiles.length})`);

let totalModifications = 0;
let modifiedFiles = 0;

for (const filePath of files) {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  let fileReplacements = 0;

  for (const [pattern, replacement] of REPLACEMENTS) {
    const matches = (content.match(pattern) || []).length;
    if (matches > 0) {
      fileReplacements += matches;
      content = content.replace(pattern, replacement);
    }
  }

  if (fileReplacements > 0) {
    modifiedFiles++;
    totalModifications += fileReplacements;
    console.log(`  [${fileReplacements} tokens] ${relPath}`);
    if (apply) {
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
}

console.log(`\nSummary: ${totalModifications} token replacements across ${modifiedFiles} files.`);
if (!apply) {
  console.log(`(Dry run complete. Use --apply to write changes.)`);
}
