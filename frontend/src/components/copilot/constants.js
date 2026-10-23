// Модели AI для селектора сайдбара AI Copilot (MODULARIZATION_PLAN п.7).
// Значения совпадают с SUPPORTED_AI_MODELS бэкенда (routers/ai_copilot.py).

const AI_MODELS = [
  {
    id: 'google/gemini-2.0-flash-001',
    label: 'google/gemini-2.0-flash-001 (Быстрая для скальпинга)'
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    label: 'anthropic/claude-3.5-sonnet (Глубокий контекст)'
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'meta-llama/llama-3.3-70b-instruct:free (Резервная бесплатная)'
  },
  {
    id: 'local_orderflow_nlp',
    label: 'Локальный Order Flow NLP-движок (Автономный)'
  }
];

export default AI_MODELS;
