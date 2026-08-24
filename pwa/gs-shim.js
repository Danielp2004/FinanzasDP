/**
 * gs-shim.js — Polyfill de google.script.run para la PWA.
 *
 * app.html (código original de Apps Script) llama al backend así:
 *   google.script.run.withSuccessHandler(fn).withFailureHandler(fn).nombreFuncion(a, b, c)
 *
 * Fuera del iframe de Apps Script ese objeto no existe. Este shim lo
 * reproduce con la misma interfaz encadenada, pero por debajo hace un
 * fetch() POST al Web App (doPost), usando { action: 'nombreFuncion',
 * args: [a, b, c] }. El backend expone esas funciones vía RPC_WHITELIST_
 * (ver Código.js) o vía los "action" cortos ya existentes (get_data, etc.)
 * gracias a ACTION_ALIASES abajo.
 *
 * Requiere que window.FZ_CONFIG = { webAppUrl, apiKey } esté seteado
 * antes de cargar este script (ver config.js / pantalla de configuración).
 */
(function () {
  'use strict';

  // Algunas funciones antiguas del switch de doPost usan un "action" corto
  // distinto al nombre de función que llama app.html. Se traduce aquí para
  // no tener que duplicar handlers en el backend.
  const ACTION_ALIASES = {
    getDataAPI: 'get_data',
    // getDataAPILight NO se alias-ea: es una función propia (ver Código.js:843)
    // y ya está en RPC_WHITELIST_, así que pasa por el fallback genérico.
    guardarTransaccion: 'save_txn',
    acceptEmailQuick: 'accept_email',
    syncGmailLabel: 'sync_email',
    actualizarPreciosInversiones: 'actualizar_precios_inv',
    obtenerNoticiasInversion: 'noticias_inv',
    procesarExtractoPDF: 'procesar_pdf',
    getAlertasActivas: 'alertas',
    chatFinanciero: 'chat_ia',
    getTrucosFinancieros: 'trucos_ia',
    categorizarMovimientosSinCategoria: 'categorizar_ia',
    proyectarSaldoFinMes: 'proyeccion_mes',
    obtenerSaldosParaReconciliar: 'saldo_cuentas',
    reconciliarSaldosMes: 'reconciliar_saldos',
    getMetas: 'get_metas',
    guardarMeta: 'guardar_meta',
    aportarMeta: 'aportar_meta',
    eliminarMeta: 'eliminar_meta',
    getRecurrentes: 'get_recurrentes',
    guardarRecurrente: 'guardar_recurrente',
    marcarRecurrentePagado: 'marcar_pagado',
    eliminarRecurrente: 'eliminar_recurrente',
    getDeudas: 'get_deudas',
    guardarDeuda: 'guardar_deuda',
    pagarDeuda: 'pagar_deuda',
    eliminarDeuda: 'eliminar_deuda',
    getFinanzasCompletas: 'finanzas_completas'
  };

  function buildRunner() {
    let onSuccess = null;
    let onFailure = null;

    const runner = {
      withSuccessHandler(fn) { onSuccess = fn; return runner; },
      withFailureHandler(fn) { onFailure = fn; return runner; },
      withUserObject() { return runner; } // no-op, compat con la API real
    };

    return new Proxy(runner, {
      get(target, prop) {
        if (prop in target) return target[prop];
        // Cualquier otro nombre de propiedad se trata como la función a invocar.
        return function (...args) {
          callBackend(String(prop), args, onSuccess, onFailure);
          return runner;
        };
      }
    });
  }

  async function callBackend(fnName, args, onSuccess, onFailure) {
    const cfg = window.FZ_CONFIG || {};
    if (!cfg.webAppUrl) {
      const err = new Error('PWA sin configurar: falta la URL del Web App. Ve a Configuración.');
      if (onFailure) onFailure(err); else console.error(err);
      return;
    }

    const action = ACTION_ALIASES[fnName] || fnName;

    const payload = {
      action,
      args,
      api_key: cfg.apiKey || ''
    };
    // Compat: varias acciones legacy leen argumentos con nombre propio
    // (mes, logId, simbolo...) en vez de posicional. Se mandan también así
    // cuando aplica, usando convenciones ya usadas por el backend.
    applyLegacyArgShape_(action, args, payload);

    try {
      const res = await fetch(cfg.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.ok === false && data.error) {
        throw new Error(data.error);
      }
      if (onSuccess) onSuccess(data);
    } catch (err) {
      if (onFailure) onFailure(err instanceof Error ? err : new Error(String(err)));
      else console.error('[gs-shim]', fnName, err);
    }
  }

  // Mapea args posicionales a las propiedades con nombre que doPost ya
  // espera para las acciones legacy (ver switch en Código.js).
  function applyLegacyArgShape_(action, args, payload) {
    const shapes = {
      get_data: (a) => ({ mes: a[0] }),
      accept_email: (a) => ({ logId: a[0] }),
      noticias_inv: (a) => ({ simbolo: a[0] }),
      reconciliar_saldos: (a) => ({ ajustes: a[0] }),
      alertas: () => ({}),
      chat_ia: (a) => ({ pregunta: a[0], historial: a[1] }),
      aportar_meta: (a) => ({ meta_id: a[0], monto: a[1] }),
      eliminar_meta: (a) => ({ meta_id: a[0] }),
      marcar_pagado: (a) => ({ rec_id: a[0], crear_movimiento: a[1] }),
      eliminar_recurrente: (a) => ({ rec_id: a[0] }),
      pagar_deuda: (a) => ({ deuda_id: a[0], monto: a[1], crear_movimiento: a[2] }),
      eliminar_deuda: (a) => ({ deuda_id: a[0] }),
      save_txn: (a) => ({ data: a[0] }),
      guardar_meta: (a) => ({ data: a[0] }),
      guardar_recurrente: (a) => ({ data: a[0] }),
      guardar_deuda: (a) => ({ data: a[0] })
    };
    const shape = shapes[action];
    if (shape) Object.assign(payload, shape(args));
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', {
    configurable: true,
    get() { return buildRunner(); }
  });
})();
