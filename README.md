# Villa Takrenovering — bokningssystem

Internt bokningssystem för kostnadsfria takbesök. Säljare bokar ute i fält från
mobilen, administratören följer upp, Karl och Daniel ser sina scheman.

**➜ [PUBLICERA.md](PUBLICERA.md) — så får du sidan live.**
**➜ [GENOMGANG.md](GENOMGANG.md) — vad som ändrats sedan första versionen.**

---

## Vad systemet gör

**Säljare** fyller i kundens namn, adress och telefon, väljer Karl eller Daniel och
plockar en ledig tid. Upptagna tider är gråa och går inte att välja. Säljaren ser sina
egna bokningar och sin statistik — aldrig andras kunder.

**Administratör** ser alla bokningar med filter på datum, säljare, person och status,
sätter status (ny, bekräftad, genomförd, såld, avbokad, ej hemma), skriver interna
anteckningar, godkänner nya säljare, spärrar tider och exporterar till Excel.

**Karl och Daniel** loggar in och ser bara sina egna inbokade besök, med klickbara
telefonnummer.

## Bokningsregler

| | |
|---|---|
| Dagar | Måndag–fredag |
| Tider | 10:00, 11:30, 13:00, 14:30, 16:00, 17:30 |
| Längd | 1 timme 30 minuter |
| Framförhållning | 14 dagar |
| Dubbelbokning | Omöjlig — spärras i databasen |

Reglerna ändras i `.env`, inte i koden.

## Teknik

En container med API och webbapp, en med PostgreSQL, en med automatisk HTTPS.
Node.js 20, Express, React, PostgreSQL 16, Caddy. Startas med `docker compose up -d`.

```
villa-booking/
├── PUBLICERA.md          Publiceringsguide
├── GENOMGANG.md          Kodgenomgång
├── docker-compose.yml    Startar allt
├── Dockerfile            Bygger appen
├── Caddyfile             HTTPS
├── .env.example          Inställningar att fylla i
├── scripts/              Säkerhetskopiering och uppdatering
├── server/               API, databasschema, bokningsregler
└── web/                  Webbappen (PWA)
```

## Utveckling lokalt

Behövs bara om koden ska ändras.

```bash
docker compose up -d db          # databasen
cd server && npm install && npm run dev
cd web    && npm install && npm run dev   # öppnas på http://localhost:5173
```

Sätt `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME` och `ADMIN_PASSWORD` i
`server/.env` först.
