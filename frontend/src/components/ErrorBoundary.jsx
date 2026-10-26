import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Robust React ErrorBoundary to prevent blank/black screens on uncaught errors.
 * Renders an informative dark-terminal error card with a retry button.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.state.error, this.handleReset)
          : this.props.fallback;
      }

      const isWidget = Boolean(this.props.name);

      return (
        <div
          data-testid="error-boundary-fallback"
          className={`flex flex-col items-center justify-center p-4 bg-[#0B0E11] text-neutral-200 select-none ${
            isWidget ? 'h-full w-full' : 'min-h-screen w-screen'
          }`}
        >
          <div className="max-w-md w-full bg-[#12161F] border border-rose-900/60 rounded-lg p-5 shadow-2xl flex flex-col items-center text-center">
            <div className="p-3 bg-rose-950/70 text-rose-400 rounded-full mb-3 border border-rose-800/40">
              <AlertTriangle size={28} />
            </div>

            <h3 className="text-sm font-bold text-white mb-1 font-mono">
              {this.props.name ? `Ошибка в виджете: ${this.props.name}` : 'Сбой интерфейса терминала'}
            </h3>

            <p className="text-xs text-neutral-400 mb-3 font-mono">
              Компонент перехвачен защитным контуром ErrorBoundary. Работа сервера и торговых сессий продолжается в фоне.
            </p>

            <div className="w-full bg-[#080A0D] border border-neutral-800 rounded p-2.5 text-left mb-4 overflow-auto max-h-36 font-mono text-[11px] text-rose-300">
              {this.state.error?.message || String(this.state.error)}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-xs font-mono transition cursor-pointer"
              >
                <RefreshCw size={12} />
                <span>Попробовать снова</span>
              </button>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-xs font-mono font-bold transition cursor-pointer"
              >
                Перезагрузить страницу
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
