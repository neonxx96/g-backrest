export const THEMES = [
  {
    id: 'night',
    name: 'Ночная',
    description: 'Сине-графитовая тёмная тема, спокойный контраст, акцент циан',
    isDark: true,
  },
  {
    id: 'neon',
    name: 'Яркая',
    description: 'Глубокий чёрный фон, насыщенные кислотные ликвидации и сигналы',
    isDark: true,
  },
  {
    id: 'mono',
    name: 'Монохромная',
    description: 'Шкала нейтральных серых тонов, минимализм, акцент янтарь',
    isDark: true,
  },
  {
    id: 'day',
    name: 'Дневная',
    description: 'Мягкий светлый фон, сбалансированная контрастность без слепящего белого',
    isDark: false,
  },
];

export const THEME_ALIASES = {
  tealstreet: 'night',
  graphite: 'night',
  cyan_night: 'night',
  tiger: 'neon',
  signal: 'neon',
  bloomberg: 'mono',
};

export const DEFAULT_THEME_ID = 'night';
