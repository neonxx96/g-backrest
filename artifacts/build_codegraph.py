import json, os, collections

ROOT = r"D:\AI_agent_space\gemini"
G = json.load(open(os.path.join(ROOT, "artifacts", "codegraph_raw.json"), encoding="utf-8"))

def layer_of(path):
    p = path.replace("\\", "/")
    if p.startswith("recorder/"): return "REC"
    if p.startswith("backend/tests/"): return "TST"
    if p.startswith("backend/app/routers/"): return "API"
    if p.startswith("backend/app/engine/"): return "ENG"
    if p.startswith("backend/app/services/execution"): return "EXE"
    if p.startswith("backend/app/services/"): return "SRV"
    if p.startswith("backend/app/adapters/"): return "ADP"
    if p.startswith("backend/app/db/"): return "DB"
    if p.startswith("backend/app/"): return "BAS"
    if p.startswith("backend/"): return "BEN"
    if p.startswith("engine/") or p.startswith("strategies/"): return "LEG"
    if p.startswith("frontend/src/components/docking/"): return "DCK"
    if p.startswith("frontend/src/components/"): return "CMP"
    if p.startswith("frontend/src/stores/"): return "STO"
    if p.startswith("frontend/src/services/"): return "SRF"
    if p.startswith("frontend/src/hooks/"): return "HKF"
    if p.startswith("frontend/src/features/"): return "FTR"
    if p.startswith("frontend/src/"): return "FBS"
    return "MIS"

LAYERS = {
 "BAS": ("🏠 Backend Core (точка входа)", "backend/app — main.py, config, utils, logging"),
 "API": ("🔌 Backend Routers (HTTP API)", "backend/app/routers — FastAPI-эндпоинты"),
 "ENG": ("⚙️ Backend Engine (расчётное ядро)", "backend/app/engine — оптимизаторы, walk-forward, regime"),
 "EXE": ("💱 Execution (симуляция исполнения)", "backend/app/services/execution + execution_simulator"),
 "SRV": ("🧠 Backend Services (бизнес-логика)", "backend/app/services — сканер, бэктестер, paper, AI, recorder"),
 "DB":  ("🗄️ Database (модели и доступ)", "backend/app/db — SQLAlchemy, SQLite WAL"),
 "ADP": ("🔁 Exchange Adapters", "backend/app/adapters — BaseExchangeAdapter, Bybit"),
 "REC": ("📦 Recorder (standalone data lake)", "recorder/ — отдельный процесс сбора рынка"),
 "TST": ("🧪 Tests (защитная сеть)", "backend/tests — 212 тестов"),
 "LEG": ("📜 Legacy / root scripts", "корневые CLI-скрипты, engine/, strategies/"),
 "FBS": ("🖥️ Frontend Base (каркас)", "frontend/src — App, main, index.css, theme"),
 "CMP": ("🧩 Frontend Components (основные)", "frontend/src/components — Chart, DOM, панели"),
 "DCK": ("🗂️ Frontend Docking (виджеты-мозаика)", "frontend/src/components/docking — dockview, скринер, лента"),
 "STO": ("📦 Frontend Stores (Zustand)", "frontend/src/stores — persist-хранилища"),
 "SRF": ("🌐 Frontend Services (данные)", "frontend/src/services — fetchers, marketTruth"),
 "HKF": ("🪝 Frontend Hooks", "frontend/src/hooks"),
 "FTR": ("✨ Frontend Features", "frontend/src/features"),
 "MIS": ("❓ Прочее", ""),
}

all_nodes = {}
for lang, files in G.items():
    for path, info in files.items():
        all_nodes[path] = {"lang": lang, "lines": info["lines"], "deps": info["deps"]}

layer_edges = collections.Counter()
ext_deps = collections.Counter()
for path, n in all_nodes.items():
    src_l = layer_of(path)
    for d in n["deps"]:
        if d.startswith("npm:"):
            ext_deps[(src_l, d)] += 1
        else:
            layer_edges[(src_l, layer_of(d))] += 1

fanin = collections.Counter()
for path, n in all_nodes.items():
    for d in n["deps"]:
        if not d.startswith("npm:"):
            fanin[d] += 1

out = []
out.append("""# 🕸️ CODEGRAPH SignalScript — карта кода и модульный граф

> **Назначение:** навигация по кодовой базе для агентов и разработчиков. Каждая нода = файл/модуль; связи = реальные импорты (извлечены AST-парсером Python и regex-парсером JS 2026-10-22).
> **Сырые данные:** `artifacts/codegraph_raw.json` (полный список зависимостей каждого файла).
> **Как пользоваться:** перед работой с модулем — найди ноду по слою, посмотри входящие/исходящие связи, контракты см. ROADMAP.md §0.

""")

np_ = len([1 for n in all_nodes.values() if n["lang"]=="py"])
nj = len([1 for n in all_nodes.values() if n["lang"]=="js"])
out.append(f"## 📊 Сводка\n\n- Нод (файлов): **{len(all_nodes)}** (py: {np_}, js/jsx: {nj})\n")
out.append(f"- Строк кода: py **{sum(n['lines'] for n in all_nodes.values() if n['lang']=='py'):,}**, js/jsx **{sum(n['lines'] for n in all_nodes.values() if n['lang']=='js'):,}**\n")
out.append(f"- Внутренних связей (import): **{sum(layer_edges.values())}**\n\n")

out.append("### 🔥 Топ-хабы по входящим связям (fan-in)\n\n| Файл | Входящих связей | Строк |\n|---|---|---|\n")
for f, c in fanin.most_common(20):
    out.append(f"| `{f}` | {c} | {all_nodes.get(f,{}).get('lines','—')} |\n")
out.append("\n")

out.append("## 🗺️ Граф слоёв (Mermaid)\n\n```mermaid\nflowchart LR\n")
order = ["BEN","BAS","API","ENG","EXE","SRV","DB","ADP","REC","TST","FBS","CMP","DCK","STO","SRF","HKF","FTR","LEG","MIS"]
short = {"BEN":"backend/main+entry","BAS":"app core","API":"routers","ENG":"engine","EXE":"execution","SRV":"services","DB":"db","ADP":"adapters","REC":"recorder","TST":"tests","FBS":"app.jsx base","CMP":"components","DCK":"docking widgets","STO":"stores","SRF":"services FE","HKF":"hooks","FTR":"features","LEG":"legacy scripts","MIS":"misc"}
done = set()
for a in order:
    for b in order:
        key = (a, b)
        if layer_edges.get(key) and key not in done and a != b:
            done.add(key)
            out.append(f'  {a}["{short[a]}"] -->|{layer_edges[key]}| {b}["{short[b]}"]\n')
out.append("```\n\n")

for lid in ["BAS","API","ENG","EXE","SRV","DB","ADP","REC","TST","FBS","CMP","DCK","STO","SRF","HKF","FTR","LEG","MIS"]:
    nodes = sorted([p for p in all_nodes if layer_of(p) == lid], key=lambda p: -all_nodes[p]["lines"])
    if not nodes: continue
    title, desc = LAYERS[lid]
    out.append(f"## {title}\n\n*{desc}* — {len(nodes)} файлов\n\n")
    out.append("| Нода | Строк | Зависит от (внутр.) | Fan-in |\n|---|---|---|---|\n")
    for p in nodes:
        n = all_nodes[p]
        internal = [d for d in n["deps"] if not d.startswith("npm:")]
        deps_s = ", ".join(f"`{os.path.basename(d)}`" for d in internal[:6])
        if len(internal) > 6: deps_s += f" +{len(internal)-6}"
        out.append(f"| `{p}` | {n['lines']:,} | {deps_s or '—'} | {fanin.get(p,0)} |\n")
    outl = collections.Counter()
    for p in nodes:
        for d in all_nodes[p]["deps"]:
            if not d.startswith("npm:"):
                dl = layer_of(d)
                if dl != lid: outl[dl] += 1
    if outl:
        parts = ", ".join(f"{short[k]} ({v})" for k, v in outl.most_common())
        out.append(f"\n**Исходящие связи слоя:** {parts}\n")
    out.append("\n")

out.append("## 📦 Внешние зависимости (npm) по слоям\n\n| Слой | Ключевые пакеты |\n|---|---|\n")
npm_by_layer = collections.defaultdict(set)
for (l, pkg), c in ext_deps.items():
    nm = pkg[4:] if pkg.startswith("npm:") else pkg
    npm_by_layer[l].add(nm.split("/")[0] if not nm.startswith("@") else "/".join(nm.split("/")[:2]))
for l in order:
    if l in npm_by_layer:
        pkgs = sorted(npm_by_layer[l])
        out.append(f"| {l} | {', '.join(pkgs[:20])}{' …' if len(pkgs) > 20 else ''} |\n")

out.append("""
---

## 🧭 Правила работы с графом (для агентов)

1. **Меняя ноду — проверь fan-in:** файлы с высоким fan-in (`orderflow_backtester.py`, `trade_contract.py`, `Chart.jsx`, stores) — контрактные; любое изменение только с тестами.
2. **Слоёвое правило:** API → SRV/ENG → DB; компоненты (CMP/DCK) → STO/SRF. Запрещены обратные связи (DB → SRV, STO → CMP).
3. **REC и TST не зависят от runtime-бэкенда** — recorder отдельный процесс; тесты не импортируют frontend.
4. **EXE (execution_simulator) — заморожен** без согласования (см. HANDOFF.md 🔒).
5. Обновлять этот файл после крупных рефакторингов (перегенерация: `artifacts/codegraph_raw.json` + build-скрипт).
""")

open(os.path.join(ROOT, "CODEGRAPH.md"), "w", encoding="utf-8").write("".join(out))
print("written bytes:", len("".join(out)))
