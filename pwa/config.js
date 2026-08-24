/**
 * config.js — Configuración de conexión al backend (Apps Script Web App).
 *
 * Cada persona de la familia tiene su propia copia del proyecto de Apps
 * Script (su propio Sheet, su propio Gmail conectado, su propio deploy).
 * Esta pantalla guarda en localStorage —solo en el celular de esa
 * persona, nunca sale de ahí— la URL de SU Web App y SU API key
 * (SHORTCUTS_API_KEY configurada en las Propiedades del script).
 *
 * Si falta la configuración, bloquea la carga del resto de la app y
 * muestra un formulario simple para completarla.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fz_config_v1';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  const existing = loadConfig();
  window.FZ_CONFIG = existing || { webAppUrl: '', apiKey: '' };

  if (existing && existing.webAppUrl) return; // ya configurado, seguir cargando la app normal

  // ── Sin configurar: mostrar formulario y detener la carga del resto ──
  // config.js se carga al final del <body>, así que el DOM ya está listo.
  showSetupScreen();

  function showSetupScreen() {
    if (document.getElementById('fzSetupOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'fzSetupOverlay';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:999999; background:#0b0f14;
      display:flex; align-items:center; justify-content:center; padding:24px;
      box-sizing:border-box; font-family:'Outfit',system-ui,sans-serif; color:#e5e9ee;
      overflow-y:auto; overflow-x:hidden; margin:0; border:none;
    `;
    document.documentElement.style.margin = '0';
    document.body.style.margin = '0';
    overlay.innerHTML = `
      <div style="width:100%;max-width:420px;min-width:0;box-sizing:border-box">
        <h1 style="font-size:22px;font-weight:700;margin:0 0 6px">Conectar Finanzas AI</h1>
        <p style="font-size:13px;color:#9aa4b2;margin:0 0 24px;line-height:1.5">
          Pega la URL de tu Web App de Apps Script y tu API key
          (Configuración → SHORTCUTS_API_KEY en tu proyecto).
        </p>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px">URL del Web App</label>
        <input id="fzSetupUrl" type="url" placeholder="https://script.google.com/macros/s/AKfycb.../exec"
          style="width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #2a323d;background:#141a22;color:#e5e9ee;font-size:14px;margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px">API Key (SHORTCUTS_API_KEY)</label>
        <input id="fzSetupKey" type="password" placeholder="tu-clave-secreta"
          style="width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #2a323d;background:#141a22;color:#e5e9ee;font-size:14px;margin-bottom:18px">
        <button id="fzSetupSave"
          style="width:100%;padding:13px;border:none;border-radius:10px;background:#3b82f6;color:#fff;font-weight:700;font-size:14px;cursor:pointer">
          Conectar
        </button>
        <p id="fzSetupError" style="color:#ef4444;font-size:12px;margin-top:12px;display:none"></p>
      </div>
    `;
    document.body.innerHTML = '';
    document.body.appendChild(overlay);

    document.getElementById('fzSetupSave').addEventListener('click', async () => {
      const url = document.getElementById('fzSetupUrl').value.trim();
      const key = document.getElementById('fzSetupKey').value.trim();
      const errEl = document.getElementById('fzSetupError');
      errEl.style.display = 'none';

      if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
        errEl.textContent = 'La URL debe ser del tipo https://script.google.com/macros/s/.../exec';
        errEl.style.display = 'block';
        return;
      }
      if (!key) {
        errEl.textContent = 'Falta la API key.';
        errEl.style.display = 'block';
        return;
      }

      // Verificar contra el backend antes de guardar.
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'api_status', api_key: key })
        });
        const data = await res.json();
        if (!data || data.ok !== true) throw new Error('Respuesta inesperada del servidor.');
      } catch (e) {
        errEl.textContent = 'No se pudo conectar: ' + (e.message || e);
        errEl.style.display = 'block';
        return;
      }

      saveConfig({ webAppUrl: url, apiKey: key });
      window.location.reload();
    });
  }
})();
