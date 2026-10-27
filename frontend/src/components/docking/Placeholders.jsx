import React from 'react';
import { Activity } from 'lucide-react';
import ChannelSelector from './ChannelSelector';
import { useColorLinksStore } from '../../stores/colorLinksStore';

export function CvdPlaceholderWidget({ panelId = 'cvd_placeholder' }) {
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));

  return (
    <div
      data-testid="cvd-placeholder-widget"
      className="h-full w-full flex flex-col font-sans select-none bg-[#0a0d14] text-[#d1d4dc] border-r border-[#1a1f2c]"
    >
      <div className="px-2.5 py-1.5 border-b border-[#1f2638] bg-[#0f1420] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5">
          <Activity size={12} className="text-[#10b981]" />
          <span className="font-bold text-[11px] text-foreground">CVD (Кумулятивная дельта)</span>
          <span className="text-[10px] text-[#34d399] font-mono font-semibold">
            {currentSymbol}
          </span>
        </div>
        <ChannelSelector panelId={panelId} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
        <div className="p-3 rounded-full bg-[#064e3b30] border border-[#05966940] text-[#10b981]">
          <Activity size={24} className="animate-pulse" />
        </div>
        <div className="space-y-1 max-w-sm">
          <div className="font-bold text-foreground text-[12px]">
            Кумулятивная дельта объема (CVD) в реальном времени
          </div>
          <div className="text-[10.5px] text-[#94a3b8] leading-relaxed">
            Отслеживает суммарную разницу между рыночными покупками и продажами (Market Aggression)
            и сопоставляет её с движением цены для выявления скрытых лимитных айсбергов по{' '}
            <span className="font-mono text-foreground font-semibold">{currentSymbol}</span>.
          </div>
        </div>
        <div className="px-3 py-1 rounded bg-[#064e3b40] text-[#34d399] border border-[#10b98140] text-[9.5px] font-mono">
          Готовые серверные точки поступают с микросекундной точностью
        </div>
      </div>
    </div>
  );
}
