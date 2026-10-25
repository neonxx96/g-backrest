// Интерфейс графического движка приложения (ChartEngine).
//
// Это контракт ПРИЛОЖЕНИЯ, а не названия методов библиотеки: слои Footprint,
// On-Chart DOM, Heatmap и хуки графика должны общаться только с ним.
// Реализация под установленный klinecharts 9.8.12 — KLineChartsV9Adapter.js.
//
// Формат бара (то же, что у marketDataFetcher):
//   Bar = { timestamp:number(ms), open, high, low, close, volume, turnover? }
//
// Координаты (CSS-пиксели относительно главной панели свечей):
//   Coord = { x:number, y:number }          // NaN, если точка не вычислима
//   PriceTime = { timestamp:number, price:number }
//
// Видимый диапазон:
//   VisibleRange = { fromIndex, toIndex, fromTs, toTs }  // индексы и время
//
// Viewport (то, что нужно слоям, чтобы перерисоваться):
//   Viewport = { width, height, barSpace, range:VisibleRange }

/**
 * @typedef {Object} Bar
 * @property {number} timestamp
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 * @property {number} [turnover]
 */

/**
 * @typedef {Object} ChartEngine
 * @property {(container:HTMLElement, opts?:{uiConfig?:object, timezone?:string, barSpaceMin?:number, barSpaceMax?:number}) => void} mount
 * @property {() => void} destroy
 * @property {(bars:Bar[], opts?:{hasMore?:boolean, onDone?:()=>void}) => void} setHistory
 * @property {(bar:Bar) => void} updateBar
 * @property {() => void} clear
 * @property {() => Bar[]} getBars
 * @property {(uiConfig:object) => void} setTheme
 * @property {(points:Array<{timestamp:number, price:number}>) => Array<{x:number,y:number}>} priceTimeToCoord
 * @property {(coords:Array<{x:number,y:number}>) => Array<{timestamp:number, price:number}>} coordToPriceTime
 * @property {() => ({fromIndex:number,toIndex:number,fromTs:(number|null),toTs:(number|null)})} getVisibleRange
 * @property {() => ({width:number,height:number,barSpace:number,range:object})} getViewport
 * @property {(cb:(vp:object)=>void) => (() => void)} subscribeViewportChange
 * @property {(cb:(info:{timestamp:(number|null), price:(number|null)})=>void) => (() => void)} subscribeCrosshair
 * @property {(cb:(oldestTs:number)=>(void|Promise<void>)) => void} setLoadMore
 * @property {() => void} scrollToRealTime
 * @property {(ts:number) => void} scrollToTimestamp
 * @property {() => void} resize
 * @property {() => boolean} isMounted
 * @property {object|null} raw  Escape hatch: нативный инстанс библиотеки для ещё не
 *   мигрированного кода (оверлеи, аннотации, индикаторы). Новый код raw НЕ использует.
 */

export const CHART_ENGINE_METHODS = Object.freeze([
  'mount', 'destroy', 'setHistory', 'updateBar', 'clear', 'getBars', 'setTheme',
  'priceTimeToCoord', 'coordToPriceTime', 'getVisibleRange', 'getViewport',
  'subscribeViewportChange', 'subscribeCrosshair', 'setLoadMore',
  'scrollToRealTime', 'scrollToTimestamp', 'resize', 'isMounted',
]);

/** Возвращает список методов контракта, которых нет у реализации (пустой = всё ок). */
export function missingEngineMethods(engine) {
  return CHART_ENGINE_METHODS.filter((m) => !engine || typeof engine[m] !== 'function');
}
