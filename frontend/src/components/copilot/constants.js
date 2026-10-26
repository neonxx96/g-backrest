// Модели AI для селектора сайдбара AI Copilot (MODULARIZATION_PLAN п.7).
// Значения совпадают с SUPPORTED_AI_MODELS бэкенда (routers/ai_copilot.py).

const AI_MODELS = [
  {
    id: 'deepseek/deepseek-v4.1-flash',
    label: '🚀 DeepSeek V4.1 Flash (Основная мощная)'
  },
  {
    id: 'qwen/qwen3.8-flash',
    label: '⚡ Qwen 3.8 Flash (Второй вариант)'
  },
  {
    id: 'qwen/qwen3.5-flash-02-23',
    label: '🪙 Qwen 3.5 Flash (Максимально бюджетная)'
  },
  {
    id: 'auto',
    label: 'Авто — роутер OpenRouter Cascade (с DeepSeek V4.1 Flash)'
  },
  {
    id: 'openrouter/free',
    label: 'Free Models Router OpenRouter (Бесплатный резерв)'
  },
  {
    id: 'local_orderflow_nlp',
    label: 'Локальный Order Flow NLP-движок (Автономный)'
  }
];

export default AI_MODELS;
