# Så här lägger du upp den här mappen

## 1. GitHub
Ladda upp **allt innehåll i den här mappen** (inte mappen själv) till repot.
Kontrollera efteråt att `web` och `server` syns som **mappar** i GitHub.

## 2. Render – miljövariabler
Under **Environment** ska dessa finnas:

| Nyckel | Värde |
|---|---|
| `DATABASE_URL` | Internal Database URL från din Postgres på Render |
| `JWT_SECRET` | minst 32 tecken, t.ex. `myverylongsecretkeyforjwt12345678` |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | ditt lösenord, minst 10 tecken |
| `PGSSL` | `require` |

## 3. Första besöket efter uppdateringen
Den gamla versionen installerade en service worker i webbläsaren. Den ligger
kvar och visar en tom sida även efter att servern uppdaterats. Den nya
versionen städar bort sig själv automatiskt, men du behöver besöka sidan
**två gånger**: ladda om en gång, vänta några sekunder, ladda om igen.

Går det ändå inte i Safari: **Safari → Inställningar → Integritetsskydd →
Hantera webbplatsdata** → sök `onrender` → **Ta bort**.
