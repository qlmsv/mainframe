// Spending categories by merchant name, for records that came without one.
// Your own banks and local shops: a personal module (see src/modules.js, parseMail) can set its own.
const CATS = [
  [/grab|gojek|bolt|uber|yandex.?go|taxi|такси|metro|метро/i, 'транспорт и доставка'],
  [/coffee|cafe|caf[eé]|кофе|кафе|starbucks/i, 'кафе'],
  [/restaurant|ресторан|food|еда|kfc|mcdonald|burger|pizza|пицц|bakery|пекарн/i, 'еда'],
  [/market|mart|супермаркет|магазин|7-eleven|circle k|family ?mart|aeon|carrefour|lidl|пятёрочка|пятерочка|магнит|перекрёсток|перекресток/i, 'продукты и магазины'],
  [/apple|google|openai|anthropic|claude|chatgpt|figma|notion|github|vercel|render|cloudflare|netflix|spotify|youtube/i, 'сервисы и подписки'],
  [/pharma|аптек|hospital|clinic|клиник/i, 'здоровье'],
  [/gym|fitness|фитнес|yoga|йога/i, 'спорт'],
];

export const categorize = (merchant = '') => CATS.find(([re]) => re.test(merchant))?.[1] || 'прочее';
