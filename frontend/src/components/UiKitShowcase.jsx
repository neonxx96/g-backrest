import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { KpiCard, EmptyState, Kbd, StatusDot, SectionHeader } from '@/components/ui/customPrimitives';
import { themeBridge } from '@/theme/themeBridge';
import { THEMES } from '@/theme/themeMeta';
import { Sparkles, Activity, ShieldCheck, Zap, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function UiKitShowcase() {
  const currentTheme = themeBridge.getCurrentTheme();

  return (
    <TooltipProvider>
      <div className="p-6 max-w-5xl mx-auto space-y-6 bg-background text-foreground min-h-screen overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">SignalScript UI-Kit (Dense FinTech)</h1>
            <p className="text-xs text-muted-foreground mt-1">Витрина плотных компонентов shadcn/ui под 4 рыночные темы</p>
          </div>
          <div className="flex items-center gap-1.5 bg-card p-1 border border-border rounded-xs">
            {THEMES.map((t) => (
              <Button
                key={t.id}
                size="xs"
                variant={currentTheme === t.id ? 'accent' : 'ghost'}
                onClick={() => themeBridge.setTheme(t.id)}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </div>

        {/* 1. Кнопки */}
        <section className="space-y-3">
          <SectionHeader title="Кнопки (Button xs / sm / md)" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="default">Купить (xs)</Button>
            <Button size="xs" variant="outline">Лимит (xs)</Button>
            <Button size="xs" variant="subtle">Слои (xs)</Button>
            <Button size="xs" variant="ghost">Скрыть (xs)</Button>
            <Button size="xs" variant="accent" data-active="true">DOM Active (xs)</Button>
            <Button size="xs" variant="destructive">Стоп (xs)</Button>
            <Button size="icon-xs" variant="subtle"><Activity /></Button>
            <Button size="sm" variant="default">Торговля (sm)</Button>
            <Button size="sm" variant="accent">Аналитика (sm)</Button>
            <Button size="md" variant="default">Большая кнопка (md)</Button>
          </div>
        </section>

        {/* 2. Бейджи и Статусы */}
        <section className="space-y-3">
          <SectionHeader title="Бейджи & Индикаторы статуса" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">НЕЙТРАЛЬНО</Badge>
            <Badge variant="success"><ArrowUpRight className="size-3" /> LONG 74.2%</Badge>
            <Badge variant="danger"><ArrowDownRight className="size-3" /> SHORT 25.8%</Badge>
            <Badge variant="warning">КАРАНТИН</Badge>
            <Badge variant="info">AI PILOT</Badge>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-4">
              <StatusDot status="success" pulse />
              <span>WS Live</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot status="warning" />
              <span>Буфер 85%</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot status="danger" />
              <span>Спуфинг</span>
            </div>
          </div>
        </section>

        {/* 3. Инпуты & Kbd */}
        <section className="space-y-3">
          <SectionHeader title="Инпуты & Горячие клавиши" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Тикер</label>
              <Input placeholder="BTCUSDT" className="font-mono" defaultValue="BTCUSDT" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Объем (USDT)</label>
              <Input placeholder="1000" className="font-mono tabular-nums" defaultValue="10,000" />
            </div>
            <div className="flex flex-col justify-end">
              <div className="flex items-center gap-2 h-7">
                <span className="text-xs text-muted-foreground">Центрировать стакан:</span>
                <Kbd>Space</Kbd>
                <span className="text-xs text-muted-foreground">Быстрый ордер:</span>
                <Kbd>Shift + B</Kbd>
              </div>
            </div>
          </div>
        </section>

        {/* 4. KPI-карточки */}
        <section className="space-y-3">
          <SectionHeader title="KPI Карточки" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard title="Баланс Paper" value="$10,452.80" delta={4.52} subtext="12 сделок" />
            <KpiCard title="Винрейт (24ч)" value="68.4%" delta={2.1} subtext="19W / 9L" />
            <KpiCard title="Profit Factor" value="1.84" subtext="Ожидание: +$42.50" />
            <KpiCard title="Плотность стены" value="$4.85M" subtext="Ask 68,500 (+25x)" />
          </div>
        </section>

        {/* 5. Tooltips & Пустые состояния */}
        <section className="space-y-3">
          <SectionHeader title="Tooltips & Empty States" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="xs" variant="outline">Наведи на меня</Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Подсказка с нулевой задержкой</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="xs" variant="subtle"><Zap className="size-3 mr-1" /> Быстрый бэктест</Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Запуск бэктеста по активной стратегии (Ctrl+B)</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <EmptyState icon={ShieldCheck} message="Нет активных ограничений риск-менеджера" />
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
