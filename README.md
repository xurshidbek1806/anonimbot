# Telegram xabar bot

Node.js 24+ bot. Lokal testlarda SQLite, VPSdagi Docker deployda PostgreSQL ishlatiladi. Hamma foydalanuvchi imkoniyatlari bepul; obuna va to‘lov yo‘q.

## Xabar almashish

Har odamga **bitta shaxsiy havola** beriladi. `/start` avval havolani `Ulashish` tugmasi bilan ko‘rsatadi, so‘ng yozish maydoni ostida doim turadigan menyuni ochadi: `Mening havolalarim`, `Profil`, `Yordam`. Rejim tanlash yo‘q. Ilgari yaratilgan har ikkala turdagi havolalar ham ishlashda davom etadi va endi bir xil tartibda xabar yetkazadi.

Boshqa odam havolani ochsa, **“Murojaatingizni shuyerga yozing!”** matni va `Bekor qilish` tugmasi chiqadi. Xabar yuborilgach **“Xabaringiz yuborildi!”**, `Yana xabar yuborish` tugmasi va yozuvchining o‘z shaxsiy havolasi ko‘rsatiladi. Yozuvchi tugmani bosmasdan ham keyingi xabarni yuborishi mumkin; egadan kelgan javob ostida ham `Javob berish` tugmasi chiqadi.

Har bir kelgan xabar ostida `Yuboruvchini ko‘rish` va `Javob berish` tugmalari bor. Birinchisi havola egasiga yozuvchining ismi, username'i (bo‘lsa), Telegram ID si va username mavjud bo‘lsa profil havolasini ko‘rsatadi; ikkinchisi bot orqali javob yuboradi. `Javobingiz yuborildi!` xabari ostidagi `Yana xabar yuborish` tugmasi o‘sha suhbatga yana javob yozish imkonini beradi. Xabar kelishi bilan shaxsiy ma’lumot avtomatik ko‘rsatilmaydi, ammo bu bot to‘liq anonim emas. Username bo‘lmasa, Telegram maxfiyligi sababli profilga o‘tish tugmasi ko‘rsatilmaydi.

## Bepul imkoniyatlar

- `/login` — shaxsiy havolaga 1–32 ta lotin harfidan iborat maxsus login o‘rnatish. Masalan, `?start=Xurshidbek`. Login o‘zgarsa eski maxsus login ishlamaydi; tasodifiy tokenli havola ishlashda davom etadi.
- `/autoreply` — havolani ochgan odamga avtomatik ko‘rsatiladigan matnni o‘rnatish yoki o‘chirish.
- `/profile` — so‘nggi 24 soat, 7 kun va 30 kun ichida kirgan noyob yozuvchilar va kelgan xabarlar soni.
- `/unban` — blokdan chiqarish ko‘rsatmasi; `/unban ID` bitta ichki suhbat ID sini, `/unban all` hammasini ochadi. Bu ID Telegram foydalanuvchi ID si emas.
- `/premium` — barcha mavjud imkoniyatlar bepul ekanini ko‘rsatadi; xarid tugmasi yo‘q.
- `/help` — qisqa yordam; `/id` — o‘z Telegram ID raqamini ko‘rish.

Javob yozish oynasida `Bloklash` ham mavjud. Yuboruvchini ko‘rish va javob berish har bir havolada bepul ishlaydi.

Bot `copyMessage` yoki oddiy `sendMessage` ishlatadi. Forward manbasi qo‘shilmaydi. Matn va media captionidagi maxsus Telegram mention formatlari olib tashlanadi. Foydalanuvchi matnida, fayl nomida yoki media ichida o‘zini tanituvchi ma’lumot bo‘lsa, bot uni avtomatik yashira olmaydi. Bot ishlashi uchun ID bog‘lanishlari bazada saqlanadi; havola egasi yuboruvchini ko‘rish tugmasi orqali bilishi mumkin.

## Ishga tushirish

1. [@BotFather](https://t.me/BotFather) orqali bot oching va token oling.
2. `.env.example` nusxasini `.env` nomi bilan saqlang. `BOT_TOKEN` ni to‘ldiring. Admin ID ni bilish uchun botga `/id` yuboring, so‘ng `ADMIN_IDS` ga yozing (bir nechta ID vergul bilan). Lokal SQLite uchun `DATABASE_URL` qatorini olib tashlang; `DATABASE_PATH=./data/bot.sqlite` ixtiyoriy.
3. `npm start` ishga tushiring. Bot avval webhook o‘rnatilgan bo‘lsa, uni o‘zingiz o‘chirishingiz kerak; bot avtomatik o‘chirmaydi.

Ma’lumotlar odatda `data/bot.sqlite` da saqlanadi. Doimiy serverda shu faylni backup qiling va botning bitta nusxasini ishga tushiring.

## VPS deploy (infra PostgreSQL)

`compose.yml` VPSdagi mavjud `xurshid` Docker tarmog‘i va `infra_pgsql` konteyneridan foydalanadi. `scripts/provision-db.sh` alohida `anonimbot` bazasi va rolini yaratadi; parol faqat serverdagi `.env` faylida saqlanadi. `.env` va `data/` Git yoki Docker image ichiga kirmaydi.

1. Repodan `git clone` qiling. Serverga `BOT_TOKEN` va `ADMIN_IDS` li `.env` faylini xavfsiz ko‘chiring, `chmod 600 .env` qiling.
2. `bash scripts/provision-db.sh` bilan yangi bazani yarating.
3. Eski SQLite ma’lumotlarini saqlash kerak bo‘lsa, botni to‘xtatgandan keyin `sqlite3 data/bot.sqlite ".backup '/tmp/bot.sqlite'"` orqali izchil nusxa oling, serverga ko‘chiring va `docker compose run --rm --user "$(id -u):$(id -g)" -e SQLITE_SOURCE=/tmp/source.sqlite -v /server/path/bot.sqlite:/tmp/source.sqlite:ro bot node scripts/migrate-sqlite.js` ni ishga tushiring. Migratsiya maqsad bazasi bo‘sh bo‘lmasa to‘xtaydi.
4. `docker compose up -d --build` bilan ishga tushiring; `docker compose logs --tail=100 bot` va `docker compose ps` bilan tekshiring.

Bir Telegram bot tokeni uchun faqat bitta polling jarayoni ishlasin. Serverga ko‘chirishda lokal jarayonni to‘xtating. PostgreSQL zaxiralash va yangilanishlar VPS infra siyosatiga mos tashkil qilinishi kerak.

## Admin panel

`/admin` faqat `ADMIN_IDS` dagi akkauntlarda ishlaydi. Panelda foydalanuvchilar, faol linklar va suhbatlar soni ko‘rinadi. Admin ikki turdagi xabar yaratadi:

- **Barchaga e’lon:** xizmat yoki bot haqidagi umumiy xabar barcha foydalanuvchilarga yuboriladi.
- **Homiy xabari:** faqat `/offers` orqali ixtiyoriy rozilik berganlarga yuboriladi. Boshqalarda reklama o‘chiq turadi.

Matn yoki media yuboriladi, kerak bo‘lsa HTTPS tugma qo‘shiladi, keyin ko‘rinishi tasdiqlanadi. Bot xabarni navbat bilan yuboradi va yakuniy natijani adminga bildiradi. To‘lov yoki avtomatik reklama savdosi yo‘q.

## Tekshirish

`npm test`
# anonimbot
