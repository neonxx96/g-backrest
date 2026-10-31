/**
 * SignalScript patch for the dockview-core bundle (applied via `postinstall`).
 *
 * Two guards fix "windows don't move/resize" at its root:
 *
 * 1. SplitView.layout() — any non-finite size entering the splitview poisons
 *    viewItem sizes forever: Math.max(NaN, 0) === NaN, so previousSize stays
 *    NaN, proportions never save, and every later layout re-poisons the model.
 *    Sashes die and toJSON() serializes size:null, which the app's autosave
 *    then persists (self-sustaining poisoned workspaces).
 *
 * 2. DockviewComponent.layout() — calls with non-finite width/height (the app
 *    historically called dockviewApi.layout() with no arguments) collapse the
 *    shell to minimum sizes and, via a ResizeObserver feedback loop, lock a
 *    stale inline size on the grid element. Ignoring them is safe: the
 *    ResizeObserver performs the real layout whenever the element changes.
 *
 * The patch is idempotent and string-based; it fails loudly if the bundle
 * changes and the patch sites disappear.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '..', 'node_modules', 'dockview-core', 'dist', 'package', 'main.esm.mjs');

const PATCHES = [
  {
    name: 'SplitView.layout NaN guard',
    old:
      '\tlayout(size, orthogonalSize) {\n' +
      '\t\tconst previousSize = Math.max(this.size, this._contentSize);\n' +
      '\t\tthis.size = size;\n' +
      '\t\tthis.orthogonalSize = orthogonalSize;\n' +
      '\t\tif (!this._proportions) this.saveProportions();',
    next:
      '\tlayout(size, orthogonalSize) {\n' +
      '\t\t// PATCH(SignalScript): never let NaN/undefined into the size model.\n' +
      '\t\t// Math.max(NaN, 0) === NaN permanently bricks proportions, kills sashes\n' +
      '\t\t// and serializes size:null back into persisted workspaces.\n' +
      '\t\tconst finite = (v) => (typeof v === "number" && isFinite(v) ? v : 0);\n' +
      '\t\tsize = finite(size);\n' +
      '\t\torthogonalSize = finite(orthogonalSize);\n' +
      '\t\tlet previousSize = Math.max(this.size, this._contentSize);\n' +
      '\t\tpreviousSize = finite(previousSize);\n' +
      '\t\tthis.size = size;\n' +
      '\t\tthis.orthogonalSize = orthogonalSize;\n' +
      '\t\tif (!this._proportions) this.saveProportions();',
  },
  {
    name: 'DockviewComponent.layout finite guard',
    old:
      '\tlayout(width, height, forceResize) {\n' +
      '\t\tif (!(forceResize || width !== this.width || height !== this.height)) return;\n' +
      '\t\tthis.gridview.element.style.height = `${height}px`;\n' +
      '\t\tthis.gridview.element.style.width = `${width}px`;\n' +
      '\t\tthis.gridview.layout(width, height);\n' +
      '\t}',
    next:
      '\tlayout(width, height, forceResize) {\n' +
      '\t\t// PATCH(SignalScript): no-arg/NaN layout() calls must not collapse the\n' +
      '\t\t// shell to minimum sizes (sticky inline style + RO feedback loop).\n' +
      '\t\tif (typeof width !== "number" || !isFinite(width) || typeof height !== "number" || !isFinite(height)) return;\n' +
      '\t\tif (!(forceResize || width !== this.width || height !== this.height)) return;\n' +
      '\t\tthis.gridview.element.style.height = `${height}px`;\n' +
      '\t\tthis.gridview.element.style.width = `${width}px`;\n' +
      '\t\tthis.gridview.layout(width, height);\n' +
      '\t}',
  },
];

let raw = readFileSync(BUNDLE, 'utf-8');
const applied = [];
for (const patch of PATCHES) {
  if (raw.includes(patch.next)) {
    applied.push(`${patch.name} (already)`);
    continue;
  }
  const count = raw.split(patch.old).length - 1;
  if (count !== 1) {
    console.error(`[patch-dockview] FATAL: "${patch.name}" found ${count} patch sites, expected 1`);
    process.exit(1);
  }
  raw = raw.replace(patch.old, patch.next);
  applied.push(patch.name);
}
writeFileSync(BUNDLE, raw);
console.log(`[patch-dockview] applied: ${applied.join(', ')}`);
