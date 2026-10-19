import {TelegramAPI} from './store.mjs';
const url=process.env.TELEGRAM_WEBHOOK_URL;
const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
if(!/^https:\/\/[a-zA-Z0-9.-]+\/telegram\/webhook$/.test(url||''))
 throw new Error('TELEGRAM_WEBHOOK_URL must be the public HTTPS /telegram/webhook endpoint');
if(!/^[A-Za-z0-9_-]{16,256}$/.test(secret||''))
 throw new Error('TELEGRAM_WEBHOOK_SECRET missing or invalid');
const api=new TelegramAPI(process.env.TELEGRAM_BOT_TOKEN);
await api.webhook(url,secret);
console.log('TeacherPro Telegram webhook installed successfully');
