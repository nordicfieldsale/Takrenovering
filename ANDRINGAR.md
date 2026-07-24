# Genomgång och ändringar

Hela systemet är läst rad för rad: databasschema, server, alla fyra
rutt-filer, valideringen, tidslogiken, webbappen och stilmallen.
Nedan står vad som hittades och vad som gjorts åt det.

---

## Fel som rättats

### 1. Interna anteckningar följde med till säljare och tekniker
`GET /api/bookings/:id` tog bort fältet `notes` för alla utom administratörer.
Listan, `GET /api/bookings`, gjorde det inte. Alltså fick varje säljare och
tekniker med sig de interna anteckningarna i klartext så fort de öppnade sin
egen lista — de syntes inte i gränssnittet, men låg i svaret.

Rättat i `server/src/routes/bookings.js`: samma regel gäller nu på båda
ställena.

### 2. Adminflikarna gled in bakom loggan vid scroll
Både `.topbar` och `.tabs` var `position: sticky` mot `top: 0`. När sidan
scrollades fastnade båda i toppen och flikraden hamnade under headern, som
har högre z-index. Flikarna blev alltså osynliga och oklickbara i praktiken.

Rättat i `styles.css`: flikarna fastnar under headern i stället, med hänsyn
tagen till notch-höjden på iPhone.

### 3. Bokningsreglerna gick inte att ändra trots att dokumentationen sa det
README lovar att tider och besökslängd ändras i `.env`. Men
`docker-compose.yml` skickade bara vidare `BOOKING_TIMEZONE` till appen, och
`.env.example` nämnde inte de övriga alls. Den som ändrade öppettiderna såg
ingen effekt.

Rättat: `BOOKING_OPEN`, `BOOKING_CLOSE`, `BOOKING_DURATION_MINUTES` och
`BOOKING_HORIZON_DAYS` skickas nu vidare och finns dokumenterade i
`.env.example`.

### 4. Zoom var avstängd
`maximum-scale=1` i `index.html` hindrade förstoring. Det bryter mot
tillgänglighetskraven och är onödigt — fälten är redan 16px, vilket är det
som hindrar iOS från att auto-zooma vid fokus.

### 5. Småsaker
- Knappen "Spara lösenord" på återställningssidan gick att trycka flera
  gånger i rad medan anropet pågick.
- `SellerApp` fick en `user`-prop som komponenten aldrig tog emot.

---

## Sådant du bör känna till, men som inte ändrats

**Säljare kan inte avboka.** Bara administratörer får ändra status på en
bokning. Ringer en kund återbud direkt till säljaren måste säljaren höra av
sig till administratören. Det kan mycket väl vara avsiktligt — men det är
värt ett beslut. Att låta säljare avboka sina *egna* bokningar vore en liten
ändring och tiden frigörs automatiskt i kalendern.

**Ett byte av lösenord loggar inte ut befintliga sessioner.** Den som redan
är inloggad på en annan enhet fortsätter vara det tills token går ut, som
längst tolv timmar.

**Återställningslänkar skickas inte med e-post ännu.** De skrivs i
serverloggen, och administratören kan hämta en länk under Användare →
Nytt lösenord. Det fungerar, men kräver ett manuellt steg.

**Databasen har inget skydd mot att en tekniker tas bort mitt i.**
`ON DELETE RESTRICT` gör att det inte går om det finns bokningar, vilket är
rätt — men felmeddelandet blir ett rått databasfel i stället för en förklaring.

---

## Vad som förbättrats i utseendet

Riktningen är **fältinstrument**. Appen används stående vid en ytterdörr, ofta
i dagsljus och alltid med bråttom. Den ska gå att läsa av som ett mätdon.

**Färg.** Bakgrunden är en sval zinkgrå i stället för vit, så att de vita
korten faktiskt läser som kort. Svart har bytts mot ett trycksvart med en
aning blått. Loggans röda ligger kvar oförändrat, men används nu bara till
tre saker: det som är valt, den primära åtgärden, och fel. Aldrig till
utsmyckning.

**Typsnitt.** Systemtypsnittet är kvar, och det är ett medvetet val: en
webbläsare får inte hämta typsnitt från andra domäner med de säkerhetsregler
appen kör med, och ett fältverktyg ska starta direkt. Personligheten ligger i
skalan i stället — tätare rubriker, versala instrumentetiketter, och
tabellsiffror överallt så att tider och datum står i kolumn.

**Signaturen: beläggningen syns i datumraden.** Varje datum bär en stapel med
sex små segment, ett per tidslucka. Gröna segment är lediga tider. Säljaren
ser hela horisontens beläggning på en blick, utan att trycka någonstans.
Det går att göra just för att dagen har ett fast antal luckor.

**Tidsluckorna.** En upptagen tid är inte längre bara grå — tiden är
överstruken. Skillnaden mellan "kan bokas" och "kan inte bokas" syns nu i
ögonvrån, inte bara vid närläsning.

**Övrigt.** Statusmärken har fått en färgprick, panelerna ett draghandtag,
inloggningen ett kort att vila i, och knappar en liten nedtryckning vid
tryck. Rörelse respekterar systeminställningen för minskad animation, och
fokusmarkeringen är synlig för den som använder tangentbord.
