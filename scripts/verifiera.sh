#!/bin/sh
# =====================================================================
#  Verifiering av bokningssystemet
#
#  Körs EN gång efter lansering och bevisar att kraven faktiskt håller
#  i det körande systemet — inte bara i koden.
#
#      ./scripts/verifiera.sh
#
#  Skriptet skapar ett tillfälligt testkonto och en testbokning, och
#  städar bort allt efteråt. Inga riktiga bokningar påverkas.
# =====================================================================

set -e
cd "$(dirname "$0")/.."

BASE="${BASE_URL:-http://127.0.0.1:5000}"
PASS=0
FAIL=0

green() { printf '\033[32m  OK  \033[0m %s\n' "$1"; PASS=$((PASS+1)); }
red()   { printf '\033[31m FEL  \033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
head()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Anropar API:t via app-containern, så testet fungerar även innan DNS är klart.
call() {
  method="$1"; path="$2"; token="$3"; body="$4"
  if [ -n "$body" ]; then
    docker compose exec -T app node -e "
      fetch('$BASE$path', {
        method: '$method',
        headers: { 'Content-Type': 'application/json'${token:+, Authorization: 'Bearer $token'} },
        body: JSON.stringify($body),
      }).then(async r => { console.log(r.status + '|' + await r.text()); })
        .catch(e => { console.log('0|' + e.message); });
    "
  else
    docker compose exec -T app node -e "
      fetch('$BASE$path', {
        headers: { ${token:+Authorization: 'Bearer $token'} },
      }).then(async r => { console.log(r.status + '|' + await r.text()); })
        .catch(e => { console.log('0|' + e.message); });
    "
  fi
}

status() { echo "$1" | cut -d'|' -f1; }
payload() { echo "$1" | cut -d'|' -f2-; }

sql() { docker compose exec -T db psql -U villa -d villa_booking -tAc "$1"; }

# ---------------------------------------------------------------------
head "0. Systemet svarar"
# ---------------------------------------------------------------------
R=$(call GET /api/health)
[ "$(status "$R")" = "200" ] && green "API:t är uppe" || { red "API:t svarar inte — kör 'docker compose logs app'"; exit 1; }

# ---------------------------------------------------------------------
head "1. 90-minuterspass med rätt tider"
# ---------------------------------------------------------------------
R=$(call GET /api/config)
CONF=$(payload "$R")
echo "$CONF" | grep -q '"durationMinutes":90' \
  && green "Varje besök är 90 minuter" || red "Fel besökslängd: $CONF"
echo "$CONF" | grep -q '"start":"10:00"' \
  && green "Första tiden är 10:00" || red "Fel starttid"
echo "$CONF" | grep -q '"start":"17:30","end":"19:00"' \
  && green "Sista tiden är 17:30–19:00 (sex pass per dag)" || red "Fel sluttid"

# ---------------------------------------------------------------------
head "2. Testkonton"
# ---------------------------------------------------------------------
TS=$(date +%s)
SELLER="testsaljare$TS"

sql "INSERT INTO users (username, password_hash, full_name, role, is_approved, is_active)
     VALUES ('$SELLER', '\$2a\$12\$K7L1OJ0/9brXkVYJmYJZ4uJ8hHXvXWxWDNkFVCkGvXQZ9pQXvXvXe',
             'Testsäljare $TS', 'seller', TRUE, TRUE);" >/dev/null

# Sätt ett känt lösenord via appens egen hashning.
docker compose exec -T app node -e "
  const bcrypt = require('bcryptjs');
  const { Pool } = require('pg');
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  bcrypt.hash('Testlosen123', 12).then(h =>
    p.query('UPDATE users SET password_hash = \$1 WHERE username = \$2', [h, '$SELLER'])
  ).then(() => p.end());
" >/dev/null

R=$(call POST /api/auth/login "" "{username:'$SELLER',password:'Testlosen123'}")
TOKEN=$(payload "$R" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && green "Säljare kan logga in" || { red "Inloggning misslyckades: $(payload "$R")"; }

# ---------------------------------------------------------------------
head "3. Säljare ser lediga tider (kalenderbehörigheten)"
# ---------------------------------------------------------------------
TECH_ID=$(sql "SELECT id FROM technicians WHERE name = 'Karl';" | tr -d ' ')
R=$(call GET "/api/availability?technicianId=$TECH_ID" "$TOKEN")
if [ "$(status "$R")" = "200" ]; then
  green "Säljare får svar från kalendern (tidigare 403)"
  echo "$(payload "$R")" | grep -q '"status":"free"' \
    && green "Lediga tider syns" || red "Inga lediga tider i svaret"
  echo "$(payload "$R")" | grep -q 'first_name\|"phone"' \
    && red "VARNING: kunddata läcker via kalendern" \
    || green "Ingen kunddata läcker via kalendern"
else
  red "Kalendern nekar säljaren: $(payload "$R")"
fi

DATE=$(echo "$(payload "$R")" | sed -n 's/.*"days":\[{"date":"\([^"]*\)".*/\1/p')

# ---------------------------------------------------------------------
head "4. Bokningsregler kontrolleras av servern"
# ---------------------------------------------------------------------
BODY="{firstName:'Test',lastName:'Testsson',address:'Testgatan 1',phone:'0701234567',technicianId:$TECH_ID"

R=$(call POST /api/bookings "$TOKEN" "$BODY,date:'2030-01-05',startTime:'10:00'}")
[ "$(status "$R")" = "400" ] && green "Helg avvisas" || red "Helg accepterades"

R=$(call POST /api/bookings "$TOKEN" "$BODY,date:'$DATE',startTime:'10:30'}")
[ "$(status "$R")" = "400" ] && green "Tid utanför 90-minutersrutnätet avvisas" || red "Fel tid accepterades"

R=$(call POST /api/bookings "$TOKEN" "$BODY,date:'$DATE',startTime:'21:00'}")
[ "$(status "$R")" = "400" ] && green "Tid efter stängning avvisas" || red "Sen tid accepterades"

FAR=$(date -d '+40 days' +%Y-%m-%d 2>/dev/null || date -v+40d +%Y-%m-%d)
R=$(call POST /api/bookings "$TOKEN" "$BODY,date:'$FAR',startTime:'10:00'}")
[ "$(status "$R")" = "400" ] && green "Bokning bortom två veckor avvisas" || red "För sen bokning accepterades"

R=$(call POST /api/bookings "$TOKEN" "$BODY,date:'2020-06-01',startTime:'10:00'}")
[ "$(status "$R")" = "400" ] && green "Datum som passerat avvisas" || red "Gammalt datum accepterades"

# ---------------------------------------------------------------------
head "5. Dubbelbokning är omöjlig"
# ---------------------------------------------------------------------
SLOT=$(sql "SELECT s.t FROM (VALUES ('10:00'),('11:30'),('13:00'),('14:30'),('16:00'),('17:30')) AS s(t)
            WHERE NOT EXISTS (
              SELECT 1 FROM bookings b WHERE b.technician_id = $TECH_ID
                AND b.booking_date = '$DATE' AND b.start_time = s.t::time AND b.status <> 'cancelled')
            LIMIT 1;" | tr -d ' ')

if [ -z "$SLOT" ]; then
  red "Ingen ledig tid att testa med — hoppar över"
else
  # Tio samtidiga försök på exakt samma tid.
  RESULT=$(docker compose exec -T app node -e "
    const body = JSON.stringify({
      firstName:'Samtidig', lastName:'Test', address:'Testgatan 1', phone:'0701234567',
      technicianId:$TECH_ID, date:'$DATE', startTime:'$SLOT'
    });
    const one = () => fetch('$BASE/api/bookings', {
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer $TOKEN'},
      body
    }).then(r => r.status);
    Promise.all(Array.from({length:10}, one)).then(codes => {
      const ok = codes.filter(c => c === 201).length;
      const conflict = codes.filter(c => c === 409).length;
      console.log(ok + ' ' + conflict);
    });
  ")
  OK=$(echo "$RESULT" | awk '{print $1}')
  CONFLICT=$(echo "$RESULT" | awk '{print $2}')
  [ "$OK" = "1" ] && green "10 samtidiga försök → exakt 1 bokning skapades" \
                  || red "10 samtidiga försök → $OK bokningar skapades (ska vara 1)"
  [ "$CONFLICT" = "9" ] && green "Övriga 9 fick tydligt felmeddelande" \
                        || red "Fel antal avvisade: $CONFLICT"

  ROWS=$(sql "SELECT COUNT(*) FROM bookings WHERE technician_id = $TECH_ID
              AND booking_date = '$DATE' AND start_time = '$SLOT'::time AND status <> 'cancelled';" | tr -d ' ')
  [ "$ROWS" = "1" ] && green "Databasen innehåller exakt en aktiv bokning på tiden" \
                    || red "Databasen innehåller $ROWS aktiva bokningar"

  # -------------------------------------------------------------------
  head "6. Tiden blir ledig igen efter avbokning"
  # -------------------------------------------------------------------
  BID=$(sql "SELECT id FROM bookings WHERE technician_id = $TECH_ID
             AND booking_date = '$DATE' AND start_time = '$SLOT'::time AND status <> 'cancelled' LIMIT 1;" | tr -d ' ')
  sql "UPDATE bookings SET status = 'cancelled' WHERE id = $BID;" >/dev/null

  R=$(call GET "/api/availability?technicianId=$TECH_ID" "$TOKEN")
  echo "$(payload "$R")" | tr ',' '\n' | grep -A1 "\"$SLOT\"" | grep -q 'free' \
    && green "Avbokad tid är ledig igen" || red "Avbokad tid är fortfarande spärrad"

  R=$(call POST /api/bookings "$TOKEN" "$BODY,date:'$DATE',startTime:'$SLOT'}")
  [ "$(status "$R")" = "201" ] && green "Tiden går att boka på nytt" || red "Går inte att omboka: $(payload "$R")"
  sql "DELETE FROM bookings WHERE first_name IN ('Samtidig','Test') AND booking_date = '$DATE';" >/dev/null
fi

# ---------------------------------------------------------------------
head "7. Säljare ser inte andras kunder"
# ---------------------------------------------------------------------
R=$(call GET /api/bookings "$TOKEN")
COUNT=$(echo "$(payload "$R")" | grep -o '"id":' | wc -l | tr -d ' ')
[ "$COUNT" = "0" ] && green "Ny säljare ser noll bokningar (endast sina egna)" \
                   || red "Säljaren ser $COUNT bokningar som inte är dennes"

R=$(call GET /api/admin/stats "$TOKEN")
[ "$(status "$R")" = "403" ] && green "Säljare nekas adminpanelen" || red "Säljare kom åt adminpanelen"

# ---------------------------------------------------------------------
head "8. Karl och Daniel"
# ---------------------------------------------------------------------
sql "SELECT name FROM technicians ORDER BY sort_order;" | grep -q Karl \
  && green "Karl finns upplagd" || red "Karl saknas"
sql "SELECT name FROM technicians ORDER BY sort_order;" | grep -q Daniel \
  && green "Daniel finns upplagd" || red "Daniel saknas"
sql "SELECT 1 FROM information_schema.columns
     WHERE table_name='technicians' AND column_name='user_id';" | grep -q 1 \
  && green "Teknikerkonton kan kopplas till inloggning" || red "Koppling till inloggning saknas"

# ---------------------------------------------------------------------
head "9. Spärrade tider"
# ---------------------------------------------------------------------
sql "SELECT 1 FROM information_schema.tables WHERE table_name='blocked_slots';" | grep -q 1 \
  && green "Tabellen för spärrade tider finns" || red "Tabellen saknas"
R=$(call GET /api/admin/blocked-slots "$TOKEN")
[ "$(status "$R")" = "403" ] && green "Endast admin kan spärra tider" || red "Behörighetsfel på spärrade tider"

# ---------------------------------------------------------------------
head "10. Adminkonto och behörigheter"
# ---------------------------------------------------------------------
ADMINS=$(sql "SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=TRUE;" | tr -d ' ')
[ "$ADMINS" -ge 1 ] && green "Aktivt administratörskonto finns ($ADMINS st)" \
                    || red "Inget aktivt administratörskonto"

# Självregistrering får aldrig ge administratörsbehörighet.
R=$(call POST /api/auth/register "" "{username:'rolltest$TS',password:'Testlosen123',fullName:'Rolltest',role:'admin'}")
NEWROLE=$(sql "SELECT role FROM users WHERE username='rolltest$TS';" | tr -d ' ')
[ "$NEWROLE" = "seller" ] && green "Självregistrering ger alltid rollen säljare" \
                          || red "Självregistrering gav rollen: $NEWROLE"
APPROVED=$(sql "SELECT is_approved FROM users WHERE username='rolltest$TS';" | tr -d ' ')
[ "$APPROVED" = "f" ] && green "Nya konton är spärrade tills admin godkänner" \
                      || red "Nytt konto var aktivt direkt"
sql "DELETE FROM users WHERE username='rolltest$TS';" >/dev/null

# Byte av eget lösenord ska finnas och kräva rätt nuvarande lösenord.
R=$(call POST /api/auth/change-password "$TOKEN" "{currentPassword:'felaktigt',newPassword:'NyttLosen123'}")
[ "$(status "$R")" = "401" ] && green "Lösenordsbyte kräver rätt nuvarande lösenord" \
                            || red "Lösenordsbyte accepterade fel lösenord"
R=$(call POST /api/auth/change-password "$TOKEN" "{currentPassword:'Testlosen123',newPassword:'NyttLosen123'}")
[ "$(status "$R")" = "200" ] && green "Användare kan byta sitt eget lösenord" \
                            || red "Lösenordsbyte misslyckades: $(payload "$R")"

# ---------------------------------------------------------------------
head "11. PWA och webbapp"
# ---------------------------------------------------------------------
for f in / /manifest.webmanifest /sw.js /icon-192.png /logo.png; do
  R=$(call GET "$f")
  [ "$(status "$R")" = "200" ] && green "Levereras: $f" || red "Saknas: $f"
done

# ---------------------------------------------------------------------
head "12. Skyddsindexet i databasen"
# ---------------------------------------------------------------------
sql "SELECT indexdef FROM pg_indexes WHERE indexname='bookings_active_slot_key';" \
  | grep -q "status <> 'cancelled'" \
  && green "Unikt index gäller endast aktiva bokningar" || red "Skyddsindexet saknas eller är fel"

# ---------------------------------------------------------------------
head "Städar"
# ---------------------------------------------------------------------
sql "DELETE FROM bookings WHERE seller_name LIKE 'Testsäljare %';" >/dev/null
sql "DELETE FROM users WHERE username = '$SELLER';" >/dev/null
green "Testdata borttagen"

# ---------------------------------------------------------------------
printf '\n\033[1m%s\033[0m\n' "Resultat: $PASS godkända, $FAIL underkända"
[ "$FAIL" -eq 0 ] && printf '\033[32mSystemet uppfyller samtliga krav.\033[0m\n' \
                  || printf '\033[31mÅtgärda punkterna ovan innan lansering.\033[0m\n'
exit "$FAIL"
