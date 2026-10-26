# STRATEGY_FIXES_MATRIX — матрица «было/стало» (Фаза 3.3)

Данные: локальный кэш `data/cache/bybit_*_USDT_15m.parquet` (BTC ~14 дн. / 1344 бара, ETH/SOL ~7 дн. / 672 бара; `taker_buy_volume` в кэше нет — delta аппроксимирована из тела свечи, что зашумляет CVD-фильтры).

- **baseline** — все флаги выкл. (поведение марафона, дефолт)
- **fixed** — `use_dynamic_breakeven` + `use_adaptive_wall` + `use_time_stop`(45м, 0.3R) + `use_maker_exits`
- Общие параметры: capital $10k, `use_trailing=True`, Монте-Карло выкл.

| symbol   | strategy       | mode     |   trades |   winrate_pct |   net_pnl |    fees |   roi_pct |
|:---------|:---------------|:---------|---------:|--------------:|----------:|--------:|----------:|
| BTC      | confluence_ema | baseline |       36 |          22.2 |   -605.07 |  234.5  |     -6.05 |
| BTC      | confluence_ema | fixed    |       16 |          62.5 |    -64.66 |   84.53 |     -0.65 |
| BTC      | ema_trend      | baseline |        6 |          16.7 |   -164.06 |   41.6  |     -1.64 |
| BTC      | ema_trend      | fixed    |        3 |          66.7 |    -25.64 |   11.97 |     -0.26 |
| BTC      | naked_test     | baseline |      157 |          26.1 |  -1867.09 |  943.8  |    -18.67 |
| BTC      | naked_test     | fixed    |      456 |          34.4 |  -3665.6  | 2240.56 |    -36.66 |
| ETH      | confluence_ema | baseline |       15 |          33.3 |    -49.62 |   97.4  |     -0.5  |
| ETH      | confluence_ema | fixed    |        8 |          37.5 |     34    |   40.94 |      0.34 |
| ETH      | ema_trend      | baseline |        6 |           0   |   -189.27 |   41.73 |     -1.89 |
| ETH      | ema_trend      | fixed    |        3 |           0   |    -74.67 |   14.98 |     -0.75 |
| ETH      | naked_test     | baseline |      161 |          28.6 |  -1453.84 | 1009.54 |    -14.54 |
| ETH      | naked_test     | fixed    |      266 |          40.6 |  -1544.23 | 1274.41 |    -15.44 |
| SOL      | confluence_ema | baseline |       22 |          36.4 |   -283.12 |  146.28 |     -2.83 |
| SOL      | confluence_ema | fixed    |        7 |          71.4 |    -17.49 |   40.08 |     -0.17 |
| SOL      | ema_trend      | baseline |        6 |          50   |     68.37 |   39.21 |      0.68 |
| SOL      | ema_trend      | fixed    |        4 |          75   |     57.05 |   16.07 |      0.57 |
| SOL      | naked_test     | baseline |      243 |          24.3 |  -3213.2  | 1390.61 |    -32.13 |
| SOL      | naked_test     | fixed    |      311 |          44.7 |  -2236.64 | 1300.14 |    -22.37 |

Все флаги default-off: при выключенных флагах baseline воспроизводится побарово (якорь: golden_ohlcv + confluence_ema = 11 сделок / net_pnl 261.23, см. `backend/tests/test_strategy_weaknesses_fixes.py`).

## Выводы

- **confluence_ema и ema_trend**: пакет правок стабильно режет убыточность (BTC -605→-65, ETH -50→+34, SOL -283→-17), winrate растёт, комиссии падают в 2–3 раза. Основной эффект дают time-stop и maker-выходы.
- **naked_test (BTC/ETH)**: хуже — time-stop закрывает позиции раньше, освобождая слот под ре-энтри (157→456 сделок на BTC), комиссии съедают больше, чем экономят maker-выходы. Для naked_test связку `use_time_stop` + `use_adaptive_wall` включать только после калибровки `time_stop_minutes` под высокочастотный сетап.
- **SOL naked_test**: единственный случай, где fixed лучше (-3213→-2237) — подтверждает, что эффект зависит от монеты и режима рынка.
- Кэш BTC длиннее (14 дн. против 7 у ETH/SOL) — абсолютные PnL между монетами напрямую не сравнивать.