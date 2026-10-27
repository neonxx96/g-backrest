import React, { useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';

export default function PairControlRowActions({
  symbol,
  status = 'active',
  isPaused: isPausedProp,
  hasOpenPosition = false,
  isEmergencyStopped = false,
  onRefresh,
  onStateChanged,
}) {
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pauseAfterClose, setPauseAfterClose] = useState(true);

  const notifyChange = () => {
    if (onRefresh) onRefresh();
    if (onStateChanged) onStateChanged();
  };

  const handlePause = async () => {
    setBusy(true);
    try {
      await fetch(`/api/overnight-pilot/pairs/${encodeURIComponent(symbol)}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ close_position: false, reason: 'MANUAL_USER_PAUSE' }),
      });
      notifyChange();
    } catch (_) {}
    setBusy(false);
  };

  const handleResume = async () => {
    if (isEmergencyStopped) return;
    setBusy(true);
    try {
      await fetch(`/api/overnight-pilot/pairs/${encodeURIComponent(symbol)}/resume`, {
        method: 'POST',
      });
      notifyChange();
    } catch (_) {}
    setBusy(false);
  };

  const handleConfirmClose = async () => {
    setBusy(true);
    setDialogOpen(false);
    try {
      await fetch(`/api/overnight-pilot/pairs/${encodeURIComponent(symbol)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'MANUAL_PAIR_CLOSE',
          pause_after: pauseAfterClose,
        }),
      });
      notifyChange();
    } catch (_) {}
    setBusy(false);
  };

  const isPaused = isPausedProp !== undefined ? Boolean(isPausedProp) : status === 'paused';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center justify-center gap-1">
        {/* Play / Pause Toggle Button */}
        {isPaused ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="icon-xs"
                  variant="outline"
                  disabled={busy || isEmergencyStopped}
                  onClick={handleResume}
                  className="h-6 w-6 border-bull/40 text-bull hover:bg-bull/20 hover:text-bull"
                  data-testid={`btn-resume-${symbol}`}
                >
                  <Play size={11} className="fill-bull/80" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isEmergencyStopped
                ? 'Торговля заблокирована: активен общий аварийный стоп'
                : `Возобновить торговлю по ${symbol}`}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="outline"
                disabled={busy}
                onClick={handlePause}
                className="h-6 w-6 border-warning/40 text-warning hover:bg-warning/20 hover:text-warning"
                data-testid={`btn-pause-${symbol}`}
              >
                <Pause size={11} className="fill-warning/80" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Приостановить торговлю по {symbol} (вход в новые сделки запрещен)
            </TooltipContent>
          </Tooltip>
        )}

        {/* Close Market Position Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="icon-xs"
                variant="outline"
                disabled={busy || !hasOpenPosition}
                onClick={() => setDialogOpen(true)}
                className="h-6 w-6 border-bear/40 text-bear hover:bg-bear/20 hover:text-bear disabled:opacity-30"
                data-testid={`btn-close-pos-${symbol}`}
              >
                <Square size={10} className="fill-bear/80" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {hasOpenPosition
              ? `Закрыть открытую позицию по ${symbol} по рынку`
              : `По паре ${symbol} нет открытой позиции`}
          </TooltipContent>
        </Tooltip>

        {/* Alert Dialog with Pause Checkbox */}
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogContent className="max-w-md bg-card text-card-foreground border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm font-semibold">
                Закрыть позицию по рынку ({symbol})?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground">
                Будет отправлен немедленный рыночный ордер на закрытие всей открытой позиции по{' '}
                <span className="font-mono text-foreground font-semibold">{symbol}</span>. Причина:
                MANUAL_PAIR_CLOSE.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="flex items-center space-x-2 py-2">
              <Checkbox
                id={`pause-after-${symbol}`}
                checked={pauseAfterClose}
                onCheckedChange={(checked) => setPauseAfterClose(Boolean(checked))}
              />
              <label
                htmlFor={`pause-after-${symbol}`}
                className="text-xs font-medium cursor-pointer text-foreground select-none"
              >
                После закрытия поставить пару на паузу
              </label>
            </div>

            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel
                size="xs"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Отмена
              </AlertDialogCancel>
              <AlertDialogAction
                size="xs"
                variant="destructive"
                onClick={handleConfirmClose}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Закрыть по рынку
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
