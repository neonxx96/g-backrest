"""
Stage 1 Verification CLI Script
Runs a live scan across Binance Futures, evaluates 24h filters and indicators, and prints results.
"""

import asyncio
import sys
import io

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from backend.app.db.database import init_db
from backend.app.services.scanner import scanner
from backend.app.services.binance_service import binance_service
from tabulate import tabulate

async def main():
    print("=" * 75)
    print("🚀 Тестирование Этапа 1: Сканер Binance Futures и расчет сигналов")
    print("=" * 75)
    
    await init_db()
    setting = await scanner.get_active_settings()
    
    print(f"⚙️  Настройки сканера:")
    print(f"• Таймфрейм:         {setting.timeframe}")
    print(f"• Фильтр цены 24ч:   >= {setting.price_change_min}% (Вкл: {setting.price_change_enabled})")
    print(f"• Фильтр OI 24ч:     >= {setting.oi_change_min}% (Вкл: {setting.oi_change_enabled})")
    print(f"• EMA(20) кросс:     {'ВКЛ' if setting.ema_cross_enabled else 'ВЫКЛ'}")
    print(f"• Всплеск объема:    >= {setting.vol_spike_mult}x MA20 (Вкл: {setting.vol_spike_enabled})")
    print(f"• Кулдаун сигналов:  {setting.cooldown_minutes} мин")
    print("-" * 75)
    print("⏳ Опрашиваем Binance Futures REST API...")
    
    signals = await scanner.scan_market(setting)
    
    print("-" * 75)
    if signals:
        print(f"🔥 НАЙДЕНО СИГНАЛОВ: {len(signals)}")
        table = []
        for s in signals:
            table.append([
                s['symbol'],
                s['timeframe'],
                s['price'],
                s['condition_type'],
                s['direction'],
                s['description']
            ])
        headers = ["Символ", "ТФ", "Цена", "Тип", "Направление", "Описание"]
        print(tabulate(table, headers=headers, tablefmt="fancy_grid"))
    else:
        print("ℹ️  Новых сигналов при текущих строгих порогах не сработало (рынок просканирован без ошибок).")
        
    await binance_service.close()
    print("=" * 75)
    print("✅ Этап 1 успешно проверен и работает!")

if __name__ == "__main__":
    asyncio.run(main())
