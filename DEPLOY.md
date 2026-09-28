# Серверга ўрнатиш (45.153.184.50)

Платформа битта `index.html` файли ва кичик `server.js` сервердан иборат. Серверга Node.js 18 ёки янгироқ версия керак, бошқа кутубхона талаб қилинмайди.

`server.js` учта иш қилади:
- платформани очиб беради;
- об-ҳаво ва ҳаво сифати (PM2.5, PM10, чанг) маълумотини Open-Meteo'дан олиб, 10 дақиқа кешлайди. Бир вақтда кўп одам кирса ҳам Open-Meteo'га бир марта мурожаат қилинади;
- Open-Meteo вақтинча жавоб бермаса, охирги олинган маълумотни беради.

## 1. Серверга кириш

Компьютерингиздан (Windows'да PowerShell, телефонда Termux ёки JuiceSSH):

```bash
ssh root@45.153.184.50
```

## 2. Node.js ўрнатиш (Ubuntu/Debian)

```bash
node -v   # v18 ёки ундан юқори бўлса, бу қадамни ўтказиб юборинг
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
```

## 3. Файлларни серверга қўйиш

**GitHub орқали:**
```bash
git clone https://github.com/egamberdiyevshukurjon9-dotcom/- /opt/yashil-belbog
```

**Ёки компьютердан нусхалаб** (`index.html`, `server.js`, `package.json` ва `deploy/` папкаси турган жойда):
```bash
scp -r index.html server.js package.json deploy root@45.153.184.50:/opt/yashil-belbog/
```

## 4. Синаб кўриш

```bash
cd /opt/yashil-belbog
PORT=5174 node server.js
```

Браузерда http://45.153.184.50:5174 манзилини очинг. Юқори чапда **«ЖОНЛИ · соат»** ёзуви чиқса, маълумот интернетдан келаяпти. Текшириб бўлгач, `Ctrl+C` билан тўхтатинг.

> Агар 5174 портда эски Vite (`npm run dev`) сервери ишлаётган бўлса, аввал уни тўхтатинг:
> `fuser -k 5174/tcp`

## 5. Доимий ишлатиш (systemd)

```bash
useradd --system --no-create-home yashil 2>/dev/null || true
chown -R yashil:yashil /opt/yashil-belbog
cp /opt/yashil-belbog/deploy/yashil-belbog.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yashil-belbog
systemctl status yashil-belbog      # «active (running)» бўлиши керак
curl http://127.0.0.1:5174/healthz  # {"ok":true,...}
```

Шундан кейин сервер қайта юкланса ҳам платформа ўзи ишга тушади.
- Журнални кўриш: `journalctl -u yashil-belbog -f`
- Файлларни янгилагандан кейин қайта ишга тушириш: `systemctl restart yashil-belbog`

## 6. Портни очиш (firewall)

```bash
ufw allow 5174/tcp
```

Бундан ташқари, хостинг панелингизда (провайдер firewall'ида) ҳам 5174 порт очиқ бўлиши керак.

## 7. (Ихтиёрий) Домен ва HTTPS

Домен бўлса, nginx'ни прокси қилиб қўйиш ва бепул сертификат олиш мумкин:

```nginx
server {
    server_name yashilbelbog.uz;
    location / { proxy_pass http://127.0.0.1:5174; proxy_set_header Host $host; }
}
```
```bash
apt-get install -y nginx certbot python3-certbot-nginx
certbot --nginx -d yashilbelbog.uz
```

## Маълумот манбалари ва аниқлик

| Кўрсаткич | Манба | Изоҳ |
|---|---|---|
| Ҳарорат, намлик, шамол, босим, UV, кўриниш | Open-Meteo Forecast API | Миллий метеохизматлар моделлари, ҳар 15 дақиқада |
| PM2.5, PM10, минерал чанг | Open-Meteo Air Quality API (Copernicus CAMS) | **Модел баҳоси** (~11–40 км тўр), станция ўлчови эмас |
| Дарахтлар, лойиҳалар, тупроқ, дронлар | — | Ҳозирча **демо**. Ўз API'нгиз бўлса, Админ → «Маълумот манбаи» орқали уланади |

Ҳар бир ҳудуд учун маълумот олинадиган нуқталар: Нукус, Тошкент, Навоий, Бухоро, Самарқанд, Фарғона. Уларни `index.html` ичидаги `LIVE_PTS` ўзгарувчисида алмаштириш мумкин.

Чанг бўйича станция даражасидаги аниқроқ маълумот керак бўлса, ҳудудга PM-сенсорлар (масалан, PurpleAir, Sensor.Community) ўрнатиб, уларни «Маълумот манбаи (API)» орқали улаш мумкин.

Созламалар (⚙) → «Об-ҳаво, PM2.5, PM10 ва чангни интернетдан олиш» — бу ерда жонли режимни ёқиш ёки ўчириш мумкин.
