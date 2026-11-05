/**
 * Stage 8C: privacy policy and terms of use, served by the backend and linked from the customer app.
 * The text describes what this system actually does (read from the code, see docs/PROD_READINESS.md). It names the operator and a contact
 * from configuration and refuses to publish (503) until both are set: a policy without a responsible party is worse than none.
 * It is a working document for the pilot and must be reviewed by the operator's own legal adviser before the service is opened to the public.
 */
import { receiptRetentionDays } from '../refunds/retention-config.js';

export type LegalKind = 'privacy' | 'terms' | 'delete-account';

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
  if (kind === 'delete-account') {
    return page('Hisobni o‘chirish', `
<h1>DS Delivery: hisobni o‘chirish</h1>
<p class="small">Mas’ul tomon: ${op}. Aloqa: ${contact}.</p>
<h2>Ilova ichida</h2>
<p><b>Profil → Hisobni o‘chirish</b> tugmasini bosing va tasdiqlang. Hisob darhol o‘chiriladi.</p>
<h2>Ilovasiz (o‘rnatilmagan yoki telefon yo‘qolgan bo‘lsa)</h2>
<p>${contact} manziliga “DS Delivery hisobini o‘chiring” deb yozing va hisobingizdagi <b>telefon raqamini</b> (yoki Telegram foydalanuvchi nomingizni) ko‘rsating. Shaxsingizni tasdiqlash uchun sizdan qo‘shimcha ma’lumot so‘rashimiz mumkin. So‘rov 30 kun ichida bajariladi.</p>
<h2>Nima o‘chiriladi</h2>
<ul>
<li>Ismingiz, telefon raqamingiz, Telegram identifikatoringiz.</li>
<li>Saqlangan manzillaringiz va xarita nuqtalari.</li>
<li>Qurilma/seans identifikatorlari (ilovadagi kirish bekor qilinadi).</li>
<li>Buyurtmalardagi telefon raqami, manzil va koordinatalar; joy band qilishdagi ism, telefon va izoh.</li>
<li>Baho izohlari va yordam yozishmalaridagi matnlaringiz.</li>
</ul>
<h2>Nima saqlanadi</h2>
<ul>
<li>Buyurtma, to‘lov va pulni qaytarish yozuvlari (summa, vaqt, holat) — hisob-kitob va nizolarni hal qilish uchun. Ular endi sizning ismingiz, telefoningiz yoki manzilingizga bog‘lanmaydi.</li>
<li>Bloklangan yoki firibgarlik belgisi bor hisoblarda Telegram identifikatori saqlanadi, aks holda o‘chirib qayta kirish orqali blokdan qutulish mumkin bo‘lardi.</li>
</ul>
<h2>Qachon o‘chirib bo‘lmaydi</h2>
<p>Tugallanmagan buyurtmangiz, to‘lanmagan yoki kelgusi joy bron qilishingiz yoki ochiq pul qaytarish so‘rovingiz bo‘lsa, avval ularni yakunlang yoki bekor qiling, so‘ng o‘chiring.</p>
${hours}`);
  }
  if (kind === 'privacy') {
    return page('Maxfiylik siyosati', `
<h1>Maxfiylik siyosati</h1>
<p class="small">DS Delivery (Android ilovasi va Telegram Mini App). Mas’ul tomon: ${op}. Aloqa: ${contact}.</p>
<h2>Qanday ma’lumotlar yig‘iladi</h2>
<ul>
<li>Telefon raqamingiz va yetkazish manzili — buyurtmani bajarish uchun.</li>
<li>Joylashuv (aniq yoki taxminiy): <b>faqat</b> buyurtma paytida “mening joylashuvim” tugmasini bossangiz so‘raladi va ruxsat bergan bo‘lsangiz olinadi. Ilova fonda joylashuvni kuzatmaydi. Ruxsat bermasangiz, manzilni yozib kiritasiz.</li>
<li>Ismingiz va Telegram identifikatoringiz — faqat Telegram orqali kirsangiz yoki ilovani Telegramga bog‘lasangiz.</li>
<li>Ilova o‘rnatilganda yaratiladigan tasodifiy qurilma/seans identifikatori (reklama identifikatori emas) — Telegramsiz buyurtma berish va firibgarlikdan himoya qilish uchun.</li>
<li>Buyurtma tarixi: mahsulotlar, summa, holatlar, vaqtlar; to‘lov va qaytarish yozuvlari (summa, vaqt, restoran kartasining oxirgi 4 raqami). Sizning karta ma’lumotlaringiz saqlanmaydi.</li>
<li>Yordam so‘rovlaringiz va yozishmalar.</li>
<li>Texnik jurnallar (IP manzil, so‘rov vaqti) — xavfsizlik va xatolarni topish uchun.</li>
</ul>
<h2>Nima uchun ishlatiladi</h2>
<p>Buyurtmani qabul qilish, to‘lovni tekshirish, taom tayyorlash, taksi orqali yetkazish, pulni qaytarish va yordam ko‘rsatish hamda firibgarlikdan himoya qilish uchun. Ma’lumotlar sotilmaydi, reklama yoki kuzatuv (analitika) uchun ishlatilmaydi va reklama tarmoqlariga berilmaydi. Ma’lumotlar internet orqali faqat shifrlangan (HTTPS) ulanishda uzatiladi.</p>
<h2>Kimlarga beriladi</h2>
<ul>
<li>Buyurtma berilgan restoranga: buyurtma tarkibi, telefon raqami va manzil (restoran o‘zi yetkazadigan buyurtmada xarita nuqtasi ham).</li>
<li>Yetkazishni bajaruvchi taksi operatoriga: olib ketish va yetkazish manzili, telefon raqami (va xarita nuqtasi, agar ko‘rsatgan bo‘lsangiz).</li>
<li>Telegram: bildirishnomalar yuborilganda (agar Telegramdan foydalansangiz).</li>
</ul>
<p>Qonun talab qilgan hollar bundan mustasno.</p>
<h2>Qancha vaqt saqlanadi</h2>
<ul>
<li>Buyurtma va to‘lov yozuvlari hisob-kitob va nizolarni hal qilish uchun saqlanadi. Hisobingizni o‘chirsangiz, ular ismingiz, telefoningiz va manzilingizga bog‘lanmaydigan qilib saqlanadi.</li>
<li>Telefon, manzillar va qurilma identifikatori hisobingiz o‘chirilguncha saqlanadi.</li>
<li>Pulni qaytarish cheki rasmlari ${cfg.receiptDays} kundan keyin o‘chiriladi.</li>
</ul>
<h2>Huquqlaringiz va hisobni o‘chirish</h2>
<p>Ma’lumotlaringiz haqida so‘rash yoki tuzatishni talab qilish uchun ${contact} ga murojaat qiling.</p>
<p><b>Hisobni o‘chirish:</b> ilovada <b>Profil → Hisobni o‘chirish</b>. Ilovani o‘rnatmagan bo‘lsangiz ham o‘chirishni so‘rashingiz mumkin: <a href="/legal/delete-account">/legal/delete-account</a>. Nimalar o‘chirilishi va nimalar saqlanishi o‘sha sahifada yozilgan.</p>
<h2>Bolalar</h2>
<p>Ilova 18 yoshga to‘lmaganlar uchun mo‘ljallanmagan va ularning ma’lumotlarini ongli ravishda yig‘maydi.</p>
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
<p><b>Eshikkacha yetkazish kafolatlanmaydi.</b> Taksi haydovchisi buyurtmani manzilingizdagi bino kirish joyigacha olib keladi. Haydovchi yuqori qavatga (masalan, 5-qavatga) ko‘tarib chiqishga majbur emas; haydovchi kelganda pastga tushib olishingiz so‘raladi. Eshikkacha yetkazish xizmati keyinroq alohida qo‘shilishi va u uchun narx farq qilishi mumkin.
<h2>Siz nima uchun javobgarsiz</h2>
<p>To‘g‘ri telefon raqami va manzil kiriting, boshqa shaxsning nomidan soxta buyurtma bermang, to‘lov ma’lumotlarini o‘zgartirmang.</p>
<h2>O‘zgarishlar</h2>
<p>Sinov bosqichida shartlar o‘zgarishi mumkin; joriy variant shu sahifada turadi.</p>
${hours}`);
}
