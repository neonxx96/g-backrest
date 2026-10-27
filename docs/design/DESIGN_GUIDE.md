# Руководство по дизайн-системе SignalScript (shadcn/ui + Tailwind v4)

Настоящее руководство определяет правила создания и модификации компонентов интерфейса торгового терминала SignalScript.

---

## 1. Живой Showcase компонентов
В приложении развернута интерактивная галерея UI-Kit со всеми доступными компонентами, темами, бейджами и слайдерами.
- **URL**: `http://localhost:7100/?uikit=true`
- **Компонент**: `frontend/src/components/UiKitShowcase.jsx`

---

## 2. Архитектура тем и семантические токены
Все цвета строятся строго вокруг CSS-переменных, объединенных в четыре пресета (`night`, `neon`, `mono`, `day`):

| Токен | Назначение | Пример использования |
|---|---|---|
| `bg-background` | Корневой фон терминала | Основные окна, рабочая область |
| `bg-card` | Фон плашек, карточек, панелей | Контейнеры виджетов, модалки |
| `text-card-foreground` | Текст внутри карточек | Заголовки, описания |
| `border-border` | Границы и разделители | Сетки, контуры кнопок, табы |
| `bg-popover` | Выпадающие меню и подсказки | DropdownMenu, Popover, Tooltip |
| `text-foreground` | Основной высококонтрастный текст | Числа, символы, цены |
| `text-muted-foreground` | Второстепенный текст | Лейблы, таймстемпы, суффиксы |
| `bg-primary` / `text-primary` | Акцентный бренд-цвет | Активные вкладки, фокус, кнопки действий |
| `text-bull` / `bg-bull` | Рост / Buy / Long / TP | Лонг-позиции, профит, покупки |
| `text-bear` / `bg-bear` | Падение / Sell / Short / SL | Шорт-позиции, лосс, продажи |

> 🚫 **Категорически запрещено:** использовать raw Tailwind-цвета (`bg-gray-800`, `text-zinc-400`, `border-slate-700`, `text-amber-500` и т.д.).

---

## 3. Масштаб и плотность (Density Tokens)
Терминал ориентирован на высокую информационную плотность и масштабируемость:
- Размеры шрифтов и отступов задаются в `rem` или через семантические классы плотности:
  - Высота тулбаров и строк заголовков: `h-7` (28px) или `h-8` (32px).
  - Размеры текста: `text-[10px]`, `text-xs`, `text-sm`.
  - Внутренние отступы кнопок и инпутов: `px-2 py-0.5` или `p-1`.
  - Зазоры между элементами: `gap-1`, `gap-1.5`, `space-x-1`.
- Запрещены жесткие значения в `px` для отступов и шрифтов. Жесткие `px` разрешены **только** для `1px` границ (`border`, `w-px`) и вычислений размеров буферов `<canvas>`.

---

## 4. Рецепт: Создание нового виджета (Card + Header + Controls)

Каждый новый виджет или док-панель строится по следующему эталонному шаблону:

```jsx
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, RefreshCw } from 'lucide-react';

export default function MyTradingWidget({ symbol = 'BTCUSDT', status = 'active' }) {
  return (
    <Card className="w-full h-full flex flex-col bg-card border-border rounded-none shadow-none font-mono">
      {/* 1. Header (фиксированная высота 28-32px, flex-between) */}
      <CardHeader className="h-7 px-2.5 py-0 border-b border-border flex flex-row items-center justify-between space-y-0 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity size={12} className="text-primary shrink-0" />
          <CardTitle className="text-xs font-bold text-foreground truncate">
            Аналитика · {symbol}
          </CardTitle>
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/40 text-primary">
            {status.toUpperCase()}
          </Badge>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => console.log('refresh')}
          >
            <RefreshCw size={11} className="mr-1" />
            Обновить
          </Button>
        </div>
      </CardHeader>

      {/* 2. Content (ScrollArea со скроллбаром темы) */}
      <CardContent className="flex-1 p-0 min-h-0 overflow-hidden">
        <ScrollArea className="h-full w-full p-2.5 text-xs text-foreground">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-muted-foreground text-[10px]">
              <span>Параметр</span>
              <span className="font-semibold text-foreground">Значение</span>
            </div>
            {/* Содержимое виджета */}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
```

---

## 5. Доступные UI-компоненты (`src/components/ui/`)
- `Button`: варианты `default`, `secondary`, `outline`, `ghost`, `destructive`; размеры `sm`, `dense`, `icon`.
- `Badge`: варианты `default`, `secondary`, `outline`, `destructive`, `bull`, `bear`.
- `Input`: стилизованное поле ввода с фокусом `ring-primary`.
- `Select` / `Combobox`: выпадающие списки с поддержкой клавиатурной навигации.
- `Dialog` / `AlertDialog`: модальные окна подтверждения опасных действий (например, закрытие позиции по рынку).
- `Popover` / `DropdownMenu`: контекстные выпадающие меню.
- `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`: переключатели вкладок.
- `Slider`: плавные ползунки для настройки чувствительности и объемов.
- `Checkbox` / `Switch`: семантические чекбоксы и тумблеры.
- `ScrollArea`: скролл-контейнеры со стилизованными тонкими скроллбарами под текущую тему.
- `Tooltip`: всплывающие подсказки для иконок без текста и горячих клавиш.
