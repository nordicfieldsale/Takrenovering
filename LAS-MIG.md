# Villa Takrenovering – bokningssystem

## Testa lokalt

```bash
docker compose up
```

Öppna sedan **http://localhost:5000**
Logga in med `admin` / `testpass123`

Stoppa med `Ctrl+C`.

## Lägga upp på GitHub

Ladda upp **innehållet i den här mappen** (inte mappen själv).
Kontrollera efteråt att `web` och `server` syns som **mappar** i repot.

## Render

Skapa en Web Service från repot. Under **Environment** ska följande finnas:

| Nyckel | Värde |
|---|---|
| `DATABASE_URL` | Internal Database URL från din Postgres på Render |
| `JWT_SECRET` | minst 32 tecken |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | ditt lösenord, minst 10 tecken |
| `PGSSL` | `require` |

## Om sidan är vit efter uppdateringen

En tidigare version installerade en service worker i webbläsaren som ligger
kvar och visar den gamla sidan. Den nya versionen tar bort sig själv, men du
behöver ladda om sidan två gånger med några sekunders mellanrum.

Går det ändå inte i Safari:
**Inställningar → Integritetsskydd → Hantera webbplatsdata** → sök på adressen
→ **Ta bort**.
