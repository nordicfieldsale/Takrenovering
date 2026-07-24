import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Tidigare versioner registrerade en service worker som kunde fastna med en
// gammal, trasig version av appen i cachen. Här avregistreras den och all
// cache rensas, så att webbläsaren alltid hämtar den senaste versionen.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}
if (window.caches) {
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}
