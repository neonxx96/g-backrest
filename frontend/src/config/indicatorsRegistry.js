/**
 * Декларативный мета-реестр технических индикаторов терминала SignalScript.
 * Поддерживает: RSI, EMA, MACD, BOLL (Bollinger Bands), ATR, SuperTrend, VOL (Volume), CVD (Кумулятивная дельта).
 * 
 * Каждый индикатор содержит:
 * - id: уникальный ключ
 * - name: полное название
 * - shortName: сокращенное имя для отображения в стеке
 * - klineName: имя индикатора в KLineCharts (встроенное или кастомно зарегистрированное)
 * - category: 'Trend' | 'Oscillators' | 'Volatility' | 'OrderFlow'
 * - pane: 'main' (главный график свечей) | 'sub' (отдельная подокно)
 * - height: высота подокна (только для pane: 'sub')
 * - description: описание логики работы индикатора
 * - inputDefs: метаданные параметров для генерации формы ввода в UI
 * - defaultInputs: исходные числовые параметры
 * - styleDefs: метаданные стилизации
 * - defaultStyles: исходные цвета и толщины линий
 */

export const INDICATOR_CATEGORIES = [
  { id: 'all', label: 'Все индикаторы' },
  { id: 'Trend', label: 'Трендовые' },
  { id: 'Oscillators', label: 'Осцилляторы' },
  { id: 'Volatility', label: 'Волатильность' },
  { id: 'OrderFlow', label: 'Order Flow' }
];

export const INDICATORS_REGISTRY = {
  ema: {
    id: 'ema',
    name: 'Exponential Moving Average (EMA)',
    shortName: 'EMA',
    klineName: 'EMA',
    category: 'Trend',
    pane: 'main',
    description: 'Экспоненциальная скользящая средняя с гибким выбором периодов для отслеживания импульса тренда.',
    inputDefs: [
      { key: 'period1', label: 'Период 1 (Fast)', type: 'number', min: 2, max: 200, step: 1, default: 9 },
      { key: 'period2', label: 'Период 2 (Mid)', type: 'number', min: 5, max: 300, step: 1, default: 21 },
      { key: 'period3', label: 'Период 3 (Slow)', type: 'number', min: 10, max: 500, step: 1, default: 50 }
    ],
    defaultInputs: {
      period1: 9,
      period2: 21,
      period3: 50
    },
    styleDefs: [
      { key: 'color1', label: 'Цвет EMA Fast', type: 'color', default: '#38bdf8' },
      { key: 'color2', label: 'Цвет EMA Mid', type: 'color', default: '#f59e0b' },
      { key: 'color3', label: 'Цвет EMA Slow', type: 'color', default: '#a855f7' },
      { key: 'size', label: 'Толщина линий', type: 'number', min: 1, max: 4, step: 0.5, default: 1.5 }
    ],
    defaultStyles: {
      color1: '#38bdf8',
      color2: '#f59e0b',
      color3: '#a855f7',
      size: 1.5
    },
    toCalcParams: (inputs) => [Number(inputs.period1) || 9, Number(inputs.period2) || 21, Number(inputs.period3) || 50],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.color1 || '#38bdf8', size: Number(styles.size) || 1.5, style: 'solid' },
        { color: styles.color2 || '#f59e0b', size: Number(styles.size) || 1.5, style: 'solid' },
        { color: styles.color3 || '#a855f7', size: Number(styles.size) || 1.5, style: 'solid' }
      ]
    })
  },

  boll: {
    id: 'boll',
    name: 'Полосы Боллинджера (Bollinger Bands)',
    shortName: 'BOLL',
    klineName: 'BOLL',
    category: 'Volatility',
    pane: 'main',
    description: 'Динамический конверт волатильности на базе SMA и стандартных отклонений цены.',
    inputDefs: [
      { key: 'period', label: 'Период SMA', type: 'number', min: 5, max: 100, step: 1, default: 20 },
      { key: 'stdDev', label: 'Множитель отклонения (StdDev)', type: 'number', min: 0.5, max: 5.0, step: 0.1, default: 2.0 }
    ],
    defaultInputs: {
      period: 20,
      stdDev: 2.0
    },
    styleDefs: [
      { key: 'midColor', label: 'Средняя линия (Mid)', type: 'color', default: '#eab308' },
      { key: 'upColor', label: 'Верхняя полоса (Upper)', type: 'color', default: '#ef4444' },
      { key: 'dnColor', label: 'Нижняя полоса (Lower)', type: 'color', default: '#10b981' },
      { key: 'size', label: 'Толщина линий', type: 'number', min: 1, max: 4, step: 0.5, default: 1.2 }
    ],
    defaultStyles: {
      midColor: '#eab308',
      upColor: '#ef4444',
      dnColor: '#10b981',
      size: 1.2
    },
    toCalcParams: (inputs) => [Number(inputs.period) || 20, Number(inputs.stdDev) || 2.0],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.upColor || '#ef4444', size: Number(styles.size) || 1.2, style: 'solid' },
        { color: styles.midColor || '#eab308', size: Number(styles.size) || 1.2, style: 'solid' },
        { color: styles.dnColor || '#10b981', size: Number(styles.size) || 1.2, style: 'solid' }
      ]
    })
  },

  supertrend: {
    id: 'supertrend',
    name: 'SuperTrend',
    shortName: 'SuperTrend',
    klineName: 'SuperTrend',
    category: 'Trend',
    pane: 'main',
    description: 'Трендовый фильтр и трейлинг-стоп на базе адаптивной волатильности ATR.',
    inputDefs: [
      { key: 'atrPeriod', label: 'Период ATR', type: 'number', min: 3, max: 50, step: 1, default: 10 },
      { key: 'multiplier', label: 'Мультипликатор фактора', type: 'number', min: 0.5, max: 10.0, step: 0.1, default: 3.0 }
    ],
    defaultInputs: {
      atrPeriod: 10,
      multiplier: 3.0
    },
    styleDefs: [
      { key: 'upColor', label: 'Бычий тренд (Buy)', type: 'color', default: '#10b981' },
      { key: 'dnColor', label: 'Медвежий тренд (Sell)', type: 'color', default: '#ef4444' },
      { key: 'size', label: 'Толщина линии', type: 'number', min: 1, max: 4, step: 0.5, default: 2.0 }
    ],
    defaultStyles: {
      upColor: '#10b981',
      dnColor: '#ef4444',
      size: 2.0
    },
    toCalcParams: (inputs) => [Number(inputs.atrPeriod) || 10, Number(inputs.multiplier) || 3.0],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.upColor || '#10b981', size: Number(styles.size) || 2.0, style: 'solid' }
      ]
    })
  },

  rsi: {
    id: 'rsi',
    name: 'Relative Strength Index (RSI)',
    shortName: 'RSI',
    klineName: 'RSI',
    category: 'Oscillators',
    pane: 'sub',
    height: 70,
    description: 'Индекс относительной силы: оценивает импульс покупок и продаж, зоны перекупленности (>70) и перепроданности (<30).',
    inputDefs: [
      { key: 'period', label: 'Период RSI', type: 'number', min: 2, max: 100, step: 1, default: 14 }
    ],
    defaultInputs: {
      period: 14
    },
    styleDefs: [
      { key: 'color', label: 'Цвет линии RSI', type: 'color', default: '#a855f7' },
      { key: 'size', label: 'Толщина линии', type: 'number', min: 1, max: 4, step: 0.5, default: 1.5 }
    ],
    defaultStyles: {
      color: '#a855f7',
      size: 1.5
    },
    toCalcParams: (inputs) => [Number(inputs.period) || 14],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.color || '#a855f7', size: Number(styles.size) || 1.5, style: 'solid' }
      ]
    })
  },

  macd: {
    id: 'macd',
    name: 'MACD (Схождение / Расхождение скользящих средних)',
    shortName: 'MACD',
    klineName: 'MACD',
    category: 'Oscillators',
    pane: 'sub',
    height: 75,
    description: 'Индикатор импульса: разница между быстрой и медленной EMA с гистограммой дивергенции.',
    inputDefs: [
      { key: 'fast', label: 'Быстрый период', type: 'number', min: 2, max: 100, step: 1, default: 12 },
      { key: 'slow', label: 'Медленный период', type: 'number', min: 5, max: 200, step: 1, default: 26 },
      { key: 'signal', label: 'Сигнальный период', type: 'number', min: 2, max: 50, step: 1, default: 9 }
    ],
    defaultInputs: {
      fast: 12,
      slow: 26,
      signal: 9
    },
    styleDefs: [
      { key: 'difColor', label: 'Линия DIF (Fast-Slow)', type: 'color', default: '#38bdf8' },
      { key: 'deaColor', label: 'Сигнальная линия DEA', type: 'color', default: '#f59e0b' },
      { key: 'upBarColor', label: 'Гистограмма рост', type: 'color', default: '#10b981' },
      { key: 'dnBarColor', label: 'Гистограмма спад', type: 'color', default: '#ef4444' },
      { key: 'size', label: 'Толщина линий', type: 'number', min: 1, max: 4, step: 0.5, default: 1.2 }
    ],
    defaultStyles: {
      difColor: '#38bdf8',
      deaColor: '#f59e0b',
      upBarColor: '#10b981',
      dnBarColor: '#ef4444',
      size: 1.2
    },
    toCalcParams: (inputs) => [Number(inputs.fast) || 12, Number(inputs.slow) || 26, Number(inputs.signal) || 9],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.difColor || '#38bdf8', size: Number(styles.size) || 1.2, style: 'solid' },
        { color: styles.deaColor || '#f59e0b', size: Number(styles.size) || 1.2, style: 'solid' }
      ]
    })
  },

  atr: {
    id: 'atr',
    name: 'Average True Range (ATR)',
    shortName: 'ATR',
    klineName: 'ATR',
    category: 'Volatility',
    pane: 'sub',
    height: 70,
    description: 'Индикатор средней истинной волатильности рынка. Используется для адаптивного расчета стоп-лосса.',
    inputDefs: [
      { key: 'period', label: 'Период ATR', type: 'number', min: 3, max: 100, step: 1, default: 14 }
    ],
    defaultInputs: {
      period: 14
    },
    styleDefs: [
      { key: 'color', label: 'Цвет линии ATR', type: 'color', default: '#10b981' },
      { key: 'size', label: 'Толщина линии', type: 'number', min: 1, max: 4, step: 0.5, default: 1.5 }
    ],
    defaultStyles: {
      color: '#10b981',
      size: 1.5
    },
    toCalcParams: (inputs) => [Number(inputs.period) || 14],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.color || '#10b981', size: Number(styles.size) || 1.5, style: 'solid' }
      ]
    })
  },

  vol: {
    id: 'vol',
    name: 'Объем биржевых торгов (Volume)',
    shortName: 'VOL',
    klineName: 'VOL',
    category: 'OrderFlow',
    pane: 'sub',
    height: 70,
    description: 'Торговый объем с разделением покупок и продаж и скользящей средней объема (MA).',
    inputDefs: [
      { key: 'maPeriod', label: 'Период MA объема', type: 'number', min: 5, max: 100, step: 1, default: 20 }
    ],
    defaultInputs: {
      maPeriod: 20
    },
    styleDefs: [
      { key: 'upColor', label: 'Цвет бычьего бара', type: 'color', default: '#26a69a' },
      { key: 'dnColor', label: 'Цвет медвежьего бара', type: 'color', default: '#ef5350' },
      { key: 'maColor', label: 'Цвет скользящей MA', type: 'color', default: '#f59e0b' }
    ],
    defaultStyles: {
      upColor: '#26a69a',
      dnColor: '#ef5350',
      maColor: '#f59e0b'
    },
    toCalcParams: (inputs) => [Number(inputs.maPeriod) || 20],
    toKlineStyles: (styles) => ({
      bars: [
        { upColor: styles.upColor || '#26a69a', downColor: styles.dnColor || '#ef5350' }
      ]
    })
  },

  cvd: {
    id: 'cvd',
    name: 'Кумулятивная дельта объема (CVD)',
    shortName: 'CVD',
    klineName: 'CVD',
    category: 'OrderFlow',
    pane: 'sub',
    height: 75,
    description: 'Индикатор чистого рыночного дисбаланса: накопленная сумма рыночных покупок минус продажи (Market Aggressor Flow).',
    inputDefs: [
      { key: 'smoothPeriod', label: 'Сглаживание дельты', type: 'number', min: 1, max: 50, step: 1, default: 14 }
    ],
    defaultInputs: {
      smoothPeriod: 14
    },
    styleDefs: [
      { key: 'lineColor', label: 'Цвет линии CVD', type: 'color', default: '#38bdf8' },
      { key: 'posBarColor', label: 'Положительная дельта', type: 'color', default: '#26a69a' },
      { key: 'negBarColor', label: 'Отрицательная дельта', type: 'color', default: '#ef5350' },
      { key: 'size', label: 'Толщина линии', type: 'number', min: 1, max: 4, step: 0.5, default: 1.5 }
    ],
    defaultStyles: {
      lineColor: '#38bdf8',
      posBarColor: '#26a69a',
      negBarColor: '#ef5350',
      size: 1.5
    },
    toCalcParams: (inputs) => [Number(inputs.smoothPeriod) || 14],
    toKlineStyles: (styles) => ({
      lines: [
        { color: styles.lineColor || '#38bdf8', size: Number(styles.size) || 1.5, style: 'solid' }
      ]
    })
  }
};

export const DEFAULT_ACTIVE_INDICATORS = [
  {
    id: 'ema',
    enabled: true,
    inputs: { ...INDICATORS_REGISTRY.ema.defaultInputs },
    styles: { ...INDICATORS_REGISTRY.ema.defaultStyles }
  },
  {
    id: 'vol',
    enabled: true,
    inputs: { ...INDICATORS_REGISTRY.vol.defaultInputs },
    styles: { ...INDICATORS_REGISTRY.vol.defaultStyles }
  }
];
