/**
 * Stage 8C: privacy policy and terms of use, served by the backend and linked from the customer app.
 * The text describes what this system actually does (read from the code, see docs/PROD_READINESS.md). It names the operator and a contact
 * from configuration and refuses to publish (503) until both are set: a policy without a responsible party is worse than none.
 * It is a working document for the pilot and must be reviewed by the operator's own legal adviser before the service is opened to the public.
 */
import { receiptRetentionDays } from '../refunds/retention-config.js';

export type LegalKind = 'privacy' | 'terms';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface LegalConfig { operator: string; contact: string; receiptDays: number; supportHours: string | null }

export function legalConfig(env: NodeJS.ProcessEnv = process.env): LegalConfig | null {
  const operator = env.LEGAL_OPERATOR_NAME?.trim() ?? '';
  const contact = env.LEGAL_OPERATOR_CONTACT?.trim() ?? '';
  if (operator.length < 3 || contact.length < 3) return null;
  return {
    operator: operator.slice(0, 200), contact: contact.slice(0, 200),
    receiptDays: receiptRetentionDays(env),
    supportHours: env.LEGAL_SUPPORT_HOURS?.trim() ? env.LEGAL_SUPPORT_HOURS.trim().slice(0, 200) : null,
  };
}

const page = (title: string, body: string): string => `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;margin:0;padding:20px 16px 48px;max-width:720px;margin-inline:auto;color:#1b1b1f;background:#fff}
h1{font-size:22px}h2{font-size:17px;margin-top:26px}li{margin:4px 0}.small{color:#555;font-size:13px}
@media (prefers-color-scheme: dark){body{background:#121214;color:#e8e8ea}.small{color:#aaa}}</style></head>
<body>${body}</body></html>`;

export function renderLegalPage(kind: LegalKind, cfg: LegalConfig): string {
  const op = escapeHtml(cfg.operator);
  const contact = escapeHtml(cfg.contact);
  const hours = cfg.supportHours ? `<p>Yordam xizmati ish vaqti: ${escapeHtml(cfg.supportHours)}.</p>` : '';
  if (kind === 'privacy') {
    return page('Maxfiylik siyosati', `
<h1>Maxfiylik siyosati</h1>
<p class="small">DS Delivery — sinov (pilot) bosqichi. Mas’ul tomon: ${op}. Aloqa: ${contact}.</p>
<h2>Qanday ma’lumotlar yig‘iladi</h2>
<ul>
<li>Telefon raqamingiz va yetkazish manzili (xohlasangiz xarita koordinatalari) — buyurtmani bajarish uchun.</li>
<li>Ismingiz va Telegram identifikatoringiz — faqat Telegram orqali kirsangiz yoki ilovani Telegramga bog‘lasangiz.</li>
<li>Ilova o‘rnatilganda yaratiladigan tasodifiy qurilma/seans identifikatori — Telegramsiz buyurtma berish uchun.</li>
<li>Buyurtma tarixi: mahsulotlar, summa, holatlar, vaqtlar; to‘lov va qaytarish yozuvlari (summa, vaqt, restoran kartasining oxirgi 4 raqami). Sizning karta ma’lumotlaringiz saqlanmaydi.</li>
<li>Yordam so‘rovlaringiz va yozishmalar.</li>
<li>Texnik jurnallar (IP manzil, so‘rov vaqti) — xavfsizlik va xatolarni topish uchun.</li>
</ul>
<h2>Nima uchun ishlatiladi</h2>
<p>Buyurtmani qabul qilish, to‘lovni tekshirish, taom tayyorlash, taksi orqali yetkazish, pulni qaytarish va yordam ko‘rsatish hamda firibgarlikdan himoya qilish uchun. Ma’lumotlar sotilmaydi va reklama uchun ishlatilmaydi.</p>
<h2>Kimlarga beriladi</h2>
<ul>
<li>Buyurtma berilgan restoranga: buyurtma tarkibi, telefon raqami va manzil.</li>
<li>Yetkazishni bajaruvchi taksi operatoriga: olib ketish va yetkazish manzili, telefon raqami.</li>
<li>Telegram: bildirishnomalar yuborilganda (agar Telegramdan foydalansangiz).</li>
</ul>
<p>Qonun talab qilgan hollar bundan mustasno.</p>
<h2>Qancha vaqt saqlanadi</h2>
<ul>
<li>Buyurtma va to‘lov yozuvlari hisob-kitob va nizolarni hal qilish uchun saqlanadi.</li>
<li>Pulni qaytarish cheki rasmlari ${cfg.receiptDays} kundan keyin o‘chiriladi.</li>
</ul>
<h2>Huquqlaringiz</h2>
<p>Ma’lumotlaringiz haqida so‘rash, tuzatish yoki o‘chirishni talab qilish uchun ${contact} ga murojaat qiling. Hisob-kitob uchun qonun bo‘yicha saqlanishi shart yozuvlar o‘chirilmasligi mumkin.</p>
${hours}`);
  }
  return page('Foydalanish shartlari', `
<h1>Foydalanish shartlari</h1>
<p class="small">DS Delivery — sinov (pilot) bosqichi. Mas’ul tomon: ${op}. Aloqa: ${contact}.</p>
<h2>Xizmat nima</h2>
<p>DS Delivery mijozni restoran va yetkazib berish uchun taksi operatori bilan bog‘laydi. Taom restorandan tayyorlanadi va taksi orqali yetkaziladi.</p>
<h2>To‘lov</h2>
<ul>
<li>Taom puli to‘g‘ridan-to‘g‘ri restoranning kartasiga o‘tkaziladi. Platforma pulni o‘zida saqlamaydi.</li>
<li>Ilova ko‘rsatgan <b>aniq summani</b> ko‘rsatilgan vaqt ichida o‘tkazing. Boshqa summa yoki kech o‘tkazma avtomatik qabul qilinmasligi va qo‘lda tekshirilishi mumkin.</li>
<li>Restoran pulni bankda tekshirib tasdiqlagandan keyingina taom tayyorlanadi.</li>
<li>Taom narxlariga platformaning xizmat haqi kiritilgan. Ilovada ko‘rsatilgan narx yakuniy: ustiga hech narsa qo‘shilmaydi. Savat kattalashgan sari taomlar narxi kamayishi mumkin.</li>
</ul>
<h2>Bekor qilish va pulni qaytarish</h2>
<ul>
<li>To‘lanmagan buyurtmani istalgan vaqt bekor qilish mumkin.</li>
<li>To‘langan buyurtmani bekor qilish so‘rovi restoranga boradi. Restoran pulni qaytarsa, bank chekining rasmini yuklaydi va siz uni buyurtma sahifasida ko‘rasiz.</li>
<li>Pul kelmagan bo‘lsa, buyurtma sahifasidan yordam so‘rang.</li>
</ul>
<h2>Yetkazish</h2>
<p>Taksi qabul qilinishi yetkazilganini bildirmaydi. Buyurtma yetkazilgani operator yoki siz tomonidan tasdiqlanadi. Narx va vaqt taksi tarifiga bog‘liq bo‘lishi mumkin.</p>
<h2>Siz nima uchun javobgarsiz</h2>
<p>To‘g‘ri telefon raqami va manzil kiriting, boshqa shaxsning nomidan soxta buyurtma bermang, to‘lov ma’lumotlarini o‘zgartirmang.</p>
<h2>O‘zgarishlar</h2>
<p>Sinov bosqichida shartlar o‘zgarishi mumkin; joriy variant shu sahifada turadi.</p>
${hours}`);
}
