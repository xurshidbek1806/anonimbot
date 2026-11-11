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

## Tez deploy (0 dan, toza serverda)

Kerakli narsa: **bot tokeni** va (ixtiyoriy) o‘z **Telegram ID** ingiz.

1. [@BotFather](https://t.me/BotFather) → `/newbot` → token oling (`123456:ABC...` ko‘rinishida).
2. Botga `/id` yuborib, o‘z Telegram ID ingizni bilib oling (admin bo‘lish uchun; bot ishga tushgandan keyin ham qilsa bo‘ladi).
3. Quyidagi ikki usuldan birini tanlang. Ikkalasi ham bitta serverda, bitta bot uchun.

> Bir bot tokeni uchun **faqat bitta** jarayon ishlasin (long polling). Boshqa joyda (lokal kompyuter, eski server) ishlayotgan nusxani avval to‘xtating. Botda webhook o‘rnatilgan bo‘lsa, bot ishga tushmaydi va xato beradi; uni o‘chirish uchun brauzerda `https://api.telegram.org/bot<TOKEN>/deleteWebhook` ni oching.

### A) Docker bilan (tavsiya etiladi)

Docker va Docker Compose v2 kerak. Docker bo‘lmasa, `curl -fsSL https://get.docker.com | sh` bilan o‘rnatish mumkin (yoki quyidagi **B** usulga o‘ting). PostgreSQL alohida o‘rnatilmaydi, u bot bilan birga konteynerda ko‘tariladi.

```bash
git clone https://github.com/xurshidbek1806/anonimbot.git
cd anonimbot
cp .env.example .env
```

`.env` ni oching (`nano .env`): `BOT_TOKEN` va `ADMIN_IDS` ni to‘ldiring, so‘ng baza parolini yarating:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
chmod 600 .env
```

Ishga tushiring:

```bash
docker compose -f compose.standalone.yml up -d --build
```

Tekshirish: `docker compose -f compose.standalone.yml logs --tail=50 bot` oxirida `@botnomi ishga tushdi` chiqishi kerak. Server qayta yoqilganda ham bot o‘zi ko‘tariladi (`restart: unless-stopped`).

Yangilash:

```bash
git pull
docker compose -f compose.standalone.yml up -d --build
```

Zaxira nusxa (baza `pgdata` volume’ida saqlanadi, `docker compose down` uni o‘chirmaydi; `down -v` o‘chiradi):

```bash
docker compose -f compose.standalone.yml exec -T db pg_dump -U anonimbot anonimbot > backup.sql
```

### B) Docker’siz (faqat Node.js)

Docker kerak emas. Bot ichki **SQLite** ishlatadi, alohida baza serveri o‘rnatish shart emas. Node.js **24 yoki yangi** kerak (`node:sqlite` Node 24 da bor).

**1. Node.js 24 va git o‘rnatish** (Ubuntu/Debian):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v24 yoki yuqori bo‘lishi kerak
```

(macOS: `brew install node`. Windows: [nodejs.org](https://nodejs.org) dan o‘rnating. Boshqa Linuxlarda [nvm](https://github.com/nvm-sh/nvm): `nvm install 24`.)

**2. Loyihani olish va sozlash:**

```bash
git clone https://github.com/xurshidbek1806/anonimbot.git
cd anonimbot
npm ci --omit=dev
cp .env.example .env
nano .env    # BOT_TOKEN va ADMIN_IDS ni to‘ldiring; boshqa qatorlarga tegmang
```

**3. Sinab ko‘rish:**

```bash
npm start
```

`@botnomi ishga tushdi` chiqsa, botga Telegram’da `/start` yuboring. To‘xtatish: `Ctrl+C`.

**4. Doimiy ishlatish** (terminal yopilganda ham ishlashi va server qayta yoqilganda o‘zi ko‘tarilishi uchun). Linux’da `systemd`:

```bash
sudo tee /etc/systemd/system/anonimbot.service >/dev/null <<EOF
[Unit]
Description=Anonimbot Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$PWD
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now anonimbot
```

Loglar: `journalctl -u anonimbot -f`. Holat: `systemctl status anonimbot`.

Systemd o‘rniga `pm2` ham bo‘ladi: `sudo npm i -g pm2 && pm2 start src/index.js --name anonimbot && pm2 save && pm2 startup`.

Yangilash:

```bash
git pull
npm ci --omit=dev
sudo systemctl restart anonimbot
```

Ma’lumotlar `data/bot.sqlite` faylida. Zaxira uchun botni to‘xtatib, `data/` papkasini nusxalang (yoki `sqlite3 data/bot.sqlite ".backup 'backup.sqlite'"`).

Tashqi PostgreSQL ishlatmoqchi bo‘lsangiz, `.env` ga `DATABASE_URL=postgresql://user:parol@host:5432/baza` qo‘shing; jadvallar o‘zi yaratiladi. `DATABASE_URL` bo‘lmasa SQLite ishlatiladi.

### Sozlamalar (`.env`)

| O‘zgaruvchi | Majburiy | Izoh |
|---|---|---|
| `BOT_TOKEN` | ha | BotFather tokeni |
| `ADMIN_IDS` | yo‘q | Admin Telegram ID lari, vergul bilan |
| `POSTGRES_PASSWORD` | faqat Docker (A) | `compose.standalone.yml` ichidagi baza paroli |
| `DATABASE_URL` | yo‘q | Berilsa PostgreSQL, bo‘lmasa SQLite |
| `DATABASE_PATH` | yo‘q | SQLite fayli, standart `./data/bot.sqlite` |

`.env` va `data/` Git’ga va Docker image’ga kirmaydi.

### Muammolar

- `getMe: Unauthorized` (kod 401): `BOT_TOKEN` noto‘g‘ri yoki BotFather’da bekor qilingan. Tokenni qayta tekshiring.
- `Bu botda webhook faol`: yuqoridagi `deleteWebhook` havolasini oching.
- Bot javob bermayapti, loglarda xato yo‘q: shu token bilan boshqa joyda ham bot ishlayotgan bo‘lishi mumkin; ikkinchisini to‘xtating.
- Docker’da `POSTGRES_PASSWORD ... kerak`: `.env` faylida shu qator yo‘q (yuqoridagi `echo ... >> .env` buyrug‘ini bajaring).

## VPS deploy (mavjud infra PostgreSQL bilan)

Bu bo‘lim faqat `xurshid` Docker tarmog‘i va `infra_pgsql` konteyneri bor serverga tegishli. Oddiy serverda yuqoridagi **Tez deploy** bo‘limidan foydalaning.

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
