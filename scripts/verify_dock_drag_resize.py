"""Live-проверка: dockview-таб перетаскивается в другую группу, саш меняет размер.

Запуск: .venv\\Scripts\\python.exe scripts/verify_dock_drag_resize.py
Требует: backend на 8000 и фронтенд на 7100.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright


def print_utf8(text):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(text, flush=True)


FRONTEND_URL = "http://127.0.0.1:7100"

LAYOUT_JS = """() => {
  const api = window.__dockviewApi || window.dockviewApi;
  if (!api) return null;
  const json = api.toJSON();
  // структура: grid.root_branch.data (splitview) с ветками
  function leafs(node, acc) {
    if (!node) return acc;
    if (node.type === 'leaf') { acc.push(node.data.id); return acc; }
    (node.data?.branches || []).forEach(b => leafs(b, acc));
    return acc;
  }
  return {
    groups: (json.grid?.root_branch ? leafs(json.grid.root_branch, []) : []),
    raw: json
  };
}"""


def run():
    print_utf8("=" * 70)
    print_utf8("🧪 ПРОВЕРКА DRAG ТАБА И RESIZE САША DOCKVIEW")
    print_utf8("=" * 70)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        print_utf8(f"🌐 Открытие {FRONTEND_URL} ...")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(6000)

        has_dock = page.evaluate("() => !!(window.__dockviewApi || window.dockviewApi)")
        print_utf8(f"   dockview api доступен для теста: {has_dock}")

        # ---- Список табов ----
        tabs = page.locator(".dv-tab")
        n_tabs = tabs.count()
        print_utf8(f"   табов найдено: {n_tabs}")
        if n_tabs < 2:
            print_utf8("   ⚠️ меньше 2 табов — добавляем виджет через хаб не будем, пропуск drag-теста")
        names = [tabs.nth(i).inner_text().strip()[:40] for i in range(min(n_tabs, 6))]
        print_utf8(f"   табы: {names}")

        layout_before = page.evaluate(LAYOUT_JS)

        # ---- Тест 0 (важен до изменения структуры): resize сашем ----
        print_utf8("\n🖱️  Тест 0: resize сашем (drag splitter)")
        sash_info = page.evaluate(
            """() => {
              const out = [];
              document.querySelectorAll('.dv-sash:not(.dv-disabled)').forEach((s) => {
                const r = s.getBoundingClientRect();
                out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, vertical: r.height > 20 && r.width < 40 });
              });
              return out;
            }"""
        )
        vertical = [s for s in sash_info if s["vertical"]]
        print_utf8(f"   сашей активных: {len(sash_info)}, вертикальных: {len(vertical)}")
        resized = False
        if vertical:
            try:
                rects_before = page.evaluate(
                    "() => Array.from(document.querySelectorAll('.dv-groupview')).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })"
                )
                sh = vertical[0]
                # Dockview sashes listen to PointerEvents; CDP mouse drags don't
                # reliably trigger pointerdown here, so dispatch pointer events.
                resized = page.evaluate(
                    """async (sh) => {
                      const sashes = Array.from(document.querySelectorAll('.dv-sash:not(.dv-disabled)'));
                      const sash = sashes.find(s => {
                        const r = s.getBoundingClientRect();
                        return r.height > 20 && r.width < 40;
                      });
                      if (!sash) return false;
                      const r = sash.getBoundingClientRect();
                      const x = r.x + r.width / 2, y = r.y + r.height / 2;
                      const gw = () => Array.from(document.querySelectorAll('.dv-groupview')).map(e => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]);
                      const fire = (type, el, cx, cy) => el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 1, clientX: cx, clientY: cy, button: 0, buttons: type === 'pointerup' ? 0 : 1}));
                      const before = gw();
                      fire('pointerdown', sash, x, y);
                      await new Promise(res => setTimeout(res, 50));
                      for (let i = 1; i <= 10; i++) { fire('pointermove', document, x - i * 20, y); await new Promise(res => setTimeout(res, 30)); }
                      fire('pointerup', document, x - 200, y);
                      await new Promise(res => setTimeout(res, 400));
                      const after = gw();
                      window.__resizeBefore = before; window.__resizeAfter = after;
                      return JSON.stringify(before) !== JSON.stringify(after);
                    }""",
                    sh,
                )
                rb = page.evaluate("() => window.__resizeBefore")
                ra = page.evaluate("() => window.__resizeAfter")
                print_utf8(f"   группы до:  {rb}")
                print_utf8(f"   группы после: {ra}")
            except Exception as exc:  # noqa: BLE001
                print_utf8(f"   resize ошибка: {exc}")
        else:
            print_utf8("   вертикальных сашей нет")

        # ---- Тест 1: drag таба в другое место (к центру другой группы) ----
        print_utf8("\n🖱️  Тест 1: перетаскивание таба мышью")
        moved = False
        if n_tabs >= 2:
            try:
                src = tabs.nth(0)
                dst = page.locator(".dv-groupview").nth(1)
                if dst.count() == 0:
                    dst = page.locator(".dv-content-container").nth(0)
                sb = src.bounding_box()
                db = dst.bounding_box()
                if sb and db:
                    page.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
                    page.mouse.down()
                    page.mouse.move(
                        db["x"] + db["width"] * 0.5, db["y"] + db["height"] * 0.5,
                        steps=25,
                    )
                    page.wait_for_timeout(400)
                    page.mouse.up()
                    page.wait_for_timeout(600)
                    moved = True
                    print_utf8("   drag выполнен")
            except Exception as exc:  # noqa: BLE001
                print_utf8(f"   drag ошибка: {exc}")

        layout_after_drag = page.evaluate(LAYOUT_JS)
        changed = json.dumps(layout_before, sort_keys=True) != json.dumps(layout_after_drag, sort_keys=True)
        print_utf8(f"   layout изменился после drag: {changed}")

        # ---- Тест 3: видимость сашей ----
        sash_visible = page.evaluate(
            """() => {
              const s = document.querySelector('.dv-sash:not(.dv-disabled)');
              if (!s) return 'no-sash';
              const cs = getComputedStyle(s);
              return { bg: cs.backgroundColor, w: s.getBoundingClientRect().width };
            }"""
        )
        print_utf8(f"\n👁️  Саш: {sash_visible}")

        print_utf8("\n" + "=" * 70)
        ok = (moved and changed) or changed
        print_utf8(f"DRAG: {'✅' if ok else '❌'} | RESIZE: {'✅' if resized else '❌'}")
        if errors:
            print_utf8(f"JS-ошибки страницы: {errors[:3]}")
        print_utf8("=" * 70)
        browser.close()
        return 0 if (ok and resized) else 1


if __name__ == "__main__":
    sys.exit(run())
