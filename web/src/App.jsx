import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

/* =====================================================================
   Gemensamt
   ===================================================================== */

const STATUS_LABELS = {
  new: 'Ny bokning',
  confirmed: 'Bekräftad',
  completed: 'Genomförd',
  sold: 'Såld',
  cancelled: 'Avbokad',
  no_show: 'Ej hemma',
};
const STATUS_ORDER = ['new', 'confirmed', 'completed', 'sold', 'no_show', 'cancelled'];

const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];

function parseDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function weekdayShort(dateStr) {
  return WEEKDAYS[parseDate(dateStr).getDay()];
}

function dayNumber(dateStr) {
  return parseDate(dateStr).getDate();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function monthShort(dateStr) {
  return MONTHS[parseDate(dateStr).getMonth()];
}

/** Dagens datum i lokal tid. toISOString() ger UTC och kan hoppa en dag fel. */
function todayLocal() {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function longDate(dateStr) {
  return parseDate(dateStr).toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function Badge({ status }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABELS[status] || status}</span>;
}

function Notice({ kind = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button className="btn btn--ghost" onClick={onClose}>
            Stäng
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Spinner({ label = 'Hämtar…' }) {
  return <p className="empty">{label}</p>;
}

/* =====================================================================
   Rot
   ===================================================================== */

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [resetToken, setResetToken] = useState(null);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token && window.location.pathname.startsWith('/aterstall')) setResetToken(token);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  if (!ready) return <div className="empty">Startar…</div>;

  if (resetToken) {
    return <ResetPassword token={resetToken} onDone={() => {
      window.history.replaceState({}, '', '/');
      setResetToken(null);
    }} />;
  }

  if (!user) return <AuthScreen onSignedIn={setUser} />;

  return (
    <div className="app">
      <header className="topbar">
        <img className="topbar__logo" src="/logo.png" alt="Villa Takrenovering" />
        <div className="topbar__spacer" />
        <button className="topbar__user" onClick={() => setShowAccount(true)}>
          <strong>{user.fullName}</strong>
          <span>
            {user.role === 'admin' ? 'Administratör' : user.role === 'technician' ? 'Tekniker' : 'Säljare'}
          </span>
        </button>
        <button className="btn btn--ghost" onClick={signOut}>
          Logga ut
        </button>
      </header>

      {showAccount && <AccountSheet user={user} onClose={() => setShowAccount(false)} />}

      {user.role === 'seller' && <SellerApp />}
      {user.role === 'technician' && <TechnicianApp />}
      {user.role === 'admin' && <AdminApp user={user} />}
    </div>
  );
}

/* =====================================================================
   Mitt konto – alla roller kan byta sitt eget lösenord
   ===================================================================== */

function AccountSheet({ user, onClose }) {
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.next !== form.repeat) return setError('De nya lösenorden matchar inte.');
    if (form.next.length < 8) return setError('Det nya lösenordet måste vara minst 8 tecken.');

    setBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: form.current, newPassword: form.next },
      });
      setForm({ current: '', next: '', repeat: '' });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const roleLabel =
    user.role === 'admin' ? 'Administratör' : user.role === 'technician' ? 'Tekniker' : 'Säljare';

  return (
    <Sheet title="Mitt konto" onClose={onClose}>
      <div className="stack">
        <dl style={{ margin: 0 }}>
          <div className="detail-row"><dt>Namn</dt><dd>{user.fullName}</dd></div>
          <div className="detail-row"><dt>Användarnamn</dt><dd>{user.username}</dd></div>
          <div className="detail-row"><dt>Behörighet</dt><dd>{roleLabel}</dd></div>
        </dl>

        <form className="stack" onSubmit={submit}>
          <div className="section-label">Byt lösenord</div>

          <Notice kind="error">{error}</Notice>
          <Notice kind="success">{done ? 'Lösenordet är ändrat.' : ''}</Notice>

          <Field label="Nuvarande lösenord">
            <input
              type="password"
              value={form.current}
              onChange={set('current')}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Nytt lösenord (minst 8 tecken)">
            <input
              type="password"
              value={form.next}
              onChange={set('next')}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Upprepa nytt lösenord">
            <input
              type="password"
              value={form.repeat}
              onChange={set('repeat')}
              autoComplete="new-password"
              required
            />
          </Field>

          <button className="btn btn--primary" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Spara nytt lösenord'}
          </button>
        </form>
      </div>
    </Sheet>
  );
}

/* =====================================================================
   Inloggning
   ===================================================================== */

function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', fullName: '', email: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const data = await api('/auth/login', {
          method: 'POST',
          body: { username: form.username, password: form.password },
        });
        setToken(data.token);
        onSignedIn(data.user);
      } else if (mode === 'register') {
        const data = await api('/auth/register', { method: 'POST', body: form });
        setSuccess(data.message);
        setMode('login');
        setForm({ username: form.username, password: '', fullName: '', email: '' });
      } else {
        const data = await api('/auth/forgot-password', {
          method: 'POST',
          body: { identifier: form.username },
        });
        setSuccess(data.devResetLink ? `${data.message} Testlänk: ${data.devResetLink}` : data.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__inner">
        <img className="auth__logo" src="/logo.png" alt="Villa Takrenovering" />

        <form className="auth__card stack" onSubmit={submit}>
          <h1 className="page-title">
            {mode === 'login' ? 'Logga in' : mode === 'register' ? 'Skapa konto' : 'Återställ lösenord'}
          </h1>
          <p className="page-sub">
            {mode === 'login'
              ? 'Bokning av kostnadsfria takbesök.'
              : mode === 'register'
                ? 'En administratör godkänner kontot innan du kan logga in.'
                : 'Ange ditt användarnamn eller din e-post.'}
          </p>

          <Notice kind="error">{error}</Notice>
          <Notice kind="success">{success}</Notice>

          <Field label={mode === 'forgot' ? 'Användarnamn eller e-post' : 'Användarnamn'}>
            <input
              value={form.username}
              onChange={set('username')}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </Field>

          {mode === 'register' && (
            <>
              <Field label="För- och efternamn">
                <input value={form.fullName} onChange={set('fullName')} autoComplete="name" required />
              </Field>
              <Field label="E-post (valfritt)">
                <input type="email" value={form.email} onChange={set('email')} autoComplete="email" />
              </Field>
            </>
          )}

          {mode !== 'forgot' && (
            <Field label="Lösenord">
              <input
                type="password"
                value={form.password}
                onChange={set('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </Field>
          )}

          <button className="btn btn--primary" disabled={busy}>
            {busy ? <span className="spinner" /> : mode === 'login' ? 'Logga in' : mode === 'register' ? 'Skapa konto' : 'Skicka länk'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
                setSuccess('');
              }}
            >
              {mode === 'login' ? 'Skapa konto' : 'Till inloggning'}
            </button>
            {mode !== 'forgot' && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setMode('forgot');
                  setError('');
                  setSuccess('');
                }}
              >
                Glömt lösenord
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password !== repeat) return setError('Lösenorden matchar inte.');
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__inner">
        <img className="auth__logo" src="/logo.png" alt="Villa Takrenovering" />
        {done ? (
          <div className="auth__card stack">
            <Notice kind="success">Lösenordet är ändrat.</Notice>
            <button className="btn btn--primary" onClick={onDone}>
              Till inloggning
            </button>
          </div>
        ) : (
          <form className="auth__card stack" onSubmit={submit}>
            <h1 className="page-title">Välj nytt lösenord</h1>
            <Notice kind="error">{error}</Notice>
            <Field label="Nytt lösenord (minst 8 tecken)">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Field label="Upprepa lösenordet">
              <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
            </Field>
            <button className="btn btn--primary" disabled={busy}>
              {busy ? <span className="spinner" /> : 'Spara lösenord'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   Säljare
   ===================================================================== */

function SellerApp() {
  const [view, setView] = useState('home');

  if (view === 'new') return <NewBooking onDone={() => setView('home')} onCancel={() => setView('home')} />;
  return <SellerHome onNew={() => setView('new')} />;
}

function SellerHome({ onNew }) {
  const [summary, setSummary] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/bookings/summary'), api('/bookings?limit=100')])
      .then(([s, b]) => {
        setSummary(s);
        setBookings(b);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <main className="stack has-actionbar">
        <div>
          <h1 className="page-title">Dina bokningar</h1>
          <p className="page-sub">Du ser endast dina egna kunder.</p>
        </div>

        <Notice kind="error">{error}</Notice>

        {summary && (
          <div className="stats">
            <div className="stat">
              <div className="stat__value">{summary.total}</div>
              <div className="stat__label">Bokade möten</div>
            </div>
            <div className="stat">
              <div className="stat__value">{summary.upcoming}</div>
              <div className="stat__label">Kommande</div>
            </div>
            <div className="stat">
              <div className="stat__value">{summary.byStatus.completed}</div>
              <div className="stat__label">Genomförda</div>
            </div>
            <div className="stat">
              <div className="stat__value">{summary.byStatus.sold}</div>
              <div className="stat__label">Sålda jobb</div>
            </div>
          </div>
        )}

        {bookings === null ? (
          <Spinner />
        ) : bookings.length === 0 ? (
          <p className="empty">Inga bokningar än. Tryck på Boka takbesök för att lägga upp den första.</p>
        ) : (
          <div className="stack-sm">
            {bookings.map((b) => (
              <div className="card" key={b.id}>
                <div className="booking__top">
                  <div>
                    <div className="booking__name">
                      {b.firstName} {b.lastName}
                    </div>
                    <div className="booking__meta">{b.address}</div>
                    <div className="booking__meta">{b.phone}</div>
                  </div>
                  <Badge status={b.status} />
                </div>
                <div className="booking__when">
                  {longDate(b.date)} · {b.startTime}–{b.endTime} · {b.technician}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <div className="actionbar">
        <div className="actionbar__inner">
          <button className="btn btn--primary" onClick={onNew}>
            Boka takbesök
          </button>
        </div>
      </div>
    </>
  );
}

function NewBooking({ onDone, onCancel }) {
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState({ firstName: '', lastName: '', address: '', phone: '' });
  const [error, setError] = useState('');

  const set = (key) => (e) => setCustomer((c) => ({ ...c, [key]: e.target.value }));

  function next(e) {
    e.preventDefault();
    const { firstName, lastName, address, phone } = customer;
    if (!firstName.trim() || !lastName.trim() || !address.trim() || !phone.trim()) {
      return setError('Fyll i alla fält innan du går vidare.');
    }
    setError('');
    setStep(2);
  }

  if (step === 2) {
    return <PickTime customer={customer} onBack={() => setStep(1)} onDone={onDone} />;
  }

  return (
    <>
      <main>
        <form className="stack" onSubmit={next}>
          <div>
            <h1 className="page-title">Kunduppgifter</h1>
            <p className="page-sub">Steg 1 av 2</p>
          </div>

          <Notice kind="error">{error}</Notice>

          <Field label="Förnamn">
            <input value={customer.firstName} onChange={set('firstName')} autoComplete="given-name" required />
          </Field>
          <Field label="Efternamn">
            <input value={customer.lastName} onChange={set('lastName')} autoComplete="family-name" required />
          </Field>
          <Field label="Adress">
            <input value={customer.address} onChange={set('address')} autoComplete="street-address" required />
          </Field>
          <Field label="Telefonnummer">
            <input
              type="tel"
              inputMode="tel"
              value={customer.phone}
              onChange={set('phone')}
              autoComplete="tel"
              required
            />
          </Field>

          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={onCancel}>
              Avbryt
            </button>
            <button className="btn btn--primary">Välj tid</button>
          </div>
        </form>
      </main>
    </>
  );
}

function PickTime({ customer, onBack, onDone }) {
  const [technicians, setTechnicians] = useState([]);
  const [technicianId, setTechnicianId] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [date, setDate] = useState(null);
  const [start, setStart] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/technicians')
      .then((list) => {
        setTechnicians(list);
        if (list.length) setTechnicianId(list[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  const loadAvailability = useCallback(async (id) => {
    setAvailability(null);
    try {
      const data = await api(`/availability?technicianId=${id}`);
      setAvailability(data);
      const firstOpen = data.days.find((d) => d.slots.some((s) => s.status === 'free'));
      setDate((firstOpen || data.days[0])?.date ?? null);
      setStart(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (technicianId) loadAvailability(technicianId);
  }, [technicianId, loadAvailability]);

  const day = useMemo(
    () => availability?.days.find((d) => d.date === date) ?? null,
    [availability, date]
  );

  async function book() {
    if (!date || !start) return;
    setBusy(true);
    setError('');
    try {
      await api('/bookings', {
        method: 'POST',
        body: { ...customer, technicianId, date, startTime: start },
      });
      onDone();
    } catch (err) {
      setError(err.message);
      // Tiden kan ha tagits av någon annan medan formuläret var öppet.
      setStart(null);
      loadAvailability(technicianId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <main className="stack has-actionbar">
        <div>
          <h1 className="page-title">Välj tid</h1>
          <p className="page-sub">
            Steg 2 av 2 · {customer.firstName} {customer.lastName}
          </p>
        </div>

        <Notice kind="error">{error}</Notice>

        <div>
          <div className="section-label">Vem utför besöket</div>
          <div className="btn-row">
            {technicians.map((t) => (
              <button
                key={t.id}
                className={`btn ${technicianId === t.id ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setTechnicianId(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {technicians.length === 0 ? (
          <p className="empty">Ingen person är upplagd att utföra besök. Kontakta administratören.</p>
        ) : availability === null ? (
          <Spinner label="Hämtar lediga tider…" />
        ) : (
          <>
            <div>
              <div className="section-label">Datum · gröna streck = lediga tider</div>
              <div className="chips">
                {availability.days.map((d, i) => {
                  const freeCount = d.slots.filter((s) => s.status === 'free').length;
                  const full = freeCount === 0;
                  // Månaden skrivs bara ut när den byter, annars är den brus.
                  const newMonth =
                    i === 0 || monthShort(d.date) !== monthShort(availability.days[i - 1].date);
                  return (
                    <button
                      key={d.date}
                      className={`chip ${full ? 'chip--full' : ''}`}
                      aria-pressed={d.date === date}
                      aria-label={`${longDate(d.date)}, ${freeCount} lediga tider`}
                      onClick={() => {
                        setDate(d.date);
                        setStart(null);
                      }}
                    >
                      <span className="chip__day">{weekdayShort(d.date)}</span>
                      <span className="chip__date">{dayNumber(d.date)}</span>
                      <span className="chip__month">{newMonth ? monthShort(d.date) : '\u00a0'}</span>
                      <span className="chip__load" aria-hidden="true">
                        {d.slots.map((s) => (
                          <i key={s.start} className={s.status === 'free' ? 'is-free' : ''} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="section-label">
                Tid · {availability.durationMinutes} minuter per besök
              </div>
              {day && (
                <div className="slots">
                  {day.slots.map((s) => {
                    const disabled = s.status !== 'free';
                    return (
                      <button
                        key={s.start}
                        className="slot"
                        disabled={disabled}
                        aria-pressed={start === s.start}
                        onClick={() => setStart(s.start)}
                      >
                        <span className="slot__time">
                          {s.start}–{s.end}
                        </span>
                        <span className="slot__note">
                          {s.status === 'free'
                            ? 'Ledig'
                            : s.status === 'booked'
                              ? 'Bokad'
                              : s.status === 'blocked'
                                ? 'Spärrad'
                                : 'Passerad'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <div className="actionbar">
        <div className="actionbar__inner btn-row">
          <button className="btn btn--secondary" onClick={onBack} disabled={busy}>
            Tillbaka
          </button>
          <button className="btn btn--primary" onClick={book} disabled={!start || busy}>
            {busy ? <span className="spinner" /> : 'Boka'}
          </button>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Tekniker – eget schema
   ===================================================================== */

function TechnicianApp() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const today = todayLocal();

  useEffect(() => {
    api(`/bookings?from=${today}&limit=200`)
      .then(setBookings)
      .catch((err) => setError(err.message));
  }, [today]);

  const byDate = useMemo(() => {
    if (!bookings) return [];
    const map = new Map();
    for (const b of [...bookings].sort((a, b) =>
      a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
    )) {
      if (!map.has(b.date)) map.set(b.date, []);
      map.get(b.date).push(b);
    }
    return [...map.entries()];
  }, [bookings]);

  return (
    <main className="stack">
      <div>
        <h1 className="page-title">Ditt schema</h1>
        <p className="page-sub">Kommande takbesök.</p>
      </div>

      <Notice kind="error">{error}</Notice>

      {bookings === null ? (
        <Spinner />
      ) : byDate.length === 0 ? (
        <p className="empty">Inga inbokade besök framåt.</p>
      ) : (
        byDate.map(([date, items]) => (
          <div key={date}>
            <div className="section-label">{longDate(date)}</div>
            <div className="stack-sm">
              {items.map((b) => (
                <div className="card" key={b.id}>
                  <div className="booking__top">
                    <div>
                      <div className="booking__name">
                        {b.startTime}–{b.endTime} · {b.firstName} {b.lastName}
                      </div>
                      <div className="booking__meta">{b.address}</div>
                      <div className="booking__meta">
                        <a href={`tel:${b.phone}`}>{b.phone}</a>
                      </div>
                    </div>
                    <Badge status={b.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </main>
  );
}

/* =====================================================================
   Administratör
   ===================================================================== */

function AdminApp({ user }) {
  const [tab, setTab] = useState('overview');

  const tabs = [
    ['overview', 'Översikt'],
    ['bookings', 'Bokningar'],
    ['times', 'Tider'],
    ['users', 'Användare'],
  ];

  return (
    <>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} aria-current={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <AdminOverview />}
      {tab === 'bookings' && <AdminBookings />}
      {tab === 'times' && <AdminTimes />}
      {tab === 'users' && <AdminUsers me={user} />}
    </>
  );
}

function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/stats').then(setStats).catch((err) => setError(err.message));
  }, []);

  if (error) return <main><Notice kind="error">{error}</Notice></main>;
  if (!stats) return <main><Spinner /></main>;

  return (
    <main className="stack">
      <h1 className="page-title">Översikt</h1>

      <div className="stats">
        <div className="stat">
          <div className="stat__value">{stats.total}</div>
          <div className="stat__label">Bokningar totalt</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.byStatus.completed}</div>
          <div className="stat__label">Genomförda möten</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.byStatus.sold}</div>
          <div className="stat__label">Sålda jobb</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.conversionRate}%</div>
          <div className="stat__label">Andel sålda av besökta</div>
        </div>
      </div>

      <div className="card">
        <div className="section-label">Per säljare</div>
        <table className="table">
          <thead>
            <tr>
              <th>Säljare</th>
              <th>Bokat</th>
              <th>Genomfört</th>
              <th>Sålt</th>
            </tr>
          </thead>
          <tbody>
            {stats.bySeller.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">Inga säljare ännu.</td>
              </tr>
            ) : (
              stats.bySeller.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.total}</td>
                  <td>{s.completed}</td>
                  <td>{s.sold}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="section-label">Per person</div>
        <table className="table">
          <tbody>
            {stats.byTechnician.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.total} besök</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">Senaste 30 dagarna: {stats.last30Days} nya bokningar.</p>
    </main>
  );
}

function AdminBookings() {
  const [bookings, setBookings] = useState(null);
  const [sellers, setSellers] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [filters, setFilters] = useState({ date: '', sellerId: '', technicianId: '', status: '' });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBookings(null);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    params.set('limit', '300');
    try {
      setBookings(await api(`/bookings?${params}`));
    } catch (err) {
      setError(err.message);
      setBookings([]);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api('/admin/users')
      .then((list) => setSellers(list.filter((u) => u.role === 'seller')))
      .catch(() => {});
    api('/technicians').then(setTechnicians).catch(() => {});
  }, []);

  async function exportCsv() {
    try {
      const response = await api('/bookings/export.csv', { raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bokningar-${todayLocal()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <main className="stack">
      <h1 className="page-title">Bokningar</h1>
      <Notice kind="error">{error}</Notice>

      <div className="card stack-sm">
        <div className="filters">
          <Field label="Datum">
            <input type="date" value={filters.date} onChange={set('date')} />
          </Field>
          <Field label="Säljare">
            <select value={filters.sellerId} onChange={set('sellerId')}>
              <option value="">Alla</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </Field>
          <Field label="Utförs av">
            <select value={filters.technicianId} onChange={set('technicianId')}>
              <option value="">Alla</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Status">
          <select value={filters.status} onChange={set('status')}>
            <option value="">Alla</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
        <div className="btn-row">
          <button className="btn btn--secondary btn--sm" onClick={() => setFilters({ date: '', sellerId: '', technicianId: '', status: '' })}>
            Rensa filter
          </button>
          <button className="btn btn--secondary btn--sm" onClick={exportCsv}>
            Exportera till Excel
          </button>
        </div>
      </div>

      {bookings === null ? (
        <Spinner />
      ) : bookings.length === 0 ? (
        <p className="empty">Inga bokningar matchar filtret.</p>
      ) : (
        <div className="stack-sm">
          {bookings.map((b) => (
            <button className="card card--tap" key={b.id} onClick={() => setSelected(b)}>
              <div className="booking__top">
                <div>
                  <div className="booking__name">{b.firstName} {b.lastName}</div>
                  <div className="booking__meta">{b.address}</div>
                </div>
                <Badge status={b.status} />
              </div>
              <div className="booking__when">
                {longDate(b.date)} · {b.startTime}–{b.endTime} · {b.technician}
              </div>
              <div className="booking__meta">Bokad av {b.seller}</div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <BookingSheet
          booking={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setBookings((list) => list.map((b) => (b.id === updated.id ? updated : b)));
            setSelected(updated);
          }}
        />
      )}
    </main>
  );
}

function BookingSheet({ booking, onClose, onSaved }) {
  const [notes, setNotes] = useState(booking.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function update(patch) {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const updated = await api(`/bookings/${booking.id}`, { method: 'PATCH', body: patch });
      onSaved(updated);
      setSaved('Sparat.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`${booking.firstName} ${booking.lastName}`} onClose={onClose}>
      <div className="stack">
        <Notice kind="error">{error}</Notice>
        <Notice kind="success">{saved}</Notice>

        <dl style={{ margin: 0 }}>
          <div className="detail-row"><dt>Adress</dt><dd>{booking.address}</dd></div>
          <div className="detail-row">
            <dt>Telefon</dt>
            <dd><a href={`tel:${booking.phone}`}>{booking.phone}</a></dd>
          </div>
          <div className="detail-row"><dt>Datum</dt><dd>{longDate(booking.date)}</dd></div>
          <div className="detail-row"><dt>Tid</dt><dd>{booking.startTime}–{booking.endTime}</dd></div>
          <div className="detail-row"><dt>Utförs av</dt><dd>{booking.technician}</dd></div>
          <div className="detail-row"><dt>Bokad av</dt><dd>{booking.seller}</dd></div>
        </dl>

        <div>
          <div className="section-label">Status</div>
          <div className="status-grid">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                aria-pressed={booking.status === s}
                disabled={busy}
                onClick={() => update({ status: s })}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="section-label">Intern anteckning</div>
          <Field label="Syns endast för administratörer">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="T.ex. kunden vill bli uppringd innan besöket."
            />
          </Field>
          <button className="btn btn--secondary" disabled={busy} onClick={() => update({ notes })}>
            Spara anteckning
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function AdminTimes() {
  const [technicians, setTechnicians] = useState([]);
  const [config, setConfig] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [form, setForm] = useState({ technicianId: '', date: '', startTime: '', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setBlocked(await api('/admin/blocked-slots'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    api('/technicians').then((list) => {
      setTechnicians(list);
      setForm((f) => ({ ...f, technicianId: list[0]?.id ?? '' }));
    }).catch((err) => setError(err.message));
    api('/config').then(setConfig).catch(() => {});
    load();
  }, [load]);

  async function block(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('/admin/blocked-slots', { method: 'POST', body: form });
      setMessage('Tiden är spärrad och går inte längre att boka.');
      setForm((f) => ({ ...f, reason: '' }));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function unblock(id) {
    setError('');
    setMessage('');
    try {
      await api(`/admin/blocked-slots/${id}`, { method: 'DELETE' });
      setMessage('Tiden är öppnad igen.');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <main className="stack">
      <div>
        <h1 className="page-title">Tider</h1>
        <p className="page-sub">
          Besöken bokas måndag–fredag{config ? `, ${config.slotTimes[0]?.start}–${config.slotTimes.at(-1)?.end}` : ''}
          {config ? `, ${config.durationMinutes} minuter per besök` : ''}. Spärra enskilda tider här.
        </p>
      </div>

      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{message}</Notice>

      <form className="card stack-sm" onSubmit={block}>
        <div className="section-label">Spärra en tid</div>
        <div className="filters">
          <Field label="Person">
            <select value={form.technicianId} onChange={set('technicianId')} required>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Datum">
            <input type="date" value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Tid">
            <select value={form.startTime} onChange={set('startTime')} required>
              <option value="">Välj</option>
              {(config?.slotTimes ?? []).map((s) => (
                <option key={s.start} value={s.start}>{s.start}–{s.end}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Orsak (valfritt)">
          <input value={form.reason} onChange={set('reason')} placeholder="T.ex. internmöte" />
        </Field>
        <button className="btn btn--primary">Spärra tiden</button>
      </form>

      <div className="card">
        <div className="section-label">Spärrade tider framåt</div>
        {blocked === null ? (
          <Spinner />
        ) : blocked.length === 0 ? (
          <p className="muted">Inga spärrade tider.</p>
        ) : (
          blocked.map((b) => (
            <div className="list-row" key={b.id}>
              <div className="list-row__main">
                <div className="list-row__title">
                  {longDate(b.date)} · {b.startTime}–{b.endTime}
                </div>
                <div className="list-row__sub">
                  {b.technician}
                  {b.reason ? ` · ${b.reason}` : ''}
                </div>
              </div>
              <div className="list-row__actions">
                <button className="btn btn--secondary btn--sm" onClick={() => unblock(b.id)}>
                  Öppna
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

function AdminUsers({ me }) {
  const [users, setUsers] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api('/admin/users'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    api('/technicians').then(setTechnicians).catch(() => {});
  }, [load]);

  async function act(fn, successMessage) {
    setError('');
    setMessage('');
    try {
      const result = await fn();
      setMessage(result?.message || successMessage);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetLink(user) {
    setError('');
    setMessage('');
    try {
      const data = await api(`/admin/users/${user.id}/reset-link`, { method: 'POST' });
      try {
        await navigator.clipboard.writeText(data.link);
        setMessage(`Återställningslänk för ${user.fullName} är kopierad. Den gäller i 24 timmar.`);
      } catch {
        setMessage(`Återställningslänk för ${user.fullName}: ${data.link}`);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  const bySwedishName = (a, b) => a.fullName.localeCompare(b.fullName, 'sv');
  const pending = (users ?? []).filter((u) => !u.isApproved).sort(bySwedishName);
  const active = (users ?? []).filter((u) => u.isApproved).sort(bySwedishName);

  return (
    <main className="stack">
      <h1 className="page-title">Användare</h1>
      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{message}</Notice>

      <div className="card">
        <div className="section-label">Väntar på godkännande ({pending.length})</div>
        {users === null ? (
          <Spinner />
        ) : pending.length === 0 ? (
          <p className="muted">Inga nya ansökningar.</p>
        ) : (
          pending.map((u) => (
            <div className="list-row" key={u.id}>
              <div className="list-row__main">
                <div className="list-row__title">{u.fullName}</div>
                <div className="list-row__sub">{u.username}{u.email ? ` · ${u.email}` : ''}</div>
              </div>
              <div className="list-row__actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => act(() => api(`/admin/users/${u.id}/approve`, { method: 'POST' }), 'Kontot är godkänt.')}
                >
                  Godkänn
                </button>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => {
                    if (confirm(`Neka och ta bort kontot ${u.fullName}?`)) {
                      act(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), 'Kontot är borttaget.');
                    }
                  }}
                >
                  Neka
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="section-label">Aktiva konton</div>
        {users === null && <Spinner />}
        {active.map((u) => (
          <div className="list-row" key={u.id}>
            <div className="list-row__main">
              <div className="list-row__title">
                {u.fullName} {!u.isActive && <span className="muted">(avstängd)</span>}
              </div>
              <div className="list-row__sub">
                {u.username} · {u.role === 'admin' ? 'administratör' : u.role === 'technician' ? 'tekniker' : 'säljare'}
                {u.bookingCount ? ` · ${u.bookingCount} bokningar` : ''}
              </div>
            </div>
            <div className="list-row__actions">
              <button className="btn btn--secondary btn--sm" onClick={() => resetLink(u)}>
                Nytt lösenord
              </button>
              {u.id !== me.id && (
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => {
                    if (confirm(`Ta bort ${u.fullName}?`)) {
                      act(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), 'Kontot är borttaget.');
                    }
                  }}
                >
                  Ta bort
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn--secondary" onClick={() => setShowCreate(true)}>
        Lägg till konto
      </button>

      {showCreate && (
        <CreateUserSheet
          technicians={technicians}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setMessage('Kontot är skapat och klart att använda.');
            load();
          }}
        />
      )}
    </main>
  );
}

function CreateUserSheet({ technicians, onClose, onCreated }) {
  const [form, setForm] = useState({
    fullName: '', username: '', password: '', email: '', role: 'seller', technicianId: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form };
      if (body.role !== 'technician') delete body.technicianId;
      await api('/admin/users', { method: 'POST', body });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Nytt konto" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Notice kind="error">{error}</Notice>
        <Field label="För- och efternamn">
          <input value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <Field label="Användarnamn">
          <input value={form.username} onChange={set('username')} autoCapitalize="none" required />
        </Field>
        <Field label="Lösenord (minst 8 tecken)">
          <input type="password" value={form.password} onChange={set('password')} required />
        </Field>
        <Field label="E-post (valfritt)">
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Roll">
          <select value={form.role} onChange={set('role')}>
            <option value="seller">Säljare</option>
            <option value="technician">Tekniker (ser sitt eget schema)</option>
            <option value="admin">Administratör</option>
          </select>
        </Field>
        {form.role === 'technician' && (
          <Field label="Vilken tekniker">
            <select value={form.technicianId} onChange={set('technicianId')} required>
              <option value="">Välj</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}
        <button className="btn btn--primary" disabled={busy}>
          Skapa konto
        </button>
      </form>
    </Sheet>
  );
}
