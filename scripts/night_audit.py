import json
import sys
import urllib.request
import urllib.error

# Ensure UTF-8 output on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'NightAudit/1.0'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

status = get('http://127.0.0.1:8000/api/overnight-pilot/status')
print('=== OVERNIGHT PILOT STATUS ===')
sessions = status.get('sessions', {})
print('Sessions total:', len(sessions))
running_count = sum(1 for s in sessions.values() if (s.get('paper') or {}).get('is_running'))
print('Running sessions:', running_count)

agg = status.get('aggregate', {})
paper = agg.get('paper', {})
print('\n=== AGGREGATE PAPER ACCOUNT ===')
for k, v in paper.items():
    print(f'  {k}: {v}')

print('\n=== PER SYMBOL SNAPSHOTS ===')
for sym, s in sorted(sessions.items()):
    p = s.get('paper') or {}
    strat = s.get('strategy_type')
    is_run = p.get('is_running')
    trades = p.get('closed_trades', 0)
    pnl = p.get('pnl', 0.0)
    unrl = p.get('unrealized_pnl', 0.0)
    errs = p.get('errors', 0)
    rej = p.get('rejection_counts', {})
    data_status = p.get('data_status')
    print(f"{sym:8s} | {strat:22s} | run={is_run} | data={data_status} | trades={trades} | pnl={pnl:+.2f} | unrl={unrl:+.2f} | errs={errs} | rej={rej}")

print('\n=== RECENT EVENTS (LAST 20) ===')
try:
    events_data = get('http://127.0.0.1:8000/api/overnight-pilot/events?limit=20')
    events = events_data.get('events', [])
    print(f"Total events retrieved: {len(events)}")
    for ev in events[:15]:
        reason_txt = str(ev.get('reason', ''))[:80]
        print(f"  [{ev.get('timestamp')}] {ev.get('symbol', 'N/A'):8s} | {ev.get('source'):10s} | {ev.get('event_type'):20s} | {ev.get('reason_code')}: {reason_txt}")
except Exception as e:
    print('Failed to get events:', e)

print('\n=== RECENT JOURNAL LOGS (LAST 10) ===')
try:
    journal = get('http://127.0.0.1:8000/api/journal/logs?limit=10')
    logs = journal.get('logs', [])
    print(f"Total journal logs retrieved: {len(logs)}")
    for l in logs:
        action = l.get('signal_action', 'N/A')
        pnl = l.get('pnl', 'N/A')
        reason = str(l.get('primary_reason', ''))[:60]
        print(f"  [{l.get('created_at')}] {l.get('symbol', 'N/A'):8s} | {l.get('strategy', 'N/A'):18s} | {action} | PnL: {pnl} | Reason: {reason}")
except Exception as e:
    print('Failed to get journal logs:', e)
