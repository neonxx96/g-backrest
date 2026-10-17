# 🚀 g-backrest: Multi-Timeframe Backtesting, Optimization & Real-Time Probability Engine

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://python.org)
[![CCXT](https://img.shields.io/badge/CCXT-Supported-green.svg)](https://github.com/ccxt/ccxt)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

Профессиональная система для бэктеста внутридневных стратегий, подбора оптимальных параметров (Grid Search) и оценки вероятности сигналов в реальном времени. Разработана для трейдеров, использующих **Tiger Trade**, **Bybit**, **Binance** и **OKX**.

---

## 📌 Ключевые возможности

1. **Мульти-таймфреймовый анализ (MTF Cross / Перекрестие ТФ):**
   - Старший таймфрейм (HTF: 1h / 4h / 1d) определяет глобальный тренд (EMA 50/200, структура).
   - Младший таймфрейм (LTF: 1m / 5m / 15m) ловит точки входа на откате с подтверждением объема.
   - Строгая стыковка данных через `merge_asof(direction='backward')` полностью исключает **Lookahead Bias** (заглядывание в будущее).

2. **Реалистичный симулятор сделок (Backtester):**
   - Учет комиссий биржи (Maker/Taker) и проскальзывания (Slippage).
   - Динамический расчет Take Profit и Stop Loss (на базе волатильности ATR, фиксированных % или Risk/Reward).
   - Поддержка алгоритма **Trailing Stop** для удержания и защиты прибыли.
   - Расчет профессиональных метрик: Win Rate, Profit Factor, Net Profit %, Max Drawdown, Realized R:R, серии побед/поражений.

3. **Оптимизатор параметров (Grid Optimizer):**
   - Автоматический перебор параметров (уровни RSI, множители TP/SL, фильтры объема).
   - Ранжирование и вывод ТОП-конфигураций с максимальным математическим ожиданием.

4. **Сканер вероятностей в реальном времени (Real-Time Scanner):**
   - Мониторинг списка монет (Watchlist) в live-режиме через публичные вебсокеты/API бирж.
   - Оценка вероятности/силы сигнала (Confidence %) на основе конfluence-факторов (тренд + объем + RSI + VWAP).

5. **Гибкие источники данных:**
   - Прямой выгрузчик с бирж через CCXT с автоматической пагинацией и кэшированием в Parquet.
   - Поддержка исторических архивов **[CryptoDataDownload](https://www.cryptodatadownload.com/)**.
   - Готовность к интеграции снимков стакана и сделок **[Crypto Lake](https://crypto-lake.com/)**.

---

## 📂 Структура проекта

```text
d:\AI_agent_space\gemini\
├── config/
│   └── default_config.yaml      # Все настройки стратегии, фильтров и риск-менеджмента
├── data/
│   ├── cache/                  # Быстрый локальный кэш свечей (Parquet)
│   └── sample/                 # Папка для пользовательских CSV (CryptoDataDownload / Crypto Lake)
├── engine/
│   ├── data_loader.py          # Загрузка истории с бирж, парсинг CSV и MTF-синхронизация
│   ├── indicators.py           # Векторный расчет индикаторов (EMA, RSI, MACD, BB, ATR, VWAP)
│   ├── strategy_base.py        # Базовый класс стратегий и расчет уровней TP/SL
│   ├── backtester.py           # Посвечной движок бэктеста с комиссиями и трейлингом
│   ├── optimizer.py            # Grid Search оптимизатор лучших параметров
│   └── scanner.py              # Сканер live-рынка и оценка вероятностей
├── strategies/
│   └── mtf_pullback.py         # Мульти-таймфреймовая стратегия отката по тренду
├── charts/                     # Сгенерированные графики в стиле Tiger Trade
├── analyzer.py                 # Live-анализатор одной пары с рендером графика
├── backtest_cli.py             # CLI для запуска тестов и подбора параметров
├── scanner_cli.py              # CLI сканера рынка в реальном времени
└── requirements.txt
```

---

## ⚡ Быстрый старт

### 1. Установка зависимостей
```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Запуск бэктеста на истории (14 дней, 15m + 1h)
```powershell
.\.venv\Scripts\python.exe backtest_cli.py --symbol BTC/USDT --timeframe 15m --htf 1h --days 14
```

### 3. Подбор оптимальных параметров (Grid Optimization за 30 дней)
```powershell
.\.venv\Scripts\python.exe backtest_cli.py --symbol BTC/USDT --timeframe 15m --htf 1h --days 30 --optimize
```

### 4. Сканирование рынка в реальном времени
```powershell
.\.venv\Scripts\python.exe scanner_cli.py --symbols BTC/USDT,ETH/USDT,SOL/USDT --ltf 15m --htf 1h
```

### 5. Получение актуального графика и индикаторов (Tiger Trade Style)
```powershell
.\.venv\Scripts\python.exe analyzer.py --symbol BTC/USDT --timeframe 15m
```

---

## ⏱️ План реализации на ближайшие 24 часа

| Этап | Задачи | Статус |
|------|--------|--------|
| **Этап 1 (База)** | Движок данных, индикаторы, MTF-синхронизация, бэктестер, сканер |  **Выполнено** |
| **Этап 2 (Данные)** | Интеграция парсера Crypto Lake (стакан/тиковые сделки), расширение кэша | 🔄 **В процессе** |
| **Этап 3 (Стратегии)** | Добавление кластерных индикаторов (Delta/CVD, Volume Profile, POC) | ⏳ **Запланировано** |
| **Этап 4 (Уведомления)**| Live-уведомления при появлении сетапов с высокой вероятностью ($>75\%$) | ⏳ **Запланировано** |
