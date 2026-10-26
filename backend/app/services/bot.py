"""
Telegram Bot Service (aiogram 3)
Handles user commands and delivers real-time signal notifications with direct chart links.
"""

import asyncio
import logging
from typing import List, Dict, Any, Optional
from aiogram import Bot, Dispatcher, types
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart, Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy import select

from backend.app.config import TELEGRAM_BOT_TOKEN, FRONTEND_URL
from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import UserSetting, SignalHistory

logger = logging.getLogger(__name__)

bot: Optional[Bot] = None
dp: Optional[Dispatcher] = None

if TELEGRAM_BOT_TOKEN:
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    dp = Dispatcher()

def get_bot() -> Optional[Bot]:
    return bot

if dp:
    @dp.message(CommandStart())
    async def cmd_start(message: types.Message):
        user_id = str(message.from_user.id)
        first_name = message.from_user.first_name or "Трейдер"

        # Register user in DB with default settings if not exists
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
            setting = res.scalar_one_or_none()
            if not setting:
                setting = UserSetting(user_id=user_id, notifications_enabled=True)
                db.add(setting)
                await db.commit()

        web_url = f"{FRONTEND_URL}/?user_id={user_id}"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📊 Открыть Веб-Терминал", url=web_url)],
            [InlineKeyboardButton(text="⚙️ Проверить Фильтры", callback_data="show_filters")]
        ])

        welcome_text = (
            f"👋 Привет, <b>{first_name}</b>!\n\n"
            f"🤖 Бот <b>Signal Script</b> подключен и мониторит Binance USDT-M Futures.\n\n"
            f"📡 <b>Что я умею:</b>\n"
            f"• Отслеживать аномалии объемов, EMA(20) кроссы, RSI и ликвидации.\n"
            f"• Мгновенно слать сигналы со ссылкой на ваш интерактивный график.\n"
            f"• Применять настройки фильтров из веб-интерфейса без перезапуска.\n\n"
            f"🔗 Ваш веб-интерфейс: <a href='{web_url}'>{web_url}</a>\n"
            f"Используйте /status для проверки текущего состояния."
        )
        await message.answer(welcome_text, parse_mode=ParseMode.HTML, reply_markup=kb)

    @dp.message(Command("status"))
    async def cmd_status(message: types.Message):
        user_id = str(message.from_user.id)
        async with AsyncSessionLocal() as db:
            # User settings
            res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
            setting = res.scalar_one_or_none() or UserSetting(user_id="0")
            
            # Recent 3 signals
            sig_res = await db.execute(select(SignalHistory).order_by(SignalHistory.created_at.desc()).limit(3))
            recent_signals = sig_res.scalars().all()

        sig_lines = ""
        if recent_signals:
            for s in recent_signals:
                sig_lines += f"\n• <b>{s.symbol}</b> ({s.timeframe}): {s.description} [${s.price}]"
        else:
            sig_lines = "\n<i>(Сигналов за последнее время не зафиксировано)</i>"

        text = (
            f"📊 <b>СТАТУС СИСТЕМЫ:</b>\n"
            f"• Активный ТФ: <code>{setting.timeframe}</code>\n"
            f"• Уведомления: {'🟢 ВКЛ' if setting.notifications_enabled else '🔴 ВЫКЛ'}\n"
            f"• Фильтр цены: >= {setting.price_change_min}%\n"
            f"• Кулдаун: {setting.cooldown_minutes} мин\n\n"
            f"⏱ <b>Последние сигналы:</b>{sig_lines}"
        )
        await message.answer(text, parse_mode=ParseMode.HTML)

    @dp.message(Command("filters"))
    async def cmd_filters(message: types.Message):
        user_id = str(message.from_user.id)
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
            s = res.scalar_one_or_none() or UserSetting(user_id="0")

        text = (
            f"⚙️ <b>ВАШИ ФИЛЬТРЫ:</b>\n\n"
            f"• ТФ: <b>{s.timeframe}</b>\n"
            f"• Изменение цены 24ч: >= <b>{s.price_change_min}%</b> ({'ВКЛ' if s.price_change_enabled else 'ВЫКЛ'})\n"
            f"• Изменение OI 24ч: >= <b>{s.oi_change_min}%</b> ({'ВКЛ' if s.oi_change_enabled else 'ВЫКЛ'})\n"
            f"• Ликвидации 24ч: >= <b>${s.liquidation_min_usd:,.0f}</b> ({'ВКЛ' if s.liquidation_enabled else 'ВЫКЛ'})\n"
            f"• EMA(20) кросс: <b>{'ВКЛ' if s.ema_cross_enabled else 'ВЫКЛ'}</b>\n"
            f"• Всплеск объема: >= <b>{s.vol_spike_mult}x MA20</b> ({'ВКЛ' if s.vol_spike_enabled else 'ВЫКЛ'})\n"
            f"• RSI диапазон: <b>{s.rsi_min} - {s.rsi_max}</b> ({'ВКЛ' if s.rsi_filter_enabled else 'ВЫКЛ'})\n"
            f"• Кулдаун: <b>{s.cooldown_minutes} мин</b>\n\n"
            f"💡 <i>Настройки можно мгновенно менять в веб-интерфейсе!</i>"
        )
        await message.answer(text, parse_mode=ParseMode.HTML)

from collections import deque
import time
from backend.app.utils import format_kyiv_time

# Rate limiter: track timestamps of sent alerts
_sent_alert_timestamps = deque()
MAX_ALERTS_PER_MINUTE = 10

async def broadcast_signal(signal: Dict[str, Any]):
    """
    Sends signal notification to all subscribed Telegram users with Kyiv time and anti-spam protection.
    """
    if not bot:
        logger.warning("Telegram Bot is not initialized or token missing.")
        return

    now = time.time()
    # Purge timestamps older than 60 seconds
    while _sent_alert_timestamps and now - _sent_alert_timestamps[0] > 60:
        _sent_alert_timestamps.popleft()

    if len(_sent_alert_timestamps) >= MAX_ALERTS_PER_MINUTE:
        logger.warning(f"Telegram alert rate limit reached ({MAX_ALERTS_PER_MINUTE}/min). Suppressing alert for {signal.get('symbol')} to avoid spam.")
        return

    sym = signal['symbol']
    tf = signal['timeframe']
    price = signal['price']
    desc = signal['description']
    direct = signal.get('direction', 'ALERT')

    icon = "🟢" if direct == 'BULLISH' else ("🔴" if direct == 'BEARISH' else "⚡")
    chart_link = f"{FRONTEND_URL}/?symbol={sym}&tf={tf}"
    kyiv_time = format_kyiv_time()

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📈 Открыть график", url=chart_link)]
    ])

    msg_text = (
        f"{icon} <b>#{sym}</b> | <code>{tf}</code>\n"
        f"⚡ <b>Триггер:</b> {desc}\n"
        f"💰 <b>Цена:</b> <code>{price}</code>\n"
        f"🕒 <b>Время:</b> <code>{kyiv_time}</code> (Киев)\n\n"
        f"🔗 <a href='{chart_link}'>Открыть график в терминале</a>"
    )

    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(UserSetting.user_id).where(
                UserSetting.user_id != "0",
                UserSetting.notifications_enabled == True
            ))
            subscribers = res.scalars().all()

        for uid in subscribers:
            try:
                await bot.send_message(chat_id=uid, text=msg_text, parse_mode=ParseMode.HTML, reply_markup=kb)
                _sent_alert_timestamps.append(now)
            except Exception as e:
                logger.warning(f"Could not send signal to telegram user {uid}: {e}")
    except Exception as e:
        logger.error(f"Error in broadcast_signal: {e}")


async def broadcast_alert(text: str) -> None:
    """Системное оповещение (Warning Sentinel, задача 7.2) всем подписчикам.

    Без rate-limit очереди сигналов: sentinel сам кулдаунит по ключу алерта.
    """
    if not bot:
        logger.warning("Telegram Bot is not initialized or token missing; alert suppressed.")
        return
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(UserSetting.user_id).where(
                UserSetting.user_id != "0",
                UserSetting.notifications_enabled == True
            ))
            subscribers = res.scalars().all()
        for uid in subscribers:
            try:
                await bot.send_message(chat_id=uid, text=text, parse_mode=ParseMode.HTML)
            except Exception as e:
                logger.warning(f"Could not send alert to telegram user {uid}: {e}")
    except Exception as e:
        logger.error(f"Error in broadcast_alert: {e}")


async def start_bot_polling():
    """Runs bot polling loop in background."""
    if bot and dp:
        logger.info("Starting Telegram Bot polling...")
        try:
            await dp.start_polling(bot, handle_signals=False)
        except Exception as e:
            logger.error(f"Telegram Bot polling error: {e}")
