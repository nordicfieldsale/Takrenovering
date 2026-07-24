# Publicera bokningssystemet

Fem steg. Ingen installation av Node, PostgreSQL eller npm-paket — allt ligger i paketet
och startas med ett kommando. Räkna med **20–30 minuter** första gången.

Du behöver: en domän, ett kreditkort till serverleverantören, och en terminal
(Terminal på Mac, PowerShell på Windows).

---

## Steg 1 — Skaffa en server

Beställ en server hos valfri leverantör. Rekommendation: **Hetzner CX22** (ca 4 €/mån)
eller **DigitalOcean Basic Droplet** (6 $/mån). Båda räcker gott och väl.

Vid beställning, välj:

| Inställning | Värde |
|---|---|
| Operativsystem | **Ubuntu 24.04** |
| Storlek | Minst 2 GB RAM |
| Region | Nürnberg, Helsingfors eller Frankfurt (nära Sverige) |
| SSH-nyckel | Lägg in din, eller använd lösenord som mejlas till dig |

Du får en **IP-adress**, till exempel `203.0.113.45`. Spara den.

---

## Steg 2 — Peka domänen mot servern

Logga in hos den som har din domän (Loopia, One.com, Namecheap …) och lägg till en
DNS-post:

| Typ | Namn | Värde |
|---|---|---|
| A | `bokning` | din serverns IP-adress |

Det ger adressen `bokning.dindoman.se`. Vill du använda domänen rakt av sätter du
namnet till `@` i stället.

> DNS tar 5–30 minuter att slå igenom. Gör steg 3 under tiden.

---

## Steg 3 — Logga in på servern och installera Docker

Anslut till servern:

```bash
ssh root@203.0.113.45
```

Klistra in hela blocket nedan. Det installerar Docker och ingenting annat:

```bash
curl -fsSL https://get.docker.com | sh
```

---

## Steg 4 — Lägg upp systemet och fyll i inställningar

Ladda upp projektmappen till servern. Enklaste sättet från din egen dator
(kör i ett **nytt** terminalfönster, inte i SSH-sessionen):

```bash
scp -r villa-booking root@203.0.113.45:/opt/
```

Gå sedan tillbaka till SSH-fönstret:

```bash
cd /opt/villa-booking
cp .env.example .env
```

Skapa lösenorden — kopiera raderna du får ut:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "DB_PASSWORD=$(openssl rand -hex 16)"
```

Öppna inställningsfilen:

```bash
nano .env
```

Fyll i **sex rader** och spara med `Ctrl+O`, `Enter`, `Ctrl+X`:

```
DOMAIN=bokning.dindoman.se
TLS_EMAIL=din@epost.se
JWT_SECRET=       ← klistra in värdet ovanifrån
DB_PASSWORD=      ← klistra in värdet ovanifrån
ADMIN_USERNAME=admin
ADMIN_PASSWORD=   ← hitta på ett långt lösenord, minst 10 tecken
```

---

## Steg 5 — Starta

```bash
docker compose up -d --build
```

Första bygget tar 2–4 minuter. Systemet gör resten automatiskt:

- databasen skapas och tabellerna läggs upp
- Karl och Daniel läggs in som personer att boka
- ditt administratörskonto skapas
- SSL-certifikat hämtas och sidan blir nåbar på **https://bokning.dindoman.se**

Kontrollera att allt lever:

```bash
docker compose ps
curl https://bokning.dindoman.se/api/health
```

Svaret ska vara `{"status":"ok", ...}`.

---

## Steg 6 — Verifiera (rekommenderas)

Kör en gång för att bevisa att allt fungerar innan säljarna släpps in:

```bash
./scripts/verifiera.sh
```

Skriptet testar det körande systemet: att passen är 90 minuter, att säljare ser
lediga tider, att helger och tider utanför öppettid avvisas, att tio samtidiga
bokningar av samma tid bara ger en bokning, att en avbokad tid blir ledig igen,
att säljare inte ser andras kunder och att appen går att installera i mobilen.
Testdata städas bort automatiskt.

Sista raden ska vara **"Systemet uppfyller samtliga krav."**

**Klart.** Öppna adressen i mobilen och logga in med ditt admin-konto.

---

## Efter lanseringen

### Byt ditt admin-lösenord
Tryck på ditt namn uppe till höger → **Byt lösenord**. Lösenordet i `.env` används
bara för att skapa kontot vid första starten.

### Lägg till fler administratörer
**Användare** → *Lägg till konto* → välj rollen **Administratör**. Kontot är aktivt
direkt och behöver inte godkännas. Ingen kan registrera sig själv som administratör —
självregistrering ger alltid rollen säljare.

### Lägg upp Karl och Daniel som användare
Logga in som admin → **Användare** → *Lägg till konto* → välj rollen **Tekniker**
och koppla till Karl respektive Daniel. Då ser de bara sitt eget schema.

### Säljarna
Låt dem gå till `https://bokning.dindoman.se`, trycka *Skapa konto* och fylla i sina
uppgifter. Du godkänner dem under **Användare**. Ingen kan logga in före godkännande.

### Installera som app i mobilen
- **iPhone:** öppna adressen i Safari → dela-knappen → *Lägg till på hemskärmen*
- **Android:** öppna i Chrome → menyn → *Installera app*

Appen får er logga som ikon och öppnas utan adressfält.

### Automatisk säkerhetskopiering
Kör en gång på servern:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/villa-booking && ./scripts/backup.sh") | crontab -
```

Databasen kopieras då varje natt till `/opt/villa-booking/backups` och 14 dagar sparas.

---

## Vanliga kommandon

| Vad | Kommando |
|---|---|
| Se loggar | `docker compose logs -f app` |
| Starta om | `docker compose restart` |
| Stoppa | `docker compose down` |
| Uppdatera efter kodändring | `./scripts/update.sh` |
| Säkerhetskopiera nu | `./scripts/backup.sh` |
| Verifiera systemet | `./scripts/verifiera.sh` |
| Återställ kopia | `gunzip -c backups/villa-2026-07-23.sql.gz \| docker compose exec -T db psql -U villa villa_booking` |

---

## Om något inte fungerar

**Sidan laddar inte / certifikatfel**
DNS har inte hunnit slå igenom. Kontrollera med `dig +short bokning.dindoman.se` —
svaret ska vara din serverns IP. Vänta annars 15 minuter och kör `docker compose restart caddy`.

**"DB_PASSWORD saknas i .env"**
Filen heter `.env.example` i stället för `.env`, eller så saknas ett värde.
Kör `cat .env` och kontrollera att alla sex rader har värden efter likhetstecknet.

**Jag kommer inte in som admin**
Kontot skapas bara vid *första* starten. Skapa ett nytt:

```bash
docker compose exec db psql -U villa villa_booking -c "DELETE FROM users WHERE role='admin';"
docker compose restart app
```

Kontot återskapas då från `ADMIN_PASSWORD` i `.env`.

**Portarna 80/443 är upptagna**
En annan webbserver körs redan. Stäng av den: `systemctl stop apache2 nginx`.

---

## Kostnad

| Post | Ca kostnad |
|---|---|
| Server | 40–70 kr/mån |
| Domän | 100–150 kr/år |
| SSL-certifikat | 0 kr (automatiskt) |
