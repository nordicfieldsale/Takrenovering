-- =====================================================================
--  Villa Takrenovering – bokningssystem
--  PostgreSQL 13+
--
--  Kör:  psql -U postgres -d villa_booking -f db/schema.sql
--  Skriptet är idempotent och kan köras om utan att data försvinner.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Hjälpfunktion: håller updated_at aktuell
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Användare
--   role = admin      -> full åtkomst
--   role = seller     -> skapar bokningar, ser endast sina egna
--   role = technician -> ser endast sitt eget schema (Karl / Daniel)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(160),
  phone         VARCHAR(32),
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('admin', 'seller', 'technician')),
  is_approved   BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Användarnamn är skiftlägesokänsligt unikt: "Anna" och "anna" är samma konto.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON users (lower(email)) WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Tekniker (de som utför takbesöken)
--   Egen tabell i stället för hårdkodade strängar, så att Karl och Daniel
--   kan logga in och se sitt schema, och så att fler kan läggas till.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technicians (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(80) NOT NULL UNIQUE,
  user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Bokningar
--   booking_date + start_time är den auktoritativa tiden.
--   end_time skrivs av applikationen (start + besökslängd).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  first_name    VARCHAR(80)  NOT NULL,
  last_name     VARCHAR(80)  NOT NULL,
  address       VARCHAR(300) NOT NULL,
  phone         VARCHAR(32)  NOT NULL,
  booking_date  DATE         NOT NULL,
  start_time    TIME         NOT NULL,
  end_time      TIME         NOT NULL,
  technician_id INTEGER      NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  seller_id     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  seller_name   VARCHAR(120) NOT NULL,  -- kopia, så historik överlever borttaget konto
  status        VARCHAR(20)  NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','confirmed','completed','sold','cancelled','no_show')),
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- KÄRNAN I DUBBELBOKNINGSSKYDDET.
-- Partiellt index: en avbokad tid frigörs och kan bokas på nytt, men två
-- aktiva bokningar kan aldrig existera på samma tekniker + dag + tid.
-- Detta gäller även vid samtidiga anrop – databasen serialiserar dem.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_key
  ON bookings (technician_id, booking_date, start_time)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS bookings_seller_idx ON bookings (seller_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS bookings_date_idx   ON bookings (booking_date DESC, start_time);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status);

DROP TRIGGER IF EXISTS bookings_set_updated_at ON bookings;
CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Blockerade tider (semester, restid, internmöten m.m.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocked_slots (
  id            SERIAL PRIMARY KEY,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  blocked_date  DATE    NOT NULL,
  start_time    TIME    NOT NULL,
  reason        VARCHAR(200),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (technician_id, blocked_date, start_time)
);

CREATE INDEX IF NOT EXISTS blocked_slots_date_idx ON blocked_slots (blocked_date);

-- ---------------------------------------------------------------------
-- Lösenordsåterställning
--   Endast en hash av token sparas – själva token finns bara i länken.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ  NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);

-- ---------------------------------------------------------------------
-- Grunddata: teknikerna
-- ---------------------------------------------------------------------
INSERT INTO technicians (name, sort_order) VALUES ('Karl', 1), ('Daniel', 2)
ON CONFLICT (name) DO NOTHING;

COMMIT;
