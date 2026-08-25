// ═══════════════════════════════════════════════════════
// NOTICIAS Y EVENTOS DE INVERSIONES (Yahoo/Google News)
// ═══════════════════════════════════════════════════════
/**
 * Obtiene noticias relevantes para una acción o fondo usando Yahoo Finance News y Google News RSS.
 * @param {string} simbolo - Ticker (ej: AAPL, NYSEARCA:SPY) o nombre fondo
 * @returns {Array<{title:string,link:string,date:string}>}
 */
function obtenerNoticiasInversion(simbolo) {
  const noticias = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const apiKey = _aiApiKey_();
  let rawTextForAI = "";

  try {
    // Yahoo Finance News (no oficial, limitado)
    const urlYF = 'https://query1.finance.yahoo.com/v2/finance/news?symbols=' + encodeURIComponent(simbolo);
    const resYF = UrlFetchApp.fetch(urlYF, {muteHttpExceptions:true});
    const jsonYF = JSON.parse(resYF.getContentText());
    if (jsonYF?.content?.length) {
      jsonYF.content.slice(0,5).forEach(n => {
        rawTextForAI += `Título: ${n.title}. `;
        noticias.push({
          title: n.title,
          link: n.link,
          date: n.providerPublishTime ? new Date(n.providerPublishTime*1000).toISOString().slice(0,10) : ''
        });
      });
    }
  } catch(e) {}
  try {
    // Google News RSS (más genérico, sirve para fondos)
    const urlG = 'https://news.google.com/rss/search?q=' + encodeURIComponent(simbolo);
    const xml = UrlFetchApp.fetch(urlG, {muteHttpExceptions:true}).getContentText();
    const doc = XmlService.parse(xml);
    const items = doc.getRootElement().getChild('channel').getChildren('item');
    items.slice(0,5).forEach(item => {
      const t = item.getChildText('title');
      rawTextForAI += `Título: ${t}. `;
      noticias.push({
        title: t,
        link: item.getChildText('link'),
        date: item.getChildText('pubDate')
      });
    });
  } catch(e) {}

  // Análisis de Sentimiento con IA si hay noticias y API Key
  if (apiKey && rawTextForAI.length > 20) {
    try {
      const prompt = `Analiza el sentimiento de estas noticias financieras para el activo "${simbolo}" y dame un resumen ejecutivo de 2 frases indicando si la tendencia es alcista, bajista o neutral:\n${rawTextForAI}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 150 }
      };
      const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
      if (res.code === 200) {
        const aiAnalysis = res.text || "";
        if (aiAnalysis) {
          noticias.unshift({
            title: "🤖 ANÁLISIS IA: " + aiAnalysis.trim(),
            link: "#",
            date: new Date().toISOString().slice(0,10)
          });
        }
      }
    } catch(e) { Logger.log("Error en IA de noticias: " + e); }
  }

  return noticias;
}
// ═══════════════════════════════════════════════════════
// ACTUALIZAR PRECIOS DE INVERSIONES (Yahoo/Google Finance)
// ═══════════════════════════════════════════════════════
/**
 * Actualiza automáticamente los precios de acciones/ETFs usando Yahoo Finance o Google Finance.
 * Para CDTs/fondos, deja el precio manual.
 * Requiere que la hoja de Inversiones tenga las columnas: símbolo, tipo, precio_actual, actualizado_el
 * Yahoo Finance: https://query1.finance.yahoo.com/v7/finance/quote?symbols=SYM
 * Google Finance: solo vía fórmula en Sheets, no API pública
 */
function actualizarPreciosInversionesBasico_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!sh) throw new Error('Hoja Inversiones no existe');
  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);
  let actualizados = 0, manuales = 0, errores = 0;
  for (let r = 1; r < data.length; r++) {
    const tipo = String(data[r][hdr.tipo] || data[r][hdr.operacion] || '').toLowerCase();
    const simbolo = String(data[r][hdr.ticker] || data[r][hdr.simbolo] || data[r][hdr.s_mbolo] || '').trim();
    if (!simbolo || ['cdt','fondo','fondos','cdts','venta'].includes(tipo)) {
      manuales++;
      continue; // Manual para CDTs/fondos
    }
    try {
      // Yahoo Finance API pública (no oficial)
      const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(simbolo);
      const res = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
      const json = JSON.parse(res.getContentText());
      const price = json.quoteResponse?.result?.[0]?.regularMarketPrice;
      if (price && isFinite(price)) {
        sh.getRange(r+1, hdr.precio_actual+1).setValue(price);
        sh.getRange(r+1, hdr.actualizado_el+1).setValue(new Date());
        actualizados++;
      } else {
        errores++;
      }
    } catch(e) {
      errores++;
    }
  }
  return {ok:true, actualizados, manuales, errores};
}

/**
 * Permite actualizar manualmente el precio de un CDT o fondo.
 * @param {string} inversion_id
 * @param {number} nuevoPrecio
 */
function actualizarPrecioManualInversion(inversion_id, nuevoPrecio) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!sh) throw new Error('Hoja Inversiones no existe');
  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.inversion_id] || '') === String(inversion_id)) {
      sh.getRange(r+1, hdr.precio_actual+1).setValue(nuevoPrecio);
      sh.getRange(r+1, hdr.actualizado_el+1).setValue(new Date());
      return {ok:true};
    }
  }
  return {ok:false, error:'Inversión no encontrada'};
}

/**
 * Permite agregar o actualizar una nota/justificación a una inversión.
 * @param {string} inversion_id
 * @param {string} nota
 */
function actualizarNotaInversion(inversion_id, nota) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!sh) throw new Error('Hoja Inversiones no existe');
  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.inversion_id] || '') === String(inversion_id)) {
      sh.getRange(r+1, hdr.notas+1).setValue(nota);
      return {ok:true};
    }
  }
  return {ok:false, error:'Inversión no encontrada'};
}
/**
 * FINANZAS AI PRO — Code.gs
 * Backend principal · Google Apps Script
 * v2.0 — Arquitectura limpia, Gmail "gastos", KPIs mejorados
 */

// ═══════════════════════════════════════════════════════
// RPC WHITELIST — PWA (ver doPost)
// ═══════════════════════════════════════════════════════
// Funciones invocables desde el frontend vía action = nombre exacto.
// Cualquier función nueva que la UI necesite llamar debe agregarse aquí
// explícitamente; nunca se permite ejecutar una función arbitraria.
const RPC_WHITELIST_ = [
  'actualizarEstadoHistorialUI','actualizarFX','actualizarPrecioManualInversion',
  'aprobarEmail','cargarDatosDeEjemplo','cargarReviewExtractoUI','categorizarMovimientosUI',
  'clearAndGetDataAPI','diagnosticarDatos','editarMovimiento','eliminarCategoria',
  'eliminarCorreoGasto','eliminarHistorialExtractoUI','eliminarInversionEs','eliminarTransaccion',
  'exportCSV','getAlertasActivasUI','getConfigData','getDataAPILight','getEmailLogs',
  'getGeminiKeyStatus','getHistorialExtractosUI','getPrecioAutoMode','getTrucosFinancierosUI',
  'guardarCategoria','guardarConfiguracion','guardarCorreoEditado','guardarCuenta',
  'guardarGeminiApiKey','guardarInversionEs','guardarPresupuestosLote','guardarTransaccionesBatchUI',
  'limpiarDuplicadosHistorialUI','marcarMovimientoConciliadoUI','marcarMovimientosBatchUI',
  'probarClaveIA','procesarPDFUI','proyectarSaldoUI','recalcularSaldos','setPrecioAutoMode'
];

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN GLOBAL
// ═══════════════════════════════════════════════════════
const CFG = {
  TZ: Session.getScriptTimeZone(),
  GMAIL_LABEL: 'gastos',
  CACHE_TTL: 600,
  AUTO_APPROVE_THRESHOLD: 0.88,  // Confianza mínima para auto-aprobación
  DEFAULT_ACCOUNT: 'Bancolombia Ahorro',
  APP_NAME: 'Finanzas AI Pro',
  SHEETS: {
    MOV:        'Movimientos',
    CUENTAS:    'Cuentas',
    CATEGORIAS: 'Categorias',
    PRESUPUESTO:'Presupuesto',
    INVERSIONES:'Inversiones',
    TIPOS_CAMBIO:'TiposCambio',
    CORREOS:    'Correos',
    CONFIG:     'Config',
    METAS:      'Metas',
    RECURRENTES:'Recurrentes',
    DEUDAS:     'Deudas'
  }
};

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN — Ejecutar UNA vez manualmente
// ═══════════════════════════════════════════════════════
/**
 * Inicializa la app con una sola estructura (todo en español).
 * - Crea/asegura solo las hojas necesarias.
 * - No crea hojas en inglés.
 * - Opcional: carga movimientos de prueba para ver la Web App con datos.
 */
function inicializarProyecto(opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};

  const sheet = (name, headers, seed = []) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);

    const lastCol = Math.max(1, sh.getLastColumn());
    const row1 = sh.getRange(1, 1, 1, lastCol).getValues()[0] || [];
    const existing = row1.map(v => String(v || '').trim()).filter(Boolean);

    if (!existing.length) {
      sh.getRange(1, 1, 1, headers.length)
        .setValues([headers]).setFontWeight('bold')
        .setBackground('#1e293b').setFontColor('#f8fafc')
        .setFontSize(10);
      sh.setFrozenRows(1);
      if (seed.length) sh.getRange(2, 1, seed.length, headers.length).setValues(seed);
    } else {
      // asegurar headers faltantes sin reordenar
      const set = new Set(existing);
      let col = existing.length + 1;
      headers.forEach(h => {
        if (!set.has(h)) {
          sh.getRange(1, col).setValue(h).setFontWeight('bold');
          col++;
        }
      });
      sh.setFrozenRows(1);
    }
    return sh;
  };

  sheet(CFG.SHEETS.CONFIG, ['clave', 'valor', 'descripción'], [
    ['moneda_base',            'COP',    'Moneda base'],
    ['proveedor_ia',           'gemini', 'gemini | reglas'],
    ['umbral_auto_aprobacion', '0.88',   'Confianza mínima para auto-aprobar'],
    ['etiqueta_gmail',         'gastos', 'Etiqueta Gmail a sincronizar'],
    ['salario_mensual',        '0',      'Ingreso mensual base para métricas'],
    ['usuario_por_defecto',    'yo',     'Usuario por defecto']
  ]);

  sheet(CFG.SHEETS.CUENTAS, ['cuenta_id','nombre','tipo','institución','moneda','saldo','activa'], [
    ['CTA_01','Efectivo','efectivo','', 'COP', 0, true],
    ['CTA_02','Bancolombia Ahorro','ahorro','Bancolombia','COP', 0, true],
    ['CTA_03','Broker / Inversiones','broker','', 'COP', 0, true]
  ]);

  sheet(CFG.SHEETS.CATEGORIAS, ['categoria_id','nombre','grupo','icono','color','keywords'], [
    ['CAT_01','Alimentos','gasto','🍔','#ef4444','supermercado,comida,restaurante,mercado'],
    ['CAT_02','Transporte','gasto','🚗','#f59e0b','uber,taxi,gasolina'],
    ['CAT_03','Servicios','gasto','📱','#3b82f6','luz,agua,internet,celular,netflix'],
    ['CAT_04','Ingresos','ingreso','💰','#22c55e','nomina,salario,abono'],
    ['CAT_05','Transferencia','transferencia','↔️','#64748b','transferencia,traslado'],
    ['CAT_06','Aporte a inversiones','transferencia','📈','#a78bfa','aporte,inversion,inversiones']
  ]);

  sheet(CFG.SHEETS.MOV, [
    'mov_id','fecha','descripción','grupo','categoría',
    'monto','moneda','cuenta_origen','cuenta_destino',
    'activo_inversión','fuente','referencia','notas','creado_el'
  ]);

  sheet(CFG.SHEETS.PRESUPUESTO, ['presupuesto_id','categoría','periodo','límite','alerta_pct','activo']);

  sheet(CFG.SHEETS.INVERSIONES, [
    'inversion_id','fecha_compra','cuenta','broker','operacion',
    'ticker','activo','cantidad','precio_compra','moneda_compra',
    'trm_compra','vr_mercado_compra','fuente_precio','precio_actual',
    'moneda_actual','trm_actual','precio_actual_base','vr_mercado_actual',
    'pyg_base','pyg_pct','actualizado_el','notas'
  ], [
    ['INV_01','2026-01-01','Nu','Trii','Compra','NASDAQ:VOO','ETF S&P 500',1,450.00,'USD',4000,400000,'GOOGLEFINANCE',450.00,'USD',4000,450.00,450000,0,0,'','ETF diversificado']
  ]);

  sheet(CFG.SHEETS.TIPOS_CAMBIO, ['base','objetivo','tasa','fecha','fuente']);

  sheet(CFG.SHEETS.CORREOS, [
    'log_id','msg_id','remitente','asunto','recibido_el',
    'procesado_el','estado','monto','moneda','comercio',
    'categoria_ia','confianza_ia','categoria_usuario','cuenta_sugerida','observación',
    'mov_id','snippet'
  ]);

  // ── Metas de ahorro ──────────────────────────────────────────────────────
  sheet(CFG.SHEETS.METAS, [
    'meta_id','nombre','descripcion','monto_objetivo','monto_actual',
    'fecha_inicio','fecha_objetivo','categoria_exclusion','activa','creado_el'
  ]);

  // ── Gastos recurrentes ───────────────────────────────────────────────────
  sheet(CFG.SHEETS.RECURRENTES, [
    'rec_id','nombre','monto','tipo','categoria','cuenta',
    'dia_del_mes','activo','ultima_vez','alerta_dias_antes','notas','creado_el'
  ]);

  // ── Deudas y cuotas ──────────────────────────────────────────────────────
  sheet(CFG.SHEETS.DEUDAS, [
    'deuda_id','nombre','tipo','entidad','saldo_inicial','saldo_actual',
    'tasa_mensual','cuota_mensual','fecha_inicio','fecha_fin',
    'dia_corte','dia_pago','cuenta_pago','activa','notas','creado_el'
  ]);

  if (opts.conEjemplos) cargarDatosDemo_();

  Logger.log('✅ Estructura inicializada correctamente');
  return '✅ Listo. Revisa las hojas creadas.';
}

// ═══════════════════════════════════════════════════════
// WEB APP ENTRY POINTS
// ═══════════════════════════════════════════════════════
function doGet(e) {
  // ?setup_key=1 → genera SHORTCUTS_API_KEY una sola vez (si no existe ya)
  // y la muestra en pantalla. Sólo funciona mientras la clave no exista;
  // una vez creada, esta ruta deja de servir para nada (no es puerta trasera).
  if (e && e.parameter && e.parameter.setup_key === '1') {
    const r = generarApiKeySiNoExiste_();
    const msg = r.created
      ? `Clave generada:<br><b style="font-size:18px;user-select:all">${r.key}</b><br><br>Cópiala y pégala en la configuración de la PWA. Esta página deja de mostrarla después de refrescar.`
      : `Ya existía una clave configurada. Por seguridad esta ruta no la muestra de nuevo; revísala en Propiedades del script.`;
    return HtmlService.createHtmlOutput(
      `<div style="font-family:sans-serif;padding:24px;max-width:480px">${msg}</div>`
    );
  }
  // ?diag=1  → página de diagnóstico mínima (sin Chart.js, sin app.html)
  if (e && e.parameter && e.parameter.diag === '1') {
    return HtmlService.createHtmlOutputFromFile('Diag')
      .setTitle('Diagnóstico')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  }
  // ?install=1  → landing de onboarding para nuevos usuarios
  if (e && e.parameter && e.parameter.install === '1') {
    return HtmlService.createTemplateFromFile('Onboarding')
      .evaluate()
      .setTitle('Instalar Finanzas AI Pro')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Finanzas AI Pro')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doPost(e) {
  try {
    const body   = parseApiRequestBody_(e);
    const action = String(e.parameter?.action || body.action || '').trim();
    if (!action) return jsonOut_({ ok: false, error: 'Accion requerida' });
    assertAuthorizedApiRequest_(action, body, e);

    // ── Autenticación por API key (opcional) ──────────────
    // Guarda la clave en Propiedades del script: SHORTCUTS_API_KEY
    // Si no está configurada, cualquier request pasa (dev mode).
    const apiKey = PropertiesService.getScriptProperties().getProperty('SHORTCUTS_API_KEY');
    if (apiKey) {
      const provided = String(body.api_key || e.parameter?.api_key || '').trim();
      if (provided !== apiKey) {
        return jsonOut_({ ok: false, error: '🔐 API key inválida. Revisa tu atajo de iPhone.' });
      }
    }

    const handlers = {
      api_status:   () => getApiStatus_(),
      // ── Compatibilidad anterior ──
      sync_email:   () => syncGmailLabel_(CFG.GMAIL_LABEL),
      save_txn:     () => guardarTransaccion(body.data || body),
      get_data:     () => getDataAPI(body.mes),
      accept_email: () => acceptEmailQuick(body.logId),

      // ── Atajos iPhone: registro rápido ──
      quick_gasto:  () => shortcutQuickTxn_(body, 'gasto'),
      quick_ingreso:() => shortcutQuickTxn_(body, 'ingreso'),
      nueva_txn:    () => shortcutQuickTxn_(body, body.tipo || 'gasto'),
      crear_movimiento: () => guardarTransaccion(body.data || body),

      // ── Atajos iPhone: consultas ──
      saldo:        () => shortcutSaldo_(),
      resumen_mes:  () => shortcutResumenMes_(body.mes),
      resumen_dia:  () => shortcutResumenDia_(),
      presupuesto:  () => shortcutPresupuesto_(),
      listar_cuentas: () => listarCuentasAPI_(),

      // ── Inversiones ──
      actualizar_precios_inv: () => actualizarPreciosInversiones(),
      noticias_inv:           () => obtenerNoticiasInversion(body.simbolo || ''),

      // ── PDF & Conciliación ──
      procesar_pdf:           () => procesarExtractoPDF(body),
      alertas:                () => getAlertasActivas(),
      chat_ia:                () => chatFinanciero(body.pregunta || '', body.historial || []),
      trucos_ia:              () => getTrucosFinancieros(),
      categorizar_ia:         () => categorizarMovimientosSinCategoria(),
      proyeccion_mes:         () => proyectarSaldoFinMes(),

      // ── Reconciliación de saldos ──
      saldo_cuentas:          () => obtenerSaldosParaReconciliar(),
      reconciliar_saldos:     () => reconciliarSaldosMes(body.ajustes || []),
      auditar_extracto:       () => auditarExtractoBancario_(body),
      importar_extracto:      () => importarExtractoBancario_(body),

      // ── Metas de ahorro ──
      get_metas:              () => getMetas(),
      guardar_meta:           () => guardarMeta(body.data || body),
      aportar_meta:           () => aportarMeta(body.meta_id, body.monto),
      eliminar_meta:          () => eliminarMeta(body.meta_id),

      // ── Gastos recurrentes ──
      get_recurrentes:        () => getRecurrentes(),
      guardar_recurrente:     () => guardarRecurrente(body.data || body),
      marcar_pagado:          () => marcarRecurrentePagado(body.rec_id, body.crear_movimiento),
      eliminar_recurrente:    () => eliminarRecurrente(body.rec_id),

      // ── Deudas ──
      get_deudas:             () => getDeudas(),
      guardar_deuda:          () => guardarDeuda(body.data || body),
      pagar_deuda:            () => pagarDeuda(body.deuda_id, body.monto, body.crear_movimiento),
      eliminar_deuda:         () => eliminarDeuda(body.deuda_id),

      // ── Finanzas completas ──
      finanzas_completas:     () => getFinanzasCompletas()
    };

    let fn = handlers[action];

    // ── Fallback genérico (PWA) ─────────────────────────────────────
    // El shim google.script.run del frontend manda action = nombre exacto
    // de la función (p.ej. "getConfigData", "guardarCuenta") y body.args
    // como el array de argumentos posicionales tal cual los pasaba la UI.
    // Sólo se permiten funciones ya expuestas a la UI (sufijo *UI o en
    // esta lista blanca), nunca cualquier función global del proyecto.
    if (!fn && RPC_WHITELIST_.includes(action) && typeof globalThis[action] === 'function') {
      fn = () => globalThis[action].apply(null, Array.isArray(body.args) ? body.args : []);
    }

    const result = fn ? fn() : { ok: false, error: `Acción desconocida: "${action}"` };
    return jsonOut_(result);

  } catch(err) {
    Logger.log('doPost error: ' + err + '\n' + (err.stack || ''));
    return jsonOut_({ ok: false, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════
// API PRINCIPAL — getDataAPI
// ═══════════════════════════════════════════════════════
function clearAndGetDataAPI(mesFiltro) {
  try { clearCacheForMonth(); } catch(e) { Logger.log('clearAndGetDataAPI/clear: ' + e); }
  try {
    return getDataAPI(mesFiltro);
  } catch(e) {
    Logger.log('❌ clearAndGetDataAPI: ' + e + '\n' + (e.stack || ''));
    return { error: 'Error al cargar datos: ' + (e.message || e), mes: mesFiltro || '', kpis: {} };
  }
}

function getDataAPI(mesFiltro) {
  const tz  = CFG.TZ;
  const hoy = new Date();
  const mes = mesFiltro || fmtDate_(hoy, 'yyyy-MM');

  // Lectura de caché protegida (antes estaba fuera del try → un error aquí
  // hacía que la función lanzara y el frontend recibiera null → "servidor no
  // devolvió datos").
  try {
    const cacheKey0 = `data_v2_${_cacheVersion_()}_${mes}`;
    const cached = CacheService.getScriptCache().get(cacheKey0);
    if (cached) return JSON.parse(cached);
  } catch(e) {
    Logger.log('getDataAPI cache read: ' + e);
  }

  const cacheKey = `data_v2_${_cacheVersion_()}_${mes}`;
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const shMov = ss.getSheetByName(CFG.SHEETS.MOV);
    const shCtas= ss.getSheetByName(CFG.SHEETS.CUENTAS);
    const shCat = ss.getSheetByName(CFG.SHEETS.CATEGORIAS);
    const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
    const shInv = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
    const shCor = ss.getSheetByName(CFG.SHEETS.CORREOS);

    const baseCur = String(getSettingEs_(shCfg, 'moneda_base', 'COP') || 'COP');
    const accountSync = syncAccountBalances_(ss, mes);

    // Leer movimientos (español) y normalizar a estructura interna para reutilizar gráficos
    const movsRaw = readSheet_(shMov);
    // Debug: mostrar las primeras 3 filas raw para diagnóstico
    if (movsRaw.length > 0) {
      const sample = movsRaw.slice(0,3);
      Logger.log('[RAW COLS] keys=' + JSON.stringify(Object.keys(sample[0])));
      Logger.log('[RAW SAMPLE] ' + JSON.stringify(sample.map(r => ({ grupo: r.grupo, tipo: r.tipo, categoria: r.categoría || r.categoria, monto: r.monto }))));
    }
    const txns = movsRaw.map(m => {
      const fecha = parseSheetDate_(m.fecha);
      const rawGroup = normalizeType_(m.grupo || m.tipo || m.type || '');
      const category = String(m.categoría || m.categoria || m.category || 'Otros').trim();
      const accountDest = String(m.cuenta_destino || '').trim();
      const asset = String(m.activo_inversion || m['activo_inversión'] || m.activoInversion || m.activo || '').trim();
      const isInvestment = category.toLowerCase().includes('inversion') || accountDest.toLowerCase().includes('broker') || asset !== '';
      const monto = parseNum_(m.monto || m.amount || m.valor || 0);
      // Si el tipo no pudo reconocerse, inferir desde categoría y monto
      const knownTypes = ['income','expense','transfer','investment'];
      let resolvedType = rawGroup;
      if (!knownTypes.includes(resolvedType)) {
        const catLower = category.toLowerCase();
        if (['ingresos','ingreso','nómina','nomina','salario'].some(k => catLower.includes(k))) resolvedType = 'income';
        else if (['transferencia','traslado','nequi','daviplata'].some(k => catLower.includes(k))) resolvedType = 'transfer';
        else resolvedType = monto >= 0 ? 'income' : 'expense';
      }
      return {
        txn_id: m.mov_id,
        date: fecha,
        type: isInvestment ? 'investment' : resolvedType,
        category: category,
        description: String(m.descripción || m.descripcion || '').trim(),
        account: String(m.cuenta_origen || m.cuenta || '').trim(),
        account_destino: accountDest,
        source: String(m.fuente || 'manual'),
        status: 'confirmed',
        currency: String(m.moneda || baseCur),
        amount_base: Math.abs(monto),
        referencia: String(m.referencia || ''),
        notas: String(m.notas || '')
      };
    });

    const mesTxn = txns.filter(r => r.date instanceof Date && fmtDate_(r.date, 'yyyy-MM') === mes);

    // KPIs del mes — expense incluye inversiones (ambos son salidas de dinero)
    const income = mesTxn.filter(r => normalizeType_(r.type) === 'income')
                         .reduce((s, r) => s + parseNum_(r.amount_base), 0);
    const expenseOnly = mesTxn.filter(r => normalizeType_(r.type) === 'expense')
                              .reduce((s, r) => s + parseNum_(r.amount_base), 0);
    const investments = mesTxn.filter(r => normalizeType_(r.type) === 'investment')
                              .reduce((s, r) => s + parseNum_(r.amount_base), 0);
    const expense = expenseOnly + investments;
    const transfers = mesTxn.filter(r => normalizeType_(r.type) === 'transfer')
                            .reduce((s, r) => s + parseNum_(r.amount_base), 0);

    // Por categoría (gastos + inversiones — ambos son salida de dinero)
    const byCat  = {};
    const expTxns = mesTxn.filter(r => ['expense','investment'].includes(normalizeType_(r.type)));
    expTxns.forEach(r => {
      const t = normalizeType_(r.type);
      // Las inversiones se agrupan bajo su categoría real (ej: "Inversiones") o la que traigan
      const c = t === 'investment'
        ? (String(r.category || '').trim() || 'Inversiones')
        : String(r.category || 'Otros').trim();
      byCat[c] = (byCat[c] || 0) + parseNum_(r.amount_base);
    });
    // Debug info para diagnóstico
    const _debug = {
      mesTxnCount: mesTxn.length,
      expenseCount: expTxns.length,
      byCatKeys: Object.keys(byCat),
      sampleTypes: mesTxn.slice(0,8).map(r => ({ type: r.type, cat: r.category, amt: r.amount_base })),
      rawCols: movsRaw.length > 0 ? Object.keys(movsRaw[0]) : [],
      rawSample: movsRaw.slice(0,3).map(r => ({ grupo: r.grupo, tipo: r.tipo, cat: r.categoría || r.categoria, monto: r.monto }))
    };

    // Cuentas (español)
    const cuentas = readSheet_(shCtas);
    const accountMonthMap = accountSync.byAccountMonth || {};
    const balancesCalc = accountSync.balances || {};
    const acSaldos = cuentas.filter(r => r.activa !== false && String(r.activa) !== 'false')
      .map(r => {
        const name = String(r.nombre || '').trim();
        const monthStats = accountMonthMap[name] || {};
        // Usar el saldo CALCULADO en memoria (no el de la hoja, que ya no se
        // reescribe en cada carga). Si por algo no está, caer al saldo de la hoja.
        const bal = balancesCalc[name] != null ? balancesCalc[name] : parseNum_(r.saldo);
        return {
          name,
          bal: bal,
          type: r.tipo,
          initial: parseNum_(r.saldo_inicial),
          deltaMes: monthStats.net || 0,
          ingresosMes: monthStats.income || 0,
          gastosMes: monthStats.expense || 0,
          transferenciasMes: monthStats.transfer || 0
        };
      });
    const efectivo = acSaldos.reduce((s, a) => s + a.bal, 0);

    // Inversiones
    const invData  = buildInvEs_(shInv);

    // Historial (últimos 150 ordenados desc)
    const historial = txns
      .filter(r => r.date instanceof Date)
      .sort((a, b) => b.date - a.date)
      .slice(0, 150)
      .map(r => ({
        id:     r.txn_id,
        fecha:  fmtDate_(r.date, 'dd/MM/yyyy'),
        mes:    fmtDate_(r.date, 'yyyy-MM'),
        type:   normalizeType_(r.type),
        cat:    String(r.category || 'Otros'),
        desc:   String(r.description || ''),
        monto:  parseNum_(r.amount_base),
        moneda: String(r.currency || baseCur),
        cuenta: String(r.account || ''),
        cuentaDestino: String(r.cuenta_destino || r.account_destino || ''),
        source: String(r.source || 'manual'),
        status: String(r.status || 'confirmed'),
        notas: String(r.notas || ''),
        referencia: String(r.referencia || '')
      }));

    // Series y resúmenes
    const series   = buildSeries_(txns, mes, tz);
    const summary  = buildPeriodSummaries_(txns, mes, tz);

    // Presupuesto
    const budget   = buildBudget_(ss, mes, txns, tz);

    // Correos pendientes
    const emailPending = shCor ? readSheet_(shCor).filter(r => String(r.estado) === 'pendiente').length : 0;

    // Top gastos
    const topGastos = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, val]) => ({ cat, val }));

    // Combos
    const cats = readSheet_(shCat).map(r => ({
      id: r.categoria_id,
      name: r.nombre,
      type: r.grupo,
      icon: r.icono
    }));

    const health = typeof calcHealthScore_ === 'function'
      ? calcHealthScore_(income, expense, income - expense, mesTxn.length)
      : { score: 0, tips: [] };
    const budgetUsagePct = budget.totalPlan > 0 ? (budget.totalReal / budget.totalPlan) * 100 : 0;
    const runwayMonths = expense > 0 ? (efectivo / expense) : null;
    const setupChecks = [
      { key: 'accounts',  ready: acSaldos.length > 0, label: 'Cuentas conectadas' },
      { key: 'categories',ready: cats.length > 0, label: 'Categorías base' },
      { key: 'txns',      ready: txns.length > 0, label: 'Movimientos cargados' },
      { key: 'budgets',   ready: (budget.items || []).length > 0, label: 'Presupuesto activo' },
      { key: 'emails',    ready: !!String(getSettingEs_(shCfg, 'etiqueta_gmail', '')).trim(), label: 'Inbox automatizado' },
      { key: 'investments', ready: invData.detalle.length > 0, label: 'Portafolio configurado' }
    ];
    const setupProgress = Math.round(setupChecks.filter(x => x.ready).length / setupChecks.length * 100);
    const alerts = [];
    if (emailPending > 0) alerts.push({ level: 'warning', text: `${emailPending} correos pendientes por revisar` });
    if (budget.totalPlan > 0 && budgetUsagePct >= 100) alerts.push({ level: 'danger', text: 'Tu presupuesto mensual ya superó el 100%' });
    else if (budget.totalPlan > 0 && budgetUsagePct >= 85) alerts.push({ level: 'warning', text: 'Tu presupuesto mensual está cerca del límite' });
    if (expense > income && income > 0) alerts.push({ level: 'danger', text: 'Tus gastos del mes están por encima de tus ingresos' });
    if (!alerts.length) alerts.push({ level: 'success', text: 'Sin alertas críticas en este corte' });

    // ====== IA Insights Dashboard ======
    let insightsAI = [];
    try {
      // Comparar gastos por categoría con el mes anterior
      const prevMes = (() => {
        const [y, m] = mes.split('-').map(Number);
        let pm = m - 1, py = y;
        if (pm < 1) { pm = 12; py--; }
        return `${py}-${String(pm).padStart(2, '0')}`;
      })();
      const prevCache = CacheService.getScriptCache().get(`data_v2_${_cacheVersion_()}_${prevMes}`);
      const prevData = prevCache ? JSON.parse(prevCache) : null;
      if (prevData && prevData.byCat) {
        Object.entries(byCat).forEach(([cat, val]) => {
          const prevVal = prevData.byCat[cat] || 0;
          if (val > prevVal * 1.2 && val > 50000) {
            insightsAI.push(`Este mes gastaste más en "${cat}" (+${Math.round((val-prevVal)/prevVal*100)}% respecto al mes pasado).`);
          }
        });
      }
      // Mayor gasto del mes
      if (topGastos.length > 0) {
        const top = topGastos[0];
        insightsAI.push(`Tu mayor gasto fue en "${top.cat}" (${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(top.val)}).`);
      }
      // Ahorro negativo
      if (income > 0 && (income - expense) < 0) {
        insightsAI.push('¡Atención! Gastaste más de lo que ingresaste este mes.');
      }
      // Presupuesto excedido
      if (budget.totalPlan > 0 && budgetUsagePct > 100) {
        insightsAI.push('Superaste tu presupuesto mensual. Revisa tus gastos.');
      }
      // Pocos movimientos
      if (mesTxn.length < 5) {
        insightsAI.push('Este mes tienes pocos movimientos registrados.');
      }
      // Sin datos críticos
      if (insightsAI.length === 0) insightsAI.push('Sin alertas ni cambios inusuales este mes.');
    } catch(e) {
      insightsAI = ['No se pudieron generar insights de IA.'];
    }

    // Meses que tienen movimientos (para avisar si el mes filtrado está vacío
    // pero hay datos en otros meses, y ofrecer saltar al más reciente).
    const mesesConDatos = {};
    txns.forEach(r => {
      if (r.date instanceof Date && !isNaN(r.date)) {
        const k = fmtDate_(r.date, 'yyyy-MM');
        mesesConDatos[k] = (mesesConDatos[k] || 0) + 1;
      }
    });

    const resp = {
      mes,
      kpis: {
        income, expense, transfers,
        savings:    income - expense,
        burnRate:   income > 0 ? expense / income * 100 : 0,
        totalNeto:  efectivo + invData.totalMercado,
        efectivo,
        inversiones: invData.totalMercado,
        txnCount:   mesTxn.length
      },
      mesesConDatos,
      byCat,
      topGastos,
      historial,
      series,
      summary,
      budget,
      accounts:      acSaldos,
      inversiones:   invData.detalle,
      invPorTipo:    invData.porTipo,
      invPorBroker:  invData.porBroker,
      combos: {
        cuentas:     acSaldos.map(a => a.name),
        categorias:  cats.map(c => `${c.icon || ''} ${c.name}`.trim()),
        categoriasRaw: cats
      },
      emailPending,
      saas: {
        healthScore: health.score || 0,
        healthTips: health.tips || [],
        healthLabel: (health.score || 0) >= 80 ? 'Saludable' : (health.score || 0) >= 60 ? 'Estable' : 'En riesgo',
        budgetUsagePct,
        runwayMonths,
        setupProgress,
        setupItems: setupChecks,
        alerts
      },
      meta: { baseCur, generatedAt: new Date().toISOString() },
      insightsAI
      // _debug se omite del payload de producción: es pesado y hacía que la
      // respuesta superara el límite de caché (90KB) → nunca se cacheaba → lento.
    };

    // CRÍTICO: google.script.run devuelve null al cliente si el objeto contiene
    // valores no serializables (NaN, Infinity, undefined, Date crudo, funciones).
    // Eso provocaba "Sin datos del servidor" pese a que getDataAPI sí calculaba
    // bien (se veía en el editor). Saneamos SIEMPRE antes de devolver/cachear.
    const safe = _sanitizeForClient_(resp);
    _cachePutSafe_(cacheKey, safe, CFG.CACHE_TTL);
    return safe;

  } catch(err) {
    Logger.log('❌ getDataAPI: ' + err + '\n' + err.stack);
    return { error: 'getDataAPI: ' + (err.message || err), mes: mes, kpis: {} };
  }
}

/**
 * Convierte un objeto en 100% serializable por google.script.run:
 * - NaN / Infinity / -Infinity  → 0
 * - undefined                   → null
 * - Date                        → ISO string
 * - funciones                   → se omiten
 * Recorre recursivamente objetos y arrays. Protege contra ciclos por profundidad.
 */
function _sanitizeForClient_(value, depth) {
  depth = depth || 0;
  if (depth > 12) return null; // corta estructuras demasiado profundas/circulares
  if (value === undefined) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') return isFinite(value) ? value : 0;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'function') return undefined; // se descarta al reconstruir
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(function (v) { return _sanitizeForClient_(v, depth + 1); });
  }
  if (t === 'object') {
    const out = {};
    for (const k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      const clean = _sanitizeForClient_(value[k], depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return null;
}

/**
 * Guarda en caché sólo si cabe en el límite de 100KB por clave de Apps Script.
 * Si el payload es más grande, NO cachea (mejor recalcular que fallar en
 * silencio, que era la causa de "a veces cargan los datos y a veces no").
 */
function _cachePutSafe_(key, obj, ttl) {
  try {
    const str = JSON.stringify(obj);
    // El límite de Apps Script es 100KB por clave, medido en BYTES (no chars).
    // El español tiene acentos/emojis que ocupan >1 byte, así que medimos bytes
    // reales y dejamos margen (90KB) para no guardar nunca un valor corrupto,
    // que era la causa de "recargo dos veces y se va a $0".
    const bytes = Utilities.newBlob(str).getBytes().length;
    if (bytes > 90000) {
      Logger.log('⚠️ Cache OMITIDO (' + bytes + ' bytes > 90KB): ' + key + ' — se recalculará cada vez (correcto pero más lento).');
      return false;
    }
    CacheService.getScriptCache().put(key, str, ttl || CFG.CACHE_TTL);
    return true;
  } catch(e) {
    Logger.log('Error _cachePutSafe_ (' + key + '): ' + e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// API LIGERA — solo KPIs + historial reciente (sin series ni inversiones)
// Usada para refrescos rápidos después de guardar/editar movimientos
// ═══════════════════════════════════════════════════════
function getDataAPILight(mesFiltro) {
  const tz  = CFG.TZ;
  const hoy = new Date();
  const mes = mesFiltro || fmtDate_(hoy, 'yyyy-MM');

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const shMov = ss.getSheetByName(CFG.SHEETS.MOV);
    const shCtas= ss.getSheetByName(CFG.SHEETS.CUENTAS);
    const shCat = ss.getSheetByName(CFG.SHEETS.CATEGORIAS);
    const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
    const shCor = ss.getSheetByName(CFG.SHEETS.CORREOS);

    const baseCur = String(getSettingEs_(shCfg, 'moneda_base', 'COP') || 'COP');
    const movsRaw = shMov ? readSheet_(shMov) : [];

    const txns = movsRaw.map(m => {
      const fecha = parseSheetDate_(m.fecha);
      const rawGroup = normalizeType_(m.grupo || m.tipo || m.type || '');
      const category = String(m.categoría || m.categoria || m.category || 'Otros').trim();
      const monto = parseNum_(m.monto || m.amount || m.valor || 0);
      const knownTypesL = ['income','expense','transfer','investment'];
      let resolvedTypeL = rawGroup;
      if (!knownTypesL.includes(resolvedTypeL)) {
        const catLow = category.toLowerCase();
        if (['ingresos','ingreso','nómina','nomina','salario'].some(k => catLow.includes(k))) resolvedTypeL = 'income';
        else if (['transferencia','traslado','nequi','daviplata'].some(k => catLow.includes(k))) resolvedTypeL = 'transfer';
        else resolvedTypeL = monto >= 0 ? 'income' : 'expense';
      }
      return {
        date: fecha,
        type: resolvedTypeL,
        category,
        amount_base: Math.abs(monto),
        currency: String(m.moneda || baseCur),
        description: String(m.descripción || m.descripcion || '').trim(),
        account: String(m.cuenta_origen || m.cuenta || '').trim(),
        notas: String(m.notas || ''),
        referencia: String(m.referencia || ''),
        txn_id: m.mov_id,
        source: String(m.fuente || 'manual'),
        cuenta_destino: String(m.cuenta_destino || '')
      };
    });

    const mesTxn = txns.filter(r => r.date instanceof Date && fmtDate_(r.date, 'yyyy-MM') === mes);
    const income  = mesTxn.filter(r => normalizeType_(r.type) === 'income').reduce((s, r) => s + r.amount_base, 0);
    const expenseOnly = mesTxn.filter(r => normalizeType_(r.type) === 'expense').reduce((s, r) => s + r.amount_base, 0);
    const investments = mesTxn.filter(r => normalizeType_(r.type) === 'investment').reduce((s, r) => s + r.amount_base, 0);
    const expense = expenseOnly + investments;

    const byCat = {};
    mesTxn.filter(r => ['expense','investment'].includes(normalizeType_(r.type))).forEach(r => {
      const t = normalizeType_(r.type);
      const c = t === 'investment' ? (String(r.category || '').trim() || 'Inversiones') : r.category;
      byCat[c] = (byCat[c] || 0) + r.amount_base;
    });

    const cuentas = shCtas ? readSheet_(shCtas).filter(r => r.activa !== false && String(r.activa) !== 'false') : [];
    const efectivo = cuentas.reduce((s, r) => s + parseNum_(r.saldo), 0);
    const acSaldos = cuentas.map(r => ({
      name: String(r.nombre || '').trim(),
      bal: parseNum_(r.saldo),
      type: r.tipo
    }));

    const emailPending = shCor ? readSheet_(shCor).filter(r => String(r.estado) === 'pendiente').length : 0;

    const historial = txns
      .filter(r => r.date instanceof Date)
      .sort((a, b) => b.date - a.date)
      .slice(0, 150)
      .map(r => ({
        id: r.txn_id,
        fecha: fmtDate_(r.date, 'dd/MM/yyyy'),
        mes: fmtDate_(r.date, 'yyyy-MM'),
        type: normalizeType_(r.type),
        cat: r.category,
        desc: r.description,
        monto: r.amount_base,
        moneda: r.currency,
        cuenta: r.account,
        cuentaDestino: r.cuenta_destino,
        source: r.source,
        status: 'confirmed',
        notas: r.notas,
        referencia: r.referencia
      }));

    const cats = shCat ? readSheet_(shCat).map(r => ({
      id: r.categoria_id, name: r.nombre, type: r.grupo, icon: r.icono
    })) : [];

    const budget = buildBudget_(ss, mes, txns, tz);

    return _sanitizeForClient_({
      __light: true,
      mes,
      kpis: {
        income, expense,
        savings: income - expense,
        burnRate: income > 0 ? expense / income * 100 : 0,
        totalNeto: efectivo,
        efectivo,
        inversiones: 0,
        txnCount: mesTxn.length
      },
      byCat,
      topGastos: Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([cat,val])=>({cat,val})),
      historial,
      budget,
      accounts: acSaldos,
      inversiones: [],
      combos: {
        cuentas: acSaldos.map(a => a.name),
        categorias: cats.map(c => `${c.icon||''} ${c.name}`.trim()),
        categoriasRaw: cats
      },
      emailPending,
      meta: { baseCur, generatedAt: new Date().toISOString() }
    });
  } catch(err) {
    Logger.log('❌ getDataAPILight: ' + err);
    return { error: err.message, mes };
  }
}

// ═══════════════════════════════════════════════════════
// WRITE — GUARDAR TRANSACCIÓN
// ═══════════════════════════════════════════════════════
function guardarTransaccion(form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.MOV);
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  if (!sh) throw new Error('Hoja Movimientos no existe');

  const tipo   = String(form.tipo || form.type || '').trim();
  const fecha  = form.fecha || form.date;
  const monto  = parseNum_(form.monto || form.amount);
  const cat    = stripEmoji_(String(form.categoria || form.category || 'Otros').trim());
  const cuenta = String(form.cuenta || form.account || '').trim();
  const desc   = String(form.descripcion || form.description || '').trim();
  const cDest  = String(form.cuentaDestino || '').trim();
  const baseCur= String(getSettingEs_(shCfg, 'moneda_base', 'COP') || 'COP');

  if (!fecha)               throw new Error('Falta la fecha');
  if (!cuenta)              throw new Error('Selecciona una cuenta');
  if (!monto || monto <= 0) throw new Error('Monto inválido');
  if (tipo === 'Transferencia' && (!cDest || cDest === cuenta))
    throw new Error('Selecciona una cuenta destino diferente');

  const grupo = tipo.toLowerCase() === 'ingreso' ? 'ingreso'
              : tipo.toLowerCase() === 'egreso'  ? 'gasto'
              : tipo.toLowerCase() === 'transferencia' ? 'transferencia'
              : (tipo || 'gasto').toLowerCase();

  // Un solo registro por movimiento (sin duplicar transferencias).
  const row = [
    Utilities.getUuid(),     // mov_id
    new Date(fecha),         // fecha
    desc || '—',             // descripción
    grupo,                   // grupo
    cat,                     // categoría
    monto,                   // monto
    baseCur,                 // moneda
    cuenta,                  // cuenta_origen
    cDest || '',             // cuenta_destino
    String(form.activoInversion || ''), // activo_inversión (opcional)
    form.source || 'manual', // fuente
    String(form.referencia || ''), // referencia
    String(form.notas || ''),      // notas
    new Date()               // creado_el
  ];

  const nextRow = nextEmpty_(sh, 2);
  sh.getRange(nextRow, 1, 1, row.length).setValues([row]);

  syncAccountBalances_(ss, null, true);
  clearCacheForMonth();
  return { ok: true, id: row[0] };
}

// ═══════════════════════════════════════════════════════
// WRITE — ELIMINAR TRANSACCIÓN
// ═══════════════════════════════════════════════════════
function eliminarTransaccion(txnId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!sh) throw new Error('Hoja Movimientos no existe');

  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.mov_id] ?? '') === txnId) {
      sh.deleteRow(r + 1);
      syncAccountBalances_(ss, null, true);
      clearCacheForMonth();
      return { ok: true };
    }
  }
  throw new Error('Transacción no encontrada');
}

// ═══════════════════════════════════════════════════════
// SYNC GMAIL LABEL
// ═══════════════════════════════════════════════════════
function syncGmailLabel(labelName) {
  return syncGmailLabel_(labelName || CFG.GMAIL_LABEL);
}

function syncGmailLabel_(labelName) {
  // Gmail labels son case-sensitive. Intentamos exacto y fallback de mayúscula/minúscula.
  const candidates = [
    String(labelName || '').trim(),
    String(labelName || '').trim().toLowerCase(),
    String(labelName || '').trim().toUpperCase(),
    String(labelName || '').trim().replace(/^./, c => c.toUpperCase())
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  let label = null;
  let resolvedName = '';
  for (const cand of candidates) {
    const l = GmailApp.getUserLabelByName(cand);
    if (l) { label = l; resolvedName = cand; break; }
  }

  if (!label) {
    return { ok: false, error: `Etiqueta Gmail no encontrada. Probé: ${candidates.join(', ')}` };
  }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shLog = ss.getSheetByName(CFG.SHEETS.CORREOS);
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  if (!shLog) return { ok: false, error: 'Hoja Correos_Gastos no existe' };
  const bodyCol = ensureColumn_(shLog, 'cuerpo');
  const typeCol = ensureColumn_(shLog, 'tipo_ia');
  const notesCol = ensureColumn_(shLog, 'notas_ia');

  // IDs ya procesados
  const existing = new Set(readSheet_(shLog).map(r => String(r.msg_id || '')));

  const threads  = label.getThreads(0, 25);
  let added = 0, skipped = 0, errors = 0;

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const msgId = msg.getId();
      if (existing.has(msgId)) { skipped++; continue; }

      try {
        const body    = msg.getPlainBody().substring(0, 1000);
        const amount  = extractAmount_(body + ' ' + msg.getSubject());
        const cur     = extractCurrency_(body + ' ' + msg.getSubject());
        const merchant= extractMerchant_(msg.getFrom(), msg.getSubject());

        // Clasificar con IA / reglas
        const ai = clasificarEmail_({
          from: msg.getFrom(), subject: msg.getSubject(),
          body, amount, currency: cur, merchant
        }, shCfg);

        const logRow = [
          Utilities.getUuid(), msgId,                              // log_id, msg_id
          msg.getFrom(), msg.getSubject(),                         // remitente, asunto
          msg.getDate(), null,                                     // recibido_el, procesado_el
          'pendiente',                                             // estado — siempre pendiente, usuario aprueba manualmente
          amount, cur, merchant,                                   // monto, moneda, comercio
          ai.category, ai.confidence,                              // categoria_ia, confianza_ia
          '', '',                                                  // categoria_usuario, cuenta_sugerida
          '',                                                      // observación
          '',                                                      // mov_id
          body.substring(0, 400)                                   // snippet
        ];

        const nr = nextEmpty_(shLog, 2);
        shLog.getRange(nr, 1, 1, logRow.length).setValues([logRow]);
        if (bodyCol != null) shLog.getRange(nr, bodyCol + 1).setValue(body.substring(0, 5000));
        if (typeCol != null) shLog.getRange(nr, typeCol + 1).setValue(String(ai.type || 'expense'));
        if (notesCol != null) shLog.getRange(nr, notesCol + 1).setValue(String(ai.notes || ''));

        // Auto-crear transacción si confianza alta
        if (logRow[6] === 'auto_aprobado' && amount > 0) {
          const txnResult = guardarTransaccion({
            tipo: ai.type === 'income' ? 'Ingreso' : ai.type === 'transfer' ? 'Transferencia' : 'Egreso',
            fecha: msg.getDate().toISOString().slice(0,10),
            monto: amount,
            categoria: ai.category,
            cuenta: 'Bancolombia Ahorro',
            cuentaDestino: ai.type === 'transfer' ? 'Efectivo' : '',
            descripcion: merchant + ' — ' + msg.getSubject().substring(0, 60),
            source: 'gmail'
          });
          // Actualizar log con txn_id
          shLog.getRange(nr, rowToObj_(shLog.getDataRange().getValues()[0]).mov_id + 1).setValue(txnResult.id || '');
        }

        added++;
      } catch(e) {
        Logger.log('Error procesando email ' + msgId + ': ' + e);
        errors++;
      }
    }
  }

  clearCacheForMonth();
  return { ok: true, added, skipped, errors, label: resolvedName || labelName };
}

// ═══════════════════════════════════════════════════════
// GET EMAIL LOGS para UI
// ═══════════════════════════════════════════════════════
function getEmailLogs() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (!sh) return [];
  ensureColumn_(sh, 'cuerpo');
  ensureColumn_(sh, 'tipo_ia');
  ensureColumn_(sh, 'notas_ia');
  // columnas ya están en español en Correos_Gastos
  return readSheet_(sh)
    .filter(r => String(r.estado || '').toLowerCase() !== 'oculto')
    .sort((a, b) => (b.recibido_el || 0) - (a.recibido_el || 0))
    .slice(0, 50)
    .map(r => ({
      id:         r.log_id,
      from:       r.remitente,
      subject:    r.asunto,
      date:       r.recibido_el instanceof Date ? fmtDate_(r.recibido_el, 'dd/MM/yy HH:mm') : '',
      status:     r.estado,
      amount:     parseNum_(r.monto),
      currency:   r.moneda,
      merchant:   r.comercio,
      category:   r.categoria_usuario || r.categoria_ia,
      type:       r.tipo_ia || '',
      account:    r.cuenta_sugerida || '',
      confidence: parseNum_(r.confianza_ia),
      txnId:      r.mov_id,
      notes:      String(r.notas_ia || ''),
      obs:        String(r.observación || r.observacion || ''),
      snippet:    String(r.snippet || '').substring(0, 160),
      body:       String(r.cuerpo || r.snippet || '')
    }));
}

/**
 * Permite editar metadatos del correo (sin aprobarlo).
 * @param {string} logId
 * @param {Object} changes { categoria_usuario?: string, observacion?: string }
 */
function actualizarCorreoGasto(logId, changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (!sh) throw new Error('Hoja Correos_Gastos no existe');
  ensureColumn_(sh, 'cuenta_sugerida');

  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);

  const idIdx = hdr.log_id;
  if (idIdx == null) throw new Error('Columna log_id no encontrada');

  const catCol = hdr.categoria_usuario;
  const accCol = hdr.cuenta_sugerida;
  const obsCol = hdr.observación ?? hdr.observacion;
  if (catCol == null || obsCol == null) throw new Error('Faltan columnas de edición (categoria_usuario/observación)');

  const newCat = changes && changes.categoria_usuario != null ? String(changes.categoria_usuario).trim() : '';
  const newAcc = changes && changes.cuenta_sugerida != null ? String(changes.cuenta_sugerida).trim() : '';
  const newObs = changes && changes.observacion != null ? String(changes.observacion).trim() : '';

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx] ?? '') !== String(logId)) continue;
    if (newCat !== '') sh.getRange(r + 1, catCol + 1).setValue(stripEmoji_(newCat));
    if (newAcc !== '' && accCol != null) sh.getRange(r + 1, accCol + 1).setValue(newAcc);
    sh.getRange(r + 1, obsCol + 1).setValue(newObs);
    clearCacheForMonth();
    return { ok: true };
  }

  throw new Error('Email no encontrado: ' + logId);
}

// ensureEmailLogColumns_ ya no es necesaria en el modelo español.

// ═══════════════════════════════════════════════════════
// UPLOAD TRANSACCIONES (ATAJOS)
// ═══════════════════════════════════════════════════════
function uploadTransacciones(txns) {
  if (!Array.isArray(txns) || txns.length === 0) throw new Error('Array de transacciones requerido');

  const results = [];
  for (const txn of txns) {
    try {
      const res = guardarTransaccion(txn);
      results.push({ ok: true, id: res.id, original: txn });
    } catch(err) {
      results.push({ ok: false, error: err.message, original: txn });
    }
  }

  return { uploaded: results.filter(r => r.ok).length, errors: results.filter(r => !r.ok).length, results };
}

// ═══════════════════════════════════════════════════════
// APROBAR EMAIL pendiente manualmente
// ═══════════════════════════════════════════════════════
function aprobarEmail(logId, categoria, cuenta) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sh    = ss.getSheetByName(CFG.SHEETS.CORREOS);
  const data  = sh.getDataRange().getValues();
  const hdr   = rowToObj_(data[0]);

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.log_id] ?? '') === logId) {
      const amount   = parseNum_(data[r][hdr.monto]);
      const merchant = String(data[r][hdr.comercio] || '');
      const subject  = String(data[r][hdr.asunto]  || '');
      const recAt    = data[r][hdr.recibido_el];
      const accountSuggested = String(data[r][hdr.cuenta_sugerida] || '').trim();
      const suggestedType = String(data[r][hdr.tipo_ia] || 'expense').toLowerCase();

      const txn = guardarTransaccion({
        tipo: suggestedType === 'income' ? 'Ingreso' : suggestedType === 'transfer' ? 'Transferencia' : 'Egreso',
        fecha: recAt instanceof Date ? recAt.toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
        monto: amount,
        categoria: stripEmoji_(categoria),
        cuenta: cuenta || accountSuggested || 'Bancolombia Ahorro',
        cuentaDestino: suggestedType === 'transfer' ? 'Efectivo' : '',
        descripcion: merchant + ' — ' + subject.substring(0,60),
        source: 'gmail'
      });

      // Actualizar status
      sh.getRange(r + 1, hdr.estado + 1).setValue('aprobado');
      sh.getRange(r + 1, hdr.mov_id + 1).setValue(txn.id || '');
      sh.getRange(r + 1, hdr.procesado_el + 1).setValue(new Date());

      clearCacheForMonth();
      return { ok: true, txnId: txn.id };
    }
  }
  throw new Error('Email no encontrado: ' + logId);
}

// ═══════════════════════════════════════════════════════
// ACEPTAR EMAIL RÁPIDO (sin modal, aprobación directa)
// ═══════════════════════════════════════════════════════
function acceptEmailQuick(logId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shLog = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (!shLog) throw new Error('Hoja Correos no existe');

  const data = shLog.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.log_id] ?? '') === logId) {
      const amount = parseNum_(data[r][hdr.monto]);
      const merchant = String(data[r][hdr.comercio] || '');
      const subject = String(data[r][hdr.asunto] || '');
      const recAt = data[r][hdr.recibido_el];
      const aiCat = String(data[r][hdr.categoria_ia] || 'Otros');
      const accountSuggested = String(data[r][hdr.cuenta_sugerida] || '').trim();
      const suggestedType = String(data[r][hdr.tipo_ia] || 'expense').toLowerCase();

      // Crear transacción automáticamente con categoría sugerida por IA
      const txn = guardarTransaccion({
        tipo: suggestedType === 'income' ? 'Ingreso' : suggestedType === 'transfer' ? 'Transferencia' : 'Egreso',
        fecha: recAt instanceof Date ? recAt.toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
        monto: amount,
        categoria: aiCat,
        cuenta: accountSuggested || CFG.DEFAULT_ACCOUNT,
        cuentaDestino: suggestedType === 'transfer' ? 'Efectivo' : '',
        descripcion: (merchant || subject).substring(0, 120),
        source: 'gmail_accepted'
      });

      // Marcar email como aprobado
      shLog.getRange(r + 1, hdr.estado + 1).setValue('aprobado');
      shLog.getRange(r + 1, hdr.mov_id + 1).setValue(txn.id || '');
      shLog.getRange(r + 1, hdr.procesado_el + 1).setValue(new Date());

      clearCacheForMonth();
      return { ok: true, txnId: txn.id, merchant, amount, category: aiCat };
    }
  }
  throw new Error('Email no encontrado: ' + logId);
}

function eliminarCorreoGasto(logId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (!sh) throw new Error('Hoja Correos_Gastos no existe');

  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);
  if (hdr.estado == null) throw new Error('Columna estado no encontrada');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.log_id] ?? '') === String(logId)) {
      sh.getRange(r + 1, hdr.estado + 1).setValue('oculto');
      if (hdr.procesado_el != null) sh.getRange(r + 1, hdr.procesado_el + 1).setValue(new Date());
      clearCacheForMonth();
      return { ok: true };
    }
  }
  throw new Error('Email no encontrado: ' + logId);
}

// ═══════════════════════════════════════════════════════
// EXPORTS CSV
// ═══════════════════════════════════════════════════════
function exportCSV(mes) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const sh   = ss.getSheetByName(CFG.SHEETS.MOV);
  const txns = readSheet_(sh).map(m => {
    const fecha = m.fecha instanceof Date ? m.fecha : (m.fecha ? new Date(m.fecha) : null);
    return {
      fecha,
      categoria: String(m.categoría || m.categoria || 'Otros'),
      descripcion: String(m.descripción || m.descripcion || ''),
      monto: parseNum_(m.monto),
      moneda: String(m.moneda || ''),
      grupo: String(m.grupo || ''),
      cuenta: String(m.cuenta_origen || '')
    };
  }).filter(r => r.fecha instanceof Date && fmtDate_(r.fecha, 'yyyy-MM') === mes);

  const headers = ['Fecha','Categoría','Descripción','Monto','Moneda','Tipo','Cuenta','Fuente'];
  const rows = txns.map(r => [
    fmtDate_(r.fecha, 'dd/MM/yyyy'), r.categoria, r.descripcion,
    r.monto, r.moneda, r.grupo, r.cuenta, ''
  ]);
  return csvBuild_([headers, ...rows]);
}

// ═══════════════════════════════════════════════════════
// TRIGGER SETUP — ejecutar manualmente
// ═══════════════════════════════════════════════════════
function setupTriggers() {
  // Eliminar triggers existentes
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncGmailLabelAuto')
    .timeBased().everyMinutes(30).create();

  ScriptApp.newTrigger('actualizarFX')
    .timeBased().everyDays(1).atHour(7).create();

  ScriptApp.newTrigger('actualizarPreciosInversionesAuto')
    .timeBased().everyDays(1).atHour(8).create();

  Logger.log('✅ Triggers: Gmail 30min · FX 7am · Precios inversiones 8am');
}

function syncGmailLabelAuto() { syncGmailLabel_(CFG.GMAIL_LABEL); }
function actualizarPreciosInversionesAuto() { actualizarPreciosInversiones(); }

// ── Wrapper públicos para el frontend (google.script.run) ──────────────
function getAlertasActivasUI() { return getAlertasActivas(); }
function chatFinancieroUI(pregunta, historial) { return chatFinanciero(pregunta, historial || []); }
function getTrucosFinancierosUI() { return getTrucosFinancieros(); }
function categorizarMovimientosUI() { return categorizarMovimientosSinCategoria(); }
function proyectarSaldoUI() { return proyectarSaldoFinMes(); }
function procesarPDFUI(params) { return procesarExtractoPDF(params); }
function getHistorialExtractosUI(limite) {
  try { return getHistorialExtractos(limite || 20); }
  catch(e) { Logger.log('getHistorialExtractosUI error: ' + e.message + ' | ' + e.stack); throw e; }
}

function debugHistorialUI() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hojas = ss.getSheets();
    var nombres = [];
    for (var i = 0; i < hojas.length; i++) nombres.push(hojas[i].getName());
    var sh = ss.getSheetByName('Historial_Extractos');
    if (!sh) return 'SIN HOJA. Hojas existentes: ' + nombres.join(', ');
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return 'HOJA VACIA. Filas: ' + lastRow;
    var data = sh.getDataRange().getValues();
    var headers = String(data[0]);
    var fila1 = '';
    for (var j = 0; j < data[1].length; j++) {
      var v = data[1][j];
      fila1 += j + ':' + (v instanceof Date ? 'DATE=' + v.toISOString() : typeof v + '=' + String(v).slice(0,30)) + ' | ';
    }
    return 'OK. Filas=' + (lastRow-1) + ' | Headers: ' + headers + ' | Fila1: ' + fila1;
  } catch(e) {
    return 'EXCEPCION: ' + e.message;
  }
}
function marcarMovimientoConciliadoUI(movId, stmtId, estado) { return marcarMovimientoConciliado(movId, stmtId, estado); }
function actualizarEstadoHistorialUI(stmtId, estado) { return actualizarEstadoHistorialExtracto(stmtId, estado); }
function eliminarHistorialExtractoUI(stmtId) { return eliminarHistorialExtracto(stmtId); }
function limpiarDuplicadosHistorialUI() { return limpiarDuplicadosHistorial_(); }
function cargarReviewExtractoUI(stmtId) { return cargarReviewExtracto(stmtId); }
function actualizarReviewExtractoUI(stmtId, reviewJson) { return actualizarReviewExtracto_(stmtId, reviewJson); }

// Marcar múltiples movimientos como conciliados en una sola llamada
function marcarMovimientosBatchUI(movIds, stmtId, estado) {
  if (!Array.isArray(movIds)) return { ok: false, error: 'movIds debe ser array' };
  let ok = 0;
  movIds.forEach(id => {
    try { marcarMovimientoConciliado(id, stmtId, estado); ok++; } catch(e) {}
  });
  return { ok: true, marcados: ok };
}

// Guardar múltiples transacciones en una sola llamada (para importar faltantes en batch)
function guardarTransaccionesBatchUI(txns) {
  if (!Array.isArray(txns)) return { ok: false, error: 'txns debe ser array' };
  const resultados = [];
  txns.forEach(form => {
    try {
      const r = guardarTransaccion(form);
      resultados.push({ ok: true, id: r.id || '', idx: form._idx });
    } catch(e) {
      resultados.push({ ok: false, error: e.message, idx: form._idx });
    }
  });
  clearCacheForMonth();
  return { ok: true, resultados };
}

function setupAllTriggers() {
  setupTriggers();
  setupAlertasTrigger();
  Logger.log('✅ Todos los triggers configurados');
}

// ═══════════════════════════════════════════════════════
// ATAJOS DE IPHONE — Handlers del doPost
// ═══════════════════════════════════════════════════════

/**
 * Registro rápido de gasto/ingreso desde Atajos de iPhone.
 *
 * Body esperado (JSON):
 *   { action: 'quick_gasto' | 'quick_ingreso' | 'nueva_txn',
 *     monto: 25000,
 *     descripcion: 'Almuerzo',   // opcional
 *     cuenta: 'Bancolombia Ahorro',  // opcional
 *     categoria: 'Alimentos',    // opcional; si falta, IA clasifica
 *     tipo: 'gasto'|'ingreso'|'transferencia', // solo para nueva_txn
 *     api_key: 'tu-clave'        // si configuraste SHORTCUTS_API_KEY
 *   }
 *
 * Respuesta:
 *   { ok: true, mensaje: '💸 Gasto de $25,000 en Alimentos registrado',
 *     categoria, cuenta, monto, id }
 */
function shortcutQuickTxn_(body, tipoDefault) {
  const monto = parseNum_(body.monto || body.amount);
  if (!monto || monto <= 0) throw new Error('Falta monto o es inválido');

  const desc  = String(body.descripcion || body.description || '').trim();
  const tipo  = String(body.tipo || tipoDefault || 'gasto').toLowerCase();

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const cuenta = String(body.cuenta || body.account
                   || getSettingEs_(shCfg, 'cuenta_default', CFG.DEFAULT_ACCOUNT)).trim();

  // Categoría: usar la pasada o clasificar con reglas (sin latencia de Gemini)
  let cat = String(body.categoria || body.category || '').trim();
  if (!cat) {
    const aiResult = _rulesClassify_({
      subject: desc, merchant: desc.split(' ')[0] || desc,
      body: '', amount: monto
    }, shCfg);
    cat = aiResult.category || 'Otros';
  }

  const tipoForm = tipo === 'ingreso'        ? 'Ingreso'
                 : tipo === 'transferencia'  ? 'Transferencia'
                 : 'Egreso';

  guardarTransaccion({
    tipo:       tipoForm,
    fecha:      new Date(),
    monto:      monto,
    categoria:  cat,
    cuenta:     cuenta,
    descripcion: desc || (tipo === 'ingreso' ? 'Ingreso rápido' : 'Gasto rápido'),
    source:     'shortcuts_ios'
  });

  const COP   = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const emoji = tipo === 'ingreso' ? '💰' : tipo === 'transferencia' ? '↔️' : '💸';
  const label = tipo === 'ingreso' ? 'Ingreso' : tipo === 'transferencia' ? 'Transferencia' : 'Gasto';

  return {
    ok:        true,
    mensaje:   `${emoji} ${label} de ${COP.format(monto)} en "${cat}" registrado`,
    categoria: cat,
    cuenta:    cuenta,
    monto:     monto
  };
}

/**
 * Devuelve saldos de todas las cuentas activas.
 * Respuesta: { ok, mensaje, cuentas: [{nombre, tipo, saldo, moneda}], total }
 */
function shortcutSaldo_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!sh) throw new Error('Hoja Cuentas no existe');

  const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const cuentas = readSheet_(sh)
    .filter(r => String(r.activa || '').toLowerCase() !== 'false' && r.nombre)
    .map(r => ({
      nombre:  String(r.nombre  || '').trim(),
      tipo:    String(r.tipo    || '').trim(),
      saldo:   parseNum_(r.saldo),
      moneda:  String(r.moneda  || 'COP').trim()
    }));

  const total   = cuentas.reduce((s, c) => s + c.saldo, 0);
  const lineas  = cuentas.map(c => `• ${c.nombre}: ${COP.format(c.saldo)}`).join('\n');

  return {
    ok:      true,
    mensaje: `💳 Saldos actuales:\n${lineas}\n\nTotal: ${COP.format(total)}`,
    cuentas, total
  };
}

/**
 * Resumen del mes (usa generarReporteMensual de Operations.js).
 * Body: { mes?: 'yyyy-MM' }
 * Respuesta: { ok, mensaje, income, expense, savings, healthScore, topCategoria }
 */
function shortcutResumenMes_(mesFiltro) {
  const mes = mesFiltro || Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM');
  const rep = generarReporteMensual(mes);
  const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const tasa = rep.income > 0 ? ((rep.savings / rep.income) * 100).toFixed(1) : '0.0';

  return {
    ok:      true,
    mensaje: `📊 ${mes}\n💰 Ingresos: ${COP.format(rep.income)}\n💸 Gastos: ${COP.format(rep.expense)}\n📈 Ahorro: ${COP.format(rep.savings)} (${tasa}%)\n🏆 Salud financiera: ${rep.healthScore.score}/100`,
    mes,
    income:       rep.income,
    expense:      rep.expense,
    savings:      rep.savings,
    healthScore:  rep.healthScore.score,
    topCategoria: rep.topCat?.[0]?.[0] || '—'
  };
}

/**
 * Lista las transacciones de hoy con totales.
 * Respuesta: { ok, mensaje, fecha, totalGastos, totalIngresos, count }
 */
function shortcutResumenDia_() {
  const tz  = CFG.TZ;
  const hoy = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shT = ss.getSheetByName(CFG.SHEETS.MOV);
  const txns = readSheet_(shT).filter(r => {
    const d = r.fecha;
    return d instanceof Date && Utilities.formatDate(d, tz, 'yyyy-MM-dd') === hoy;
  });

  const COP    = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const gastos = txns.filter(r => normalizeType_(r.grupo) === 'expense');
  const ingresos = txns.filter(r => normalizeType_(r.grupo) === 'income');
  const totalG = gastos.reduce((s, r) => s + parseNum_(r.monto), 0);
  const totalI = ingresos.reduce((s, r) => s + parseNum_(r.monto), 0);

  const lineas = txns.slice(-6).map(r => {
    const t = normalizeType_(r.grupo);
    const e = t === 'income' ? '💰' : t === 'transfer' ? '↔️' : '💸';
    return `${e} ${String(r.descripcion || '').substring(0, 28)}: ${COP.format(parseNum_(r.monto))}`;
  }).join('\n');

  return {
    ok:      true,
    mensaje: txns.length === 0
      ? `📅 Hoy (${hoy}): sin movimientos registrados.`
      : `📅 Hoy (${hoy}) — ${txns.length} movimiento(s)\n${lineas}\n\nGastos: ${COP.format(totalG)} | Ingresos: ${COP.format(totalI)}`,
    fecha:         hoy,
    totalGastos:   totalG,
    totalIngresos: totalI,
    count:         txns.length
  };
}

/**
 * Estado de presupuestos del mes actual.
 * Respuesta: { ok, mensaje, items: [{categoria, limite, gastado, pct, alerta}], alertas }
 */
function shortcutPresupuesto_() {
  const tz  = CFG.TZ;
  const mes = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shB = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
  const shT = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!shB || !shT) throw new Error('Faltan hojas Presupuestos o Movimientos');

  const budgets = readSheet_(shB).filter(r => String(r.activo || '').toLowerCase() !== 'false');
  const txns    = readSheet_(shT).filter(r => {
    const d = r.fecha;
    return d instanceof Date && fmtDate_(d, 'yyyy-MM') === mes;
  });

  const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  const items = budgets.map(b => {
    const catName  = String(b.categoria || '').trim();
    const limite   = parseNum_(b.limite);
    const alertPct = parseNum_(b.alerta_pct) || 80;
    const gastado  = txns
      .filter(r => normalizeType_(r.grupo) === 'expense' && String(r.categoria || '').trim() === catName)
      .reduce((s, r) => s + parseNum_(r.monto), 0);
    const pct    = limite > 0 ? Math.round((gastado / limite) * 100) : 0;
    const alerta = pct >= alertPct;
    return { categoria: catName, limite, gastado, pct, alerta };
  });

  const alertas = items.filter(i => i.alerta);
  const lineas  = items.map(i => {
    const bar = i.pct >= 100 ? '🔴' : i.pct >= 80 ? '🟡' : '🟢';
    return `${bar} ${i.categoria}: ${COP.format(i.gastado)} / ${COP.format(i.limite)} (${i.pct}%)`;
  }).join('\n');

  const nota = alertas.length > 0
    ? `\n\n⚠️ Alerta: ${alertas.map(a => a.categoria).join(', ')}`
    : '\n\n✅ Todos los presupuestos en orden';

  return {
    ok:      true,
    mensaje: `💼 Presupuestos ${mes}:\n${lineas || 'Sin presupuestos configurados'}${nota}`,
    items,
    alertas: alertas.map(a => a.categoria)
  };
}

// ═══════════════════════════════════════════════════════
// ACTUALIZAR TIPOS DE CAMBIO (trigger diario)
// ═══════════════════════════════════════════════════════
function actualizarFX() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shFX = ss.getSheetByName(CFG.SHEETS.TIPOS_CAMBIO);
  if (!shFX) return;

  const pairs = [['USD','COP'],['EUR','COP'],['EUR','USD']];
  let updated = 0;

  pairs.forEach(([from, to]) => {
    try {
      const url = `https://open.er-api.com/v6/latest/${from}`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return;
      const json = JSON.parse(res.getContentText());
      const rate = json.rates?.[to];
      if (!rate) return;

      const data = shFX.getDataRange().getValues();
      const hdr  = rowToObj_(data[0]);
      let found  = false;
      for (let r = 1; r < data.length; r++) {
        if (String(data[r][hdr.base]).trim() === from && String(data[r][hdr.objetivo]).trim() === to) {
          shFX.getRange(r + 1, hdr.tasa + 1).setValue(rate);
          shFX.getRange(r + 1, hdr.fecha + 1).setValue(new Date());
          shFX.getRange(r + 1, hdr.fuente + 1).setValue('open.er-api.com');
          found = true;
          break;
        }
      }
      if (!found) {
        const nr = nextEmpty_(shFX, 2);
        shFX.getRange(nr, 1, 1, 5).setValues([[from, to, rate, new Date(), 'open.er-api.com']]);
      }
      updated++;
      Utilities.sleep(500);
    } catch(e) {
      Logger.log('FX error ' + from + '/' + to + ': ' + e);
    }
  });

  CacheService.getScriptCache().remove('fx_USD_COP');
  CacheService.getScriptCache().remove('fx_EUR_COP');
  Logger.log('✅ FX actualizado: ' + updated + ' pares');
  return { ok: true, updated };
}

// ═══════════════════════════════════════════════════════
// RECALCULAR SALDOS (llamable desde la UI)
// ═══════════════════════════════════════════════════════
function recalcularSaldos() {
  try {
    syncAccountBalances_(SpreadsheetApp.getActiveSpreadsheet(), null, true);
    clearCacheForMonth();
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN — lectura y escritura
// ═══════════════════════════════════════════════════════
function getConfigData() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const shCta = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  const shCat = ss.getSheetByName(CFG.SHEETS.CATEGORIAS);

  const settings = {};
  if (shCfg) {
    readSheet_(shCfg).forEach(r => { settings[String(r.clave || r.key || '')] = r.valor ?? r.value ?? ''; });
  }

  const cuentas = shCta ? readSheet_(shCta).map(r => ({
    id:          String(r.cuenta_id || ''),
    nombre:      String(r.nombre || ''),
    tipo:        String(r.tipo || 'efectivo'),
    institucion: String(r.institución || r.institucion || ''),
    moneda:      String(r.moneda || 'COP'),
    saldo:       parseNum_(r.saldo),
    activa:      r.activa !== false && String(r.activa) !== 'false'
  })) : [];

  const categorias = shCat ? readSheet_(shCat).map(r => ({
    id:       String(r.categoria_id || ''),
    nombre:   String(r.nombre || ''),
    grupo:    String(r.grupo || 'gasto'),
    icono:    String(r.icono || ''),
    color:    String(r.color || '#64748b'),
    keywords: String(r.keywords || '')
  })) : [];

  return { settings, cuentas, categorias };
}

function guardarConfiguracion(clave, valor) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  if (!shCfg) throw new Error('Hoja Configuración no existe');
  const data = shCfg.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.clave] || data[r][hdr.key] || '').trim() === String(clave)) {
      const col = (hdr.valor ?? hdr.value ?? 1);
      shCfg.getRange(r + 1, col + 1).setValue(valor);
      clearCacheForMonth();
      return { ok: true };
    }
  }
  // Crear nueva clave
  const nr = nextEmpty_(shCfg, 2);
  shCfg.getRange(nr, 1, 1, 3).setValues([[clave, valor, '']]);
  clearCacheForMonth();
  return { ok: true };
}

function guardarCuenta(form) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!sh) throw new Error('Hoja Cuentas no existe');

  const nombre = String(form.nombre || '').trim();
  if (!nombre) throw new Error('Nombre de cuenta requerido');

  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);

  // Buscar existente por nombre o id
  const searchId = String(form.cuenta_id || '').trim();
  for (let r = 1; r < data.length; r++) {
    const matchId   = searchId && String(data[r][hdr.cuenta_id] || '').trim() === searchId;
    const matchName = String(data[r][hdr.nombre] || '').trim().toLowerCase() === nombre.toLowerCase();
    if (matchId || matchName) {
      const row = r + 1;
      sh.getRange(row, hdr.nombre + 1).setValue(nombre);
      sh.getRange(row, hdr.tipo + 1).setValue(String(form.tipo || 'efectivo'));
      sh.getRange(row, (hdr.institución ?? hdr.institucion) + 1).setValue(String(form.institucion || ''));
      sh.getRange(row, hdr.moneda + 1).setValue(String(form.moneda || 'COP'));
      if (form.saldo != null) sh.getRange(row, hdr.saldo + 1).setValue(parseNum_(form.saldo));
      sh.getRange(row, hdr.activa + 1).setValue(form.activa !== false);
      syncAccountBalances_(ss, null, true);
      clearCacheForMonth();
      return { ok: true, action: 'updated' };
    }
  }
  // Crear nueva
  const newId = 'CTA_' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sh.getRange(nextEmpty_(sh, 2), 1, 1, 7).setValues([[
    newId, nombre,
    String(form.tipo || 'efectivo'),
    String(form.institucion || ''),
    String(form.moneda || 'COP'),
    parseNum_(form.saldo || 0),
    form.activa !== false
  ]]);
  clearCacheForMonth();
  return { ok: true, action: 'created', id: newId };
}

function guardarCategoria(form) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CFG.SHEETS.CATEGORIAS);
  if (!sh) throw new Error('Hoja Categorías no existe');

  const nombre = String(form.nombre || '').trim();
  if (!nombre) throw new Error('Nombre de categoría requerido');

  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);

  const searchId = String(form.categoria_id || '').trim();
  for (let r = 1; r < data.length; r++) {
    const matchId   = searchId && String(data[r][hdr.categoria_id] || '').trim() === searchId;
    const matchName = String(data[r][hdr.nombre] || '').trim().toLowerCase() === nombre.toLowerCase();
    if (matchId || matchName) {
      const row = r + 1;
      sh.getRange(row, hdr.nombre + 1).setValue(nombre);
      sh.getRange(row, hdr.grupo + 1).setValue(String(form.grupo || 'gasto'));
      sh.getRange(row, hdr.icono + 1).setValue(String(form.icono || ''));
      sh.getRange(row, hdr.color + 1).setValue(String(form.color || '#64748b'));
      sh.getRange(row, hdr.keywords + 1).setValue(String(form.keywords || ''));
      clearCacheForMonth();
      return { ok: true, action: 'updated' };
    }
  }
  const newId = 'CAT_' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sh.getRange(nextEmpty_(sh, 2), 1, 1, 6).setValues([[
    newId, nombre,
    String(form.grupo || 'gasto'),
    String(form.icono || ''),
    String(form.color || '#64748b'),
    String(form.keywords || '')
  ]]);
  clearCacheForMonth();
  return { ok: true, action: 'created', id: newId };
}

function eliminarCategoria(catId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CATEGORIAS);
  if (!sh) throw new Error('Hoja Categorías no existe');
  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.categoria_id] || '').trim() === String(catId)) {
      sh.deleteRow(r + 1);
      clearCacheForMonth();
      return { ok: true };
    }
  }
  throw new Error('Categoría no encontrada: ' + catId);
}

// ═══════════════════════════════════════════════════════
// HELPERS INTERNOS
// ═══════════════════════════════════════════════════════
function readSheet_(sh) {
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(normalizeKey_);
  return data.slice(1)
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });
}

function rowToObj_(headerRow) {
  const m = {};
  headerRow.forEach((h, i) => { m[normalizeKey_(h)] = i; });
  return m;
}

function ensureColumn_(sh, headerName) {
  if (!sh) return null;
  const headers = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  const normalized = rowToObj_(headers);
  const key = normalizeKey_(headerName);
  if (normalized[key] != null) return normalized[key];
  const col = headers.filter(Boolean).length + 1;
  sh.getRange(1, col).setValue(headerName).setFontWeight('bold');
  return col - 1;
}

function normalizeKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function getSettingEs_(shCfg, clave, def) {
  // Configuración: clave/valor
  if (!shCfg) return def;
  const data = shCfg.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0] || '').trim() === clave) return data[r][1] ?? def;
  }
  return def;
}

/**
 * Carga ~50 movimientos ficticios en 3 meses (Feb–Abr 2026)
 * para tener el dashboard lleno desde el primer día.
 * Solo se ejecuta si Movimientos está vacía.
 *
 * Estructura de cada fila (14 columnas):
 * mov_id | fecha | descripción | grupo | categoría | monto | moneda |
 * cuenta_origen | cuenta_destino | activo_inversión | fuente | referencia | notas | creado_el
 */
function cargarDatosDemo_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shM = ss.getSheetByName(CFG.SHEETS.MOV);
  const shP = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
  const shI = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!shM) return;
  if (shM.getLastRow() >= 2) return; // idempotente

  const u   = () => Utilities.getUuid();
  const D   = (y, m, d) => new Date(y, m - 1, d);
  const COP = 'COP';
  const BC  = 'Bancolombia Ahorro';
  const EF  = 'Efectivo';
  const BRK = 'Broker / Inversiones';
  const now = new Date();

  // ── cols: mov_id, fecha, descripción, grupo, categoría, monto, moneda,
  //          cuenta_origen, cuenta_destino, activo_inversión, fuente, ref, notas, creado_el
  const movs = [
    // ════════ FEBRERO 2026 ════════
    [u(), D(2026,2, 1), 'Salario febrero',              'ingreso',       'Ingresos',            6800000, COP, BC,  '',   '',            'manual', '', 'Depósito nómina', now],
    [u(), D(2026,2, 3), 'Éxito — mercado quincenal',   'gasto',         'Alimentos',             387000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,2, 4), 'Claro — plan pospago',        'gasto',         'Servicios',              89000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2, 5), 'Netflix',                      'gasto',         'Servicios',              47900, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2, 6), 'Uber — oficina ida/vuelta',   'gasto',         'Transporte',             28500, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2, 8), 'Almuerzo restaurante',         'gasto',         'Alimentos',              32000, COP, EF,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,2,10), 'Gasolina',                    'gasto',         'Transporte',            120000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,2,12), 'Farmacia Cruz Verde',         'gasto',         'Salud',                   67000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,14), 'Traslado a efectivo',         'transferencia', 'Transferencia',          300000, COP, BC,  EF,   '',            'manual', '', '',               now],
    [u(), D(2026,2,15), 'Arriendo febrero',            'gasto',         'Hogar',                1500000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,2,16), 'Uber Eats — cena',            'gasto',         'Alimentos',              54000, COP, EF,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,18), 'Aporte mensual inversiones',  'transferencia', 'Aporte a inversiones',  500000, COP, BC,  BRK,  'ETF S&P 500', 'manual', '', '',               now],
    [u(), D(2026,2,20), 'Rappi — domicilio',           'gasto',         'Alimentos',              47000, COP, EF,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,21), 'Bodytech gym',                'gasto',         'Salud',                   95000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,22), 'Platzi — suscripción anual',  'gasto',         'Educación',             110000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,24), 'EPM — servicios públicos',   'gasto',         'Servicios',             185000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,26), 'Spotify',                     'gasto',         'Servicios',              21900, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,2,28), 'Cine — salida familiar',      'gasto',         'Entretenimiento',         58000, COP, EF,  '',   '',            'manual', '', '',               now],

    // ════════ MARZO 2026 ════════
    [u(), D(2026,3, 1), 'Salario marzo',               'ingreso',       'Ingresos',            6800000, COP, BC,  '',   '',            'manual', '', 'Depósito nómina', now],
    [u(), D(2026,3, 2), 'Freelance — diseño web',      'ingreso',       'Ingresos',            1200000, COP, BC,  '',   '',            'manual', '', 'Proyecto puntual',now],
    [u(), D(2026,3, 3), 'Carulla — mercado',           'gasto',         'Alimentos',             420000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3, 4), 'Claro — plan pospago',        'gasto',         'Servicios',              89000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3, 5), 'Netflix',                     'gasto',         'Servicios',              47900, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3, 5), 'Spotify',                     'gasto',         'Servicios',              21900, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3, 7), 'Taxi — aeropuerto',           'gasto',         'Transporte',             85000, COP, EF,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3, 8), 'Avianca — Bogotá-Medellín',  'gasto',         'Viajes',                420000, COP, BC,  '',   '',            'gmail',  '', 'Viaje de trabajo',now],
    [u(), D(2026,3, 9), 'Hotel Medellín (2 noches)',   'gasto',         'Viajes',                380000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3,11), 'Almuerzo',                    'gasto',         'Alimentos',              29000, COP, EF,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,13), 'Gasolina',                    'gasto',         'Transporte',            115000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,15), 'Traslado a efectivo',         'transferencia', 'Transferencia',          300000, COP, BC,  EF,   '',            'manual', '', '',               now],
    [u(), D(2026,3,17), 'Arriendo marzo',              'gasto',         'Hogar',                1500000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,18), 'Farmacia — medicamentos',     'gasto',         'Salud',                   43000, COP, EF,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,20), 'Aporte mensual inversiones',  'transferencia', 'Aporte a inversiones',  500000, COP, BC,  BRK,  'ETF S&P 500', 'manual', '', '',               now],
    [u(), D(2026,3,21), 'H&M — ropa temporada',       'gasto',         'Ropa',                  215000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,22), 'EPM — servicios públicos',   'gasto',         'Servicios',             192000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3,24), 'Bodytech gym',                'gasto',         'Salud',                   95000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3,25), 'Cita médica EPS copago',      'gasto',         'Salud',                   58000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,26), 'Platzi — suscripción',        'gasto',         'Educación',             110000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,3,28), 'Bar — salida con amigos',     'gasto',         'Entretenimiento',       125000, COP, EF,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,3,30), 'Mercado pequeño',             'gasto',         'Alimentos',              67000, COP, EF,  '',   '',            'manual', '', '',               now],

    // ════════ ABRIL 2026 (parcial) ════════
    [u(), D(2026,4, 1), 'Salario abril',               'ingreso',       'Ingresos',            6800000, COP, BC,  '',   '',            'manual', '', 'Depósito nómina', now],
    [u(), D(2026,4, 2), 'Éxito — mercado',             'gasto',         'Alimentos',             395000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,4, 3), 'Claro — plan pospago',        'gasto',         'Servicios',              89000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,4, 3), 'Netflix',                     'gasto',         'Servicios',              47900, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,4, 4), 'Uber — trabajo',              'gasto',         'Transporte',             22000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,4, 5), 'Gasolina',                    'gasto',         'Transporte',            118000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,4, 6), 'Almuerzo',                    'gasto',         'Alimentos',              28000, COP, EF,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,4, 7), 'Rappi — domicilio',           'gasto',         'Alimentos',              52000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,4, 8), 'Bodytech gym',                'gasto',         'Salud',                   95000, COP, BC,  '',   '',            'gmail',  '', '',               now],
    [u(), D(2026,4, 9), 'Traslado a efectivo',         'transferencia', 'Transferencia',          200000, COP, BC,  EF,   '',            'manual', '', '',               now],
    [u(), D(2026,4,10), 'Aporte mensual inversiones',  'transferencia', 'Aporte a inversiones',  500000, COP, BC,  BRK,  'ETF S&P 500', 'manual', '', '',               now],
    [u(), D(2026,4,11), 'Arriendo abril',              'gasto',         'Hogar',                1500000, COP, BC,  '',   '',            'manual', '', '',               now],
    [u(), D(2026,4,12), 'Almuerzo restaurante',        'gasto',         'Alimentos',              31000, COP, EF,  '',   '',            'manual', '', '',               now],
  ];

  shM.getRange(2, 1, movs.length, movs[0].length).setValues(movs);

  // ── PRESUPUESTOS del mes actual ─────────────────────────
  if (shP && shP.getLastRow() <= 1) {
    const mesAct = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM');
    const pres = [
      [u(), 'Alimentos',       mesAct, 600000,  85, true],
      [u(), 'Transporte',      mesAct, 300000,  80, true],
      [u(), 'Servicios',       mesAct, 450000,  80, true],
      [u(), 'Salud',           mesAct, 250000,  85, true],
      [u(), 'Entretenimiento', mesAct, 200000,  80, true],
      [u(), 'Educación',       mesAct, 150000,  90, true],
      [u(), 'Ropa',            mesAct, 250000,  80, true],
      [u(), 'Hogar',           mesAct, 1600000, 95, true],
      [u(), 'Viajes',          mesAct, 500000,  90, true],
    ];
    shP.getRange(2, 1, pres.length, pres[0].length).setValues(pres);
  }

  // ── INVERSIONES demo ─────────────────────────────────────────────────────
  // headers (22 cols): inversion_id, fecha_compra, cuenta, broker, operacion,
  //   ticker, activo, cantidad, precio_compra, moneda_compra, trm_compra,
  //   vr_mercado_compra, fuente_precio, precio_actual, moneda_actual,
  //   trm_actual, precio_actual_base, vr_mercado_actual, vr_mercado_actual_base,
  //   pyg_base, pyg_pct, actualizado_el, notas
  if (shI && shI.getLastRow() <= 1) {
    const trm = 4100; // TRM aproximada COP/USD
    const inv = [
      // ETF S&P 500: compra a 490 USD, precio actual 582 USD
      ['INV_01', D(2026,1,15), 'Nu', 'Trii', 'Compra',
       'NYSEARCA:SPY', 'ETF S&P 500', 3,
       490, 'USD', trm, 3*490*trm,
       'GOOGLEFINANCE', 582, 'USD', trm, 582*trm, 3*582, 3*582*trm,
       3*(582-490)*trm, ((582-490)/490*100), now, 'Aporte mensual $500k COP'],
      // Bitcoin: compra a 85000 USD, precio actual 95000 USD
      ['INV_02', D(2026,2,1), 'Nu', 'Trii', 'Compra',
       'BTC-USD', 'Bitcoin', 0.01,
       85000, 'USD', trm, 0.01*85000*trm,
       'MANUAL', 95000, 'USD', trm, 95000*trm, 0.01*95000, 0.01*95000*trm,
       0.01*(95000-85000)*trm, ((95000-85000)/85000*100), now, 'Exposición mínima'],
    ];
    shI.getRange(2, 1, inv.length, inv[0].length).setValues(inv);
  }

  // ── Recalcular saldos desde los movimientos recién cargados ──
  try { syncAccountBalances_(ss, null, true); } catch(e) { Logger.log('syncBalance demo: ' + e); }
}

function normalizeType_(t) {
  const s = String(t||'').toLowerCase().trim();
  if (['income','ingreso'].includes(s))        return 'income';
  if (['expense','egreso','gasto','gastos'].includes(s)) return 'expense';
  if (['transfer','transferencia'].includes(s)) return 'transfer';
  if (['investment','inversión','inversion','inversiones'].includes(s)) return 'investment';
  return s;
}

function parseNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const cleaned = String(v)
    .trim()
    .replace(/\s/g, '')
    .replace(/\((.*)\)/, '-$1')
    .replace(/[^\d.,-]/g,'');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = /,\d{3}$/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (lastDot >= 0) {
    normalized = /\.\d{3}$/.test(cleaned) ? cleaned.replace(/\./g, '') : cleaned;
  }
  const n = parseFloat(normalized);
  return isFinite(n) ? n : 0;
}

function fmtDate_(d, fmt) { return Utilities.formatDate(d, CFG.TZ, fmt); }

function parseSheetDate_(value) {
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed) ? null : parsed;
}

function normalizeGroupLabel_(value) {
  const type = normalizeType_(value);
  if (type === 'income') return 'ingreso';
  if (type === 'transfer') return 'transferencia';
  if (type === 'investment') return 'transferencia';
  return 'gasto';
}

/**
 * Calcula los saldos por cuenta a partir de los movimientos.
 *
 * IMPORTANTE: por defecto NO escribe en la hoja (persist=false). Antes esta
 * función hacía hasta 3 setValue por cuenta EN CADA carga del dashboard, y si
 * una recarga se interrumpía o pisaba a otra, dejaba saldos corruptos (a veces
 * 0). Eso causaba el síntoma "recargo dos veces y se va a $0". Ahora el
 * dashboard sólo LEE; la escritura se hace explícitamente (persist=true) desde
 * acciones puntuales, no en cada render.
 *
 * @param {Spreadsheet} ss
 * @param {string} mes
 * @param {boolean} [persist=false] Si true, escribe los saldos calculados.
 */
function syncAccountBalances_(ss, mes, persist) {
  const spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  const shMov = spreadsheet.getSheetByName(CFG.SHEETS.MOV);
  const shAcc = spreadsheet.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!shMov || !shAcc) return { byAccountMonth: {} };

  // Sólo aseguramos columnas cuando vamos a escribir (ensureColumn_ muta la hoja).
  const baseCol  = persist ? ensureColumn_(shAcc, 'saldo_inicial') : _colIndex_(shAcc, 'saldo_inicial');
  const deltaCol = persist ? ensureColumn_(shAcc, 'variacion_mes') : _colIndex_(shAcc, 'variacion_mes');
  const syncCol  = persist ? ensureColumn_(shAcc, 'actualizado_el') : _colIndex_(shAcc, 'actualizado_el');

  const accData = shAcc.getDataRange().getValues();
  const hdrAcc = rowToObj_(accData[0]);
  const monthKey = mes || fmtDate_(new Date(), 'yyyy-MM');
  const txns = readSheet_(shMov);
  const baseByAcc = {};
  const rowByAcc = {};

  for (let r = 1; r < accData.length; r++) {
    const name = String(accData[r][hdrAcc.nombre] || '').trim();
    if (!name) continue;
    rowByAcc[name] = r + 1;
    const currentBase = baseCol != null ? parseNum_(accData[r][baseCol]) : 0;
    if (baseCol != null && !currentBase && accData[r][baseCol] === '' && hdrAcc.saldo != null) {
      const seed = parseNum_(accData[r][hdrAcc.saldo]);
      if (persist) shAcc.getRange(r + 1, baseCol + 1).setValue(seed);
      baseByAcc[name] = seed;
    } else if (baseCol != null) {
      baseByAcc[name] = currentBase;
    } else {
      // Sin columna saldo_inicial: usar el saldo actual como base.
      baseByAcc[name] = hdrAcc.saldo != null ? parseNum_(accData[r][hdrAcc.saldo]) : 0;
    }
  }

  const totals = {};
  const monthly = {};
  const apply = (accountName, totalDelta, monthDelta, kind) => {
    const account = String(accountName || '').trim();
    if (!account) return;
    if (totals[account] == null) totals[account] = 0;
    totals[account] += totalDelta;
    if (!monthly[account]) monthly[account] = { net: 0, income: 0, expense: 0, transfer: 0 };
    monthly[account].net += monthDelta;
    if (kind && monthly[account][kind] != null) monthly[account][kind] += Math.abs(monthDelta);
  };

  txns.forEach(txn => {
    const rawMonto = parseNum_(txn.monto || txn.amount || 0);
    const rawType = normalizeType_(txn.grupo || txn.tipo || txn.type || '');
    const knownT = ['income','expense','transfer','investment'];
    const catT = String(txn.categoría || txn.categoria || '').toLowerCase();
    let type = rawType;
    if (!knownT.includes(type)) {
      if (['ingresos','ingreso','nomina','salario'].some(k => catT.includes(k))) type = 'income';
      else if (['transferencia','traslado'].some(k => catT.includes(k))) type = 'transfer';
      else type = rawMonto >= 0 ? 'income' : 'expense';
    }
    const amount = Math.abs(rawMonto);
    const origin = String(txn.cuenta_origen || txn.cuenta || '').trim();
    const dest = String(txn.cuenta_destino || '').trim();
    const date = parseSheetDate_(txn.fecha);
    const inMonth = date instanceof Date && fmtDate_(date, 'yyyy-MM') === monthKey;

    if (type === 'income') {
      apply(origin, amount, inMonth ? amount : 0, 'income');
      return;
    }
    if (type === 'expense') {
      apply(origin, -amount, inMonth ? -amount : 0, 'expense');
      return;
    }
    if (type === 'transfer' || type === 'investment') {
      apply(origin, -amount, inMonth ? -amount : 0, 'transfer');
      apply(dest, amount, inMonth ? amount : 0, 'transfer');
    }
  });

  const balances = {};
  Object.keys(rowByAcc).forEach(name => {
    const newBalance = (baseByAcc[name] || 0) + (totals[name] || 0);
    balances[name] = newBalance;
    if (persist) {
      const row = rowByAcc[name];
      if (hdrAcc.saldo != null) shAcc.getRange(row, hdrAcc.saldo + 1).setValue(newBalance);
      if (deltaCol != null) shAcc.getRange(row, deltaCol + 1).setValue((monthly[name] && monthly[name].net) || 0);
      if (syncCol != null) shAcc.getRange(row, syncCol + 1).setValue(new Date());
    }
  });

  return { byAccountMonth: monthly, balances: balances };
}

/**
 * Índice (0-based) de una columna por nombre normalizado, o null si no existe.
 * No muta la hoja (a diferencia de ensureColumn_).
 */
function _colIndex_(sh, headerName) {
  if (!sh || sh.getLastColumn() < 1) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = rowToObj_(headers);
  const key = normalizeKey_(headerName);
  return map[key] != null ? map[key] : null;
}

/**
 * Persiste los saldos calculados en la hoja Cuentas. Llamar SOLO desde acciones
 * explícitas (registrar/editar/eliminar movimiento, cierre de mes), nunca en
 * cada render del dashboard.
 */
function persistirSaldosCuentas(mes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = syncAccountBalances_(ss, mes, true);
  clearCacheForMonth();
  return { ok: true, balances: r.balances || {} };
}

function nextEmpty_(sh, startRow) {
  const last = sh.getLastRow();
  if (last < startRow) return startRow;
  const col = sh.getRange(startRow, 1, last - startRow + 1, 1).getValues();
  for (let i = 0; i < col.length; i++) if (String(col[i][0]).trim() === '') return startRow + i;
  return last + 1;
}

function stripEmoji_(s) {
  return String(s||'').replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[\u2600-\u27BF]/g,'').trim();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function csvBuild_(rows) {
  return rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
}

// ═══════════════════════════════════════════════════════
// SERIES & BUDGET HELPERS
// ═══════════════════════════════════════════════════════
function buildSeries_(txns, mesActual, tz) {
  const monthly = {}, daily = {};
  const [y0, m0] = mesActual.split('-').map(Number);

  // 12 meses hacia atrás
  for (let k = 11; k >= 0; k--) {
    let yy = y0, mm = m0 - k;
    while (mm <= 0) { mm += 12; yy--; }
    monthly[`${yy}-${String(mm).padStart(2,'0')}`] = { inc:0, exp:0, sav:0 };
  }

  // Días del mes actual
  const first = new Date(mesActual + '-01T00:00:00');
  const last2  = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  for (let d = 1; d <= last2.getDate(); d++) {
    daily[`${mesActual}-${String(d).padStart(2,'0')}`] = { inc:0, exp:0 };
  }

  txns.forEach(r => {
    if (!(r.date instanceof Date)) return;
    const mm  = fmtDate_(r.date, 'yyyy-MM');
    const dd  = fmtDate_(r.date, 'yyyy-MM-dd');
    const amt = parseNum_(r.amount_base);
    const t   = normalizeType_(r.type);

    if (monthly[mm]) {
      if (t === 'income')  monthly[mm].inc += amt;
      if (t === 'expense') monthly[mm].exp += amt;
    }
    if (daily[dd] && mm === mesActual) {
      if (t === 'income')  daily[dd].inc += amt;
      if (t === 'expense') daily[dd].exp += amt;
    }
  });

  const mKeys = Object.keys(monthly).sort();
  mKeys.forEach(k => { monthly[k].sav = monthly[k].inc - monthly[k].exp; });

  const dKeys = Object.keys(daily).sort();

  return {
    monthly: {
      labels:   mKeys,
      income:   mKeys.map(k => monthly[k].inc),
      expense:  mKeys.map(k => monthly[k].exp),
      savings:  mKeys.map(k => monthly[k].sav)
    },
    daily: {
      labels:   dKeys.map(d => d.slice(8)),
      income:   dKeys.map(k => daily[k].inc),
      expense:  dKeys.map(k => daily[k].exp),
      net:      dKeys.map(k => daily[k].inc - daily[k].exp)
    }
  };
}

function buildBudget_(ss, mes, txns, tz) {
  const sh = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
  if (!sh) return { items: [], totalPlan: 0, totalReal: 0, rows: [], monthly: [] };
  const rows = readSheet_(sh).filter(r => r.activo !== false && String(r.activo) !== 'false');

  // Filtrar por período: incluir 'monthly', sin periodo, o coincidencia exacta
  let budgetRows = rows.filter(r => {
    const p = String(r.periodo || '').trim();
    return !p || p === 'monthly' || p === mes;
  });
  // Fallback: si no hay presupuesto permanente, usar el más reciente período con fecha
  if (!budgetRows.length && rows.length) {
    const periods = [...new Set(
      rows.map(r => String(r.periodo || '').trim()).filter(p => /^\d{4}-\d{2}$/.test(p))
    )].sort().reverse();
    budgetRows = periods.length
      ? rows.filter(r => String(r.periodo || '').trim() === periods[0])
      : rows;
  }

  // Deduplicar: si mismo cat tiene fila mensual (monthly/vacía) y fila específica (yyyy-MM),
  // la fila específica del mes tiene prioridad.
  const catBest = {};
  budgetRows.forEach(b => {
    const cat = String(b.categoría || b.categoria || '').trim();
    const p = String(b.periodo || '').trim();
    if (!catBest[cat] || p === mes) catBest[cat] = b;
  });
  budgetRows = Object.values(catBest);

  // Real por categoría del mes
  const real = {};
  txns.filter(r => r.date instanceof Date && fmtDate_(r.date, 'yyyy-MM') === mes
                 && normalizeType_(r.type) === 'expense')
      .forEach(r => {
        const c = String(r.category||'Otros').trim();
        real[c] = (real[c]||0) + parseNum_(r.amount_base);
      });

  const items = budgetRows.map(b => {
    const cat   = String(b.categoría || b.categoria || '').trim();
    const plan  = parseNum_(b.límite || b.limite);
    const spent = real[cat] || 0;
    return {
      id: String(b.presupuesto_id || ''),
      cat,
      plan,
      spent,
      periodo: String(b.periodo || 'monthly'),
      alerta: parseNum_(b.alerta_pct) || 80,
      activo: b.activo !== false && String(b.activo) !== 'false',
      pct: plan > 0 ? spent/plan*100 : null
    };
  }).filter(i => i.plan > 0); // Solo mostrar si tiene límite > 0

  const rowsDetailed = rows.map(b => ({
    id: String(b.presupuesto_id || ''),
    cat: String(b.categoría || b.categoria || '').trim(),
    periodo: String(b.periodo || '').trim(),
    plan: parseNum_(b.límite || b.limite),
    alerta: parseNum_(b.alerta_pct) || 80,
    activo: b.activo !== false && String(b.activo) !== 'false'
  }));

  const monthly = buildBudgetMonthlySeries_(rowsDetailed, txns, tz);

  return {
    items,
    rows: rowsDetailed,
    monthly,
    totalPlan: items.reduce((s,i) => s + i.plan, 0),
    totalReal: items.reduce((s,i) => s + i.spent, 0)
  };
}

function buildBudgetMonthlySeries_(budgetRows, txns, tz) {
  const months = {};
  (budgetRows || []).forEach(row => {
    const month = String(row.periodo || '').slice(0, 7);
    if (!month) return;
    if (!months[month]) months[month] = { plan: 0, actual: 0 };
    months[month].plan += parseNum_(row.plan);
  });

  (txns || []).forEach(txn => {
    if (!(txn.date instanceof Date) || normalizeType_(txn.type) !== 'expense') return;
    const month = fmtDate_(txn.date, 'yyyy-MM');
    if (!months[month]) months[month] = { plan: 0, actual: 0 };
    months[month].actual += parseNum_(txn.amount_base);
  });

  const labels = Object.keys(months).sort().slice(-12);
  return {
    labels,
    plan: labels.map(label => months[label].plan || 0),
    actual: labels.map(label => months[label].actual || 0)
  };
}

function buildPeriodSummaries_(txns, mes, tz) {
  const now = new Date();
  const monthStart = new Date(`${mes}-01T00:00:00`);
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const year = String(mes || fmtDate_(now, 'yyyy-MM')).slice(0, 4);
  const yearStart = new Date(`${year}-01-01T00:00:00`);
  const nextYear = new Date(Number(year) + 1, 0, 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const summarize = rows => {
    const income = rows.filter(r => normalizeType_(r.type) === 'income').reduce((s, r) => s + parseNum_(r.amount_base), 0);
    const expense = rows.filter(r => normalizeType_(r.type) === 'expense').reduce((s, r) => s + parseNum_(r.amount_base), 0);
    const transfer = rows.filter(r => ['transfer','investment'].includes(normalizeType_(r.type))).reduce((s, r) => s + parseNum_(r.amount_base), 0);
    return { income, expense, transfer, net: income - expense, count: rows.length };
  };

  const monthRows = txns.filter(r => r.date instanceof Date && r.date >= monthStart && r.date < nextMonth);
  const yearRows = txns.filter(r => r.date instanceof Date && r.date >= yearStart && r.date < nextYear);
  const weekRows = txns.filter(r => r.date instanceof Date && r.date >= weekStart && r.date <= now);

  return {
    week: summarize(weekRows),
    month: summarize(monthRows),
    year: summarize(yearRows),
    weekSeries: buildWeeklyBreakdown_(weekRows)
  };
}

function buildWeeklyBreakdown_(rows) {
  const labels = [];
  const map = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = fmtDate_(d, 'yyyy-MM-dd');
    labels.push(key);
    map[key] = { income: 0, expense: 0 };
  }

  (rows || []).forEach(r => {
    if (!(r.date instanceof Date)) return;
    const key = fmtDate_(r.date, 'yyyy-MM-dd');
    if (!map[key]) return;
    const amount = parseNum_(r.amount_base);
    const type = normalizeType_(r.type);
    if (type === 'income') map[key].income += amount;
    if (type === 'expense') map[key].expense += amount;
  });

  return {
    labels: labels.map(l => l.slice(8)),
    income: labels.map(l => map[l].income),
    expense: labels.map(l => map[l].expense),
    net: labels.map(l => map[l].income - map[l].expense)
  };
}

function buildInv_(sh) {
  const empty = { detalle: [], totalMercado: 0, porTipo: [] };
  if (!sh) return empty;
  const rows = readSheet_(sh);
  if (!rows.length) return empty;

  const byAsset = {};
  rows.forEach(r => {
    const qty = parseNum_(r.quantity), price = parseNum_(r.current_price);
    if (!qty || !price) return;
    const id  = String(r.asset_id||r.pos_id||'?');
    if (!byAsset[id]) byAsset[id] = { id, qty:0, cost:0, price, type: r.type||'otro' };
    byAsset[id].qty  += qty;
    byAsset[id].cost += qty * parseNum_(r.avg_cost);
  });

  let total = 0;
  const detalle = Object.values(byAsset).map(a => {
    const val = a.qty * a.price;
    total += val;
    return { activo: a.id, tipo: a.type, valor: val, pnl: val - a.cost, qty: a.qty, precio: a.price };
  }).sort((a,b) => b.valor - a.valor);

  const tipoMap = {};
  const brokerMap = {};
  detalle.forEach(d => {
    tipoMap[d.tipo] = (tipoMap[d.tipo]||0) + d.vr_mercado_actual_base;
    brokerMap[d.broker] = (brokerMap[d.broker]||0) + d.vr_mercado_actual_base;
  });
  const porTipo = Object.entries(tipoMap).map(([t,v]) => ({ tipo:t, valor:v, pct: total>0?v/total*100:0 }));
  const porBroker = Object.entries(brokerMap).map(([b,v]) => ({ broker:b, valor:v, pct: total>0?v/total*100:0 }));

  return { detalle, totalMercado: total, porTipo, porBroker };
}

// ═══════════════════════════════════════════════════════
// GOOGLE FINANCE - PRECIOS AUTOMÁTICOS
// ═══════════════════════════════════════════════════════

/**
 * Obtiene el precio actual de un activo usando Google Finance o Yahoo Finance
 * @param {string} ticker - Ticker del activo (ej: NASDAQ:AAPL, NYSEARCA:SPY)
 * @param {string} fuente - GOOGLEFINANCE o MANUAL
 * @returns {{precio: number, moneda: string, actualizado: Date, error: string}}
 */
function obtenerPrecioAutomatico(ticker, fuente) {
  if (!ticker || fuente?.toUpperCase() !== 'GOOGLEFINANCE') {
    return { precio: null, moneda: null, actualizado: null, error: 'Fuente manual o sin ticker' };
  }

  const tickerLimpio = String(ticker).trim().toUpperCase();
  
  // Intentar Yahoo Finance primero (más confiable)
  try {
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(tickerLimpio);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const json = JSON.parse(res.getContentText());
    
    if (json?.quoteResponse?.result?.[0]) {
      const quote = json.quoteResponse.result[0];
      const precio = quote.regularMarketPrice || quote.previousClose;
      const currency = quote.currency || 'USD';
      return {
        precio: precio,
        moneda: currency,
        actualizado: new Date(),
        fuente: 'YAHOO'
      };
    }
  } catch(e) {
    Logger.log('Yahoo Finance error para ' + tickerLimpio + ': ' + e.message);
  }

  // Fallback: Google Finance (más limitado)
  try {
    const gfFormula = '=GOOGLEFINANCE("' + tickerLimpio + '", "price")';
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const cell = sheet.getRange('A1');
    cell.setFormula(gfFormula);
    Utilities.sleep(500);
    const price = cell.getValue();
    cell.clearContent();
    
    if (price && isFinite(price) && price > 0) {
      return {
        precio: parseFloat(price),
        moneda: 'USD',
        actualizado: new Date(),
        fuente: 'GOOGLEFINANCE'
      };
    }
  } catch(e) {
    Logger.log('Google Finance error para ' + tickerLimpio + ': ' + e.message);
  }

  return { precio: null, moneda: null, actualizado: null, error: 'No se pudo obtener precio' };
}

/**
 * Obtiene la TRM (Tasa Representativa del Mercado) USD a COP
 * @returns {number} TRM actual
 */
function obtenerTRM() {
  try {
    // Fuente: Banco de la República de Colombia
    const url = 'https://www.banrep.gov.co/webservice/rest/v1/cuenta/4';
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    
    if (json?.valor) {
      return parseFloat(json.valor);
    }
  } catch(e) {
    Logger.log('Error TRM Banrep: ' + e.message);
  }

  // Fallback: Yahoo Finance USD/COP
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDCOP=X';
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    
    if (json?.chart?.result?.[0]?.meta?.regularMarketPrice) {
      return parseFloat(json.chart.result[0].meta.regularMarketPrice);
    }
  } catch(e) {
    Logger.log('Error TRM Yahoo: ' + e.message);
  }

  // Fallback: Google Finance USD/COP
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const cell = sheet.getRange('Z999');
    cell.setFormula('=GOOGLEFINANCE("USDCOP", "price")');
    Utilities.sleep(500);
    const trm = cell.getValue();
    cell.clearContent();
    if (trm && isFinite(trm) && trm > 0) return parseFloat(trm);
  } catch(e) {
    Logger.log('Error TRM Google: ' + e.message);
  }

  // Default fallback
  return 4000;
}

/**
 * Actualiza todos los precios de inversiones automáticamente
 */
function actualizarPreciosInversiones() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!sh) throw new Error('Hoja Inversiones no existe');

  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);
  
  let actualizados = 0;
  let manuales = 0;
  let errores = 0;
  const trm = obtenerTRM();
  
  // Actualizar TRM en hoja de config
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  if (shCfg) {
    const cfgData = shCfg.getDataRange().getValues();
    const cfgHdr = rowToObj_(cfgData[0]);
    for (let r = 1; r < cfgData.length; r++) {
      if (String(cfgData[r][cfgHdr.clave] || '') === 'trm_usd_cop') {
        shCfg.getRange(r + 1, cfgHdr.valor + 1).setValue(trm);
        shCfg.getRange(r + 1, cfgHdr.valor + 2).setValue(new Date());
        break;
      }
    }
  }

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const fuente = String(row[hdr.fuente_precio] || '').toUpperCase();
    const ticker = String(row[hdr.ticker] || '').trim();
    
    if (fuente !== 'GOOGLEFINANCE' || !ticker) {
      manuales++;
      continue;
    }

    const resultado = obtenerPrecioAutomatico(ticker, fuente);
    
    if (resultado.precio && resultado.precio > 0) {
      const precioActual = resultado.precio;
      const cantidad = parseNum_(row[hdr.cantidad]);
      const vrActualBase = precioActual * cantidad * trm;
      
      // Actualizar celdas
      sh.getRange(r + 1, hdr.precio_actual + 1).setValue(precioActual);
      sh.getRange(r + 1, hdr.moneda_actual + 1).setValue(resultado.moneda);
      sh.getRange(r + 1, hdr.trm_actual + 1).setValue(trm);
      sh.getRange(r + 1, hdr.precio_actual_base + 1).setValue(precioActual * trm);
      sh.getRange(r + 1, hdr.vr_mercado_actual + 1).setValue(precioActual * cantidad);
      sh.getRange(r + 1, hdr.vr_mercado_actual_base + 1).setValue(vrActualBase);
      
      // Calcular PyG
      const vrMercadoCompraBase = parseNum_(row[hdr.vr_mercado_compra]);
      const pygBase = vrActualBase - vrMercadoCompraBase;
      const pygPct = vrMercadoCompraBase > 0 ? (pygBase / vrMercadoCompraBase) * 100 : 0;
      
      sh.getRange(r + 1, hdr.pyg_base + 1).setValue(pygBase);
      sh.getRange(r + 1, hdr.pyg_pct + 1).setValue(pygPct);
      sh.getRange(r + 1, hdr.actualizado_el + 1).setValue(new Date());
      
      actualizados++;
    } else {
      errores++;
      Logger.log('Error actualizando ' + ticker + ': ' + resultado.error);
    }
  }

  // Limpiar cache
  clearCacheForMonth();

  return { ok: true, actualizados, manuales, errores, trm, timestamp: new Date() };
}

/**
 * Construye datos de inversiones con estructura nueva
 */
function buildInvEs_(sh) {
  const empty = { detalle: [], totalMercado: 0, porTipo: [], porBroker: [] };
  if (!sh) return empty;
  
  const rows = readSheet_(sh);
  if (!rows.length) return empty;

  let total = 0;
  const detalle = rows.map(r => {
    const cantidad       = parseNum_(r.cantidad)        || 0;
    const precioCompra   = parseNum_(r.precio_compra)   || 0;
    const precioActual   = parseNum_(r.precio_actual)   || precioCompra;
    const trmCompra      = parseNum_(r.trm_compra)      || 4000;
    const trmActual      = parseNum_(r.trm_actual)      || trmCompra || 4000;
    const monedaCompra   = String(r.moneda_compra   || 'USD').toUpperCase();
    const monedaActual   = String(r.moneda_actual   || monedaCompra).toUpperCase();

    // Precio en COP base
    const precioCompraBase  = monedaCompra === 'COP' ? precioCompra  : precioCompra  * trmCompra;
    const precioActualBase  = monedaActual === 'COP' ? precioActual  : precioActual  * trmActual;

    // Valores de mercado: usar columna almacenada si existe, calcular si no
    const vrMercadoCompra    = parseNum_(r.vr_mercado_compra)      || (cantidad * precioCompraBase);
    const vrActualBase       = parseNum_(r.vr_mercado_actual_base) || (cantidad * precioActualBase);

    // PyG: usar columna almacenada si existe, calcular si no
    const pygBase = parseNum_(r.pyg_base) !== 0
      ? parseNum_(r.pyg_base)
      : vrActualBase - vrMercadoCompra;
    const pygPct  = parseNum_(r.pyg_pct)  !== 0
      ? parseNum_(r.pyg_pct)
      : (vrMercadoCompra > 0 ? (pygBase / vrMercadoCompra) * 100 : 0);

    total += vrActualBase;

    return {
      inversion_id:           String(r.inversion_id || ''),
      fecha_compra:           r.fecha_compra,
      cuenta:                 String(r.cuenta    || ''),
      broker:                 String(r.broker    || 'Sin Broker'),
      operacion:              String(r.operacion || 'Compra'),
      ticker:                 String(r.ticker    || r.simbolo || ''),
      activo:                 String(r.activo    || ''),
      cantidad,
      precio_compra:          precioCompra,
      moneda_compra:          monedaCompra,
      trm_compra:             trmCompra,
      vr_mercado_compra:      vrMercadoCompra,
      fuente_precio:          String(r.fuente_precio || 'MANUAL'),
      precio_actual:          precioActual,
      moneda_actual:          monedaActual,
      trm_actual:             trmActual,
      precio_actual_base:     precioActualBase,
      vr_mercado_actual:      parseNum_(r.vr_mercado_actual) || (cantidad * precioActual),
      vr_mercado_actual_base: vrActualBase,
      pyg_base:               pygBase,
      pyg_pct:                pygPct,
      actualizado_el:         r.actualizado_el,
      notas:                  String(r.notas || '')
    };
  }).filter(d => d.activo && d.cantidad > 0);

  // Agrupar por broker para estadísticas
  const tipoMap = {};
  const brokerMap = {};
  const operacionMap = {};
  
  detalle.forEach(d => {
    // Determinar tipo por ticker
    let tipo = 'Otro';
    const ticker = d.ticker?.toUpperCase() || '';
    if (ticker.includes('ETF')) tipo = 'ETF';
    else if (ticker.includes('NASDAQ') || ticker.includes('NYSE')) tipo = 'Accion';
    else if (d.activo.toLowerCase().includes('crypto') || d.activo.toLowerCase().includes('btc')) tipo = 'Cripto';
    else if (d.activo.toLowerCase().includes('bono')) tipo = 'Bono';
    else if (d.operacion === 'Venta') tipo = 'Venta';
    
    tipoMap[tipo] = (tipoMap[tipo]||0) + d.vr_mercado_actual_base;
    brokerMap[d.broker] = (brokerMap[d.broker]||0) + d.vr_mercado_actual_base;
  });

  const porTipo = Object.entries(tipoMap).map(([t, v]) => ({ tipo: t, valor: v, pct: total > 0 ? v/total*100 : 0 }));
  const porBroker = Object.entries(brokerMap).map(([b, v]) => ({ broker: b, valor: v, pct: total > 0 ? v/total*100 : 0 }));

  return { detalle, totalMercado: total, porTipo, porBroker };
}

// ═══════════════════════════════════════════════════════
// EXTRACCIÓN DE EMAIL
// ═══════════════════════════════════════════════════════
function extractAmount_(text) {
  // Patrones específicos para correos colombianos (más precisos primero)
  const patterns = [
    // Nu bank: "La cantidad de: $217.100,00"
    /cantidad\s*de\s*[:\s]*\$?\s*([\d.,]+)/i,
    // Bancolombia, Davivienda, etc.: "valor de $1.234.567", "por $1.234.567"
    /(?:valor|monto|total|cobro|pago|precio|transacci[oó]n|compra|d[eé]bito|cr[eé]dito|importe|cargo|deduccion|descuento|retiro|consignaci[oó]n)\s*[:\s]*(?:de\s*)?(?:COP\s*)?\$?\s*([\d.,]+)/i,
    // Monto al inicio: "$1.234.567"
    /\$\s*([\d.,]+)/,
    // Con moneda explícita
    /COP\s*([\d.,]+)/i,
    /USD\s*([\d.,]+)/i,
    /EUR\s*([\d.,]+)/i,
    /([\d.,]+)\s*COP/i,
    // Número grande solo (≥3 o 4 dígitos, posible monto)
    /\b(\d{3,4}(?:[.,]\d{3})*(?:[.,]\d{2})?)\b/
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseNum_(m[1]);  // parseNum_ maneja formatos COP/EUR/USD
      if (n > 0 && n < 1e11) return n;
    }
  }
  return 0;
}

function extractCurrency_(text) {
  // En Colombia, $ = COP. Solo retornar USD/EUR si es explícito.
  if (/\bUSD\b|US\$|\bdólares?\b/i.test(text)) return 'USD';
  if (/\bEUR\b|\beuros?\b/i.test(text))         return 'EUR';
  return 'COP';
}

function extractMerchant_(from, subject) {
  // Mapeo directo de dominios/nombres de bancos y servicios colombianos
  const bankMap = [
    ['bancolombia',   'Bancolombia'],
    ['davivienda',    'Davivienda'],
    ['nequi',         'Nequi'],
    ['daviplata',     'Daviplata'],
    ['bbva',          'BBVA Colombia'],
    ['scotiabank',    'Scotiabank Colpatria'],
    ['itau',          'Itaú'],
    ['bogota',        'Banco de Bogotá'],
    ['occidente',     'Banco de Occidente'],
    ['popular',       'Banco Popular'],
    ['falabella',     'Falabella'],
    ['rappi',         'Rappi'],
    ['nubank',        'Nu Colombia'],
    ['nu.com',        'Nu Colombia'],
    ['lulo',          'Lulo Bank'],
    ['paypal',        'PayPal'],
    ['mercadopago',   'MercadoPago'],
    ['adyen',         'Pago en línea'],
    ['stripe',        'Pago en línea'],
    ['claro',         'Claro'],
    ['movistar',      'Movistar'],
    ['tigo',          'Tigo'],
    ['directv',       'DirecTV'],
    ['netflix',       'Netflix'],
    ['spotify',       'Spotify'],
    ['amazon',        'Amazon'],
    ['apple',         'Apple'],
    ['google',        'Google'],
    ['uber',          'Uber'],
    ['didi',          'DiDi'],
    ['ifood',         'iFood'],
    ['domicilios',    'Domicilios.com']
  ];

  const fromLower = String(from || '').toLowerCase();
  for (const [key, name] of bankMap) {
    if (fromLower.includes(key)) return name;
  }

  // Patrones en el asunto: "Compra en COMERCIO", "*MERCHANT*", "Pago a COMERCIO"
  const subjectPatterns = [
    /\*([A-Z][A-Z0-9 ]{2,25})\*/,
    /(?:compra\s+en|pago\s+(?:en|a)|establecimiento[:\s]+)([A-Za-zÀ-ú][^,\n.]{2,30})/i,
    /(?:recibo\s+de|factura\s+de)[:\s]+([A-Za-zÀ-ú][^,\n.]{2,30})/i
  ];
  for (const p of subjectPatterns) {
    const m = subject.match(p);
    if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 40);
  }

  // Nombre del remitente entre comillas o antes de <
  const emailMatch = from.match(/^"?([^"<@]+)"?\s*</);
  if (emailMatch) {
    const name = emailMatch[1].trim();
    return name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  // Primeras palabras significativas del asunto
  const cleanSubject = subject.replace(/^(RE|FWD|RE:FWD):\s*/i, '').trim();
  const words = cleanSubject.split(/[\s\-|:,]+/)
    .filter(w => w.length > 2 && !/^\d+$/.test(w) && !/^[%$]/.test(w))
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  return words.slice(0, 3).join(' ') || from.split('@')[0] || 'Desconocido';
}

// ═══════════════════════════════════════════════════════
// DIAGNÓSTICO — por qué el dashboard sale vacío ($0 / sin gráficas)
// ═══════════════════════════════════════════════════════
/**
 * Reporta el estado real de cada hoja y del dataset. Llamable desde la UI.
 * Sirve para saber si el problema es "hojas vacías", "hoja mal nombrada" o
 * "error de lectura", en vez de mostrar $0 en silencio.
 */
function diagnosticarDatos() {
  const out = { ok: true, hojas: {}, problemas: [], resumen: {} };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    out.spreadsheet = { nombre: ss.getName(), id: ss.getId() };

    const existentes = ss.getSheets().map(s => s.getName());
    out.hojasExistentes = existentes;

    Object.keys(CFG.SHEETS).forEach(k => {
      const nombre = CFG.SHEETS[k];
      const sh = ss.getSheetByName(nombre);
      if (!sh) {
        out.hojas[nombre] = { existe: false, filas: 0 };
        out.problemas.push('Falta la hoja "' + nombre + '"');
        return;
      }
      const filas = Math.max(0, sh.getLastRow() - 1); // sin encabezado
      const headers = sh.getLastColumn() > 0
        ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim())
        : [];
      out.hojas[nombre] = { existe: true, filas: filas, columnas: headers };
    });

    const movs = readSheet_(ss.getSheetByName(CFG.SHEETS.MOV));
    const ctas = readSheet_(ss.getSheetByName(CFG.SHEETS.CUENTAS));
    out.resumen.movimientos = movs.length;
    out.resumen.cuentas = ctas.length;

    if (movs.length === 0) out.problemas.push('La hoja Movimientos no tiene datos → dashboard en $0. Usa "Cargar datos de ejemplo" o registra un movimiento.');
    if (ctas.length === 0) out.problemas.push('La hoja Cuentas no tiene cuentas → Capital total $0.');

    // ¿Qué meses tienen movimientos? (ayuda si el filtro está en un mes sin datos)
    const meses = {};
    movs.forEach(m => {
      const f = parseSheetDate_(m.fecha);
      if (f instanceof Date && !isNaN(f)) {
        const key = fmtDate_(f, 'yyyy-MM');
        meses[key] = (meses[key] || 0) + 1;
      }
    });
    out.resumen.mesesConDatos = meses;
    out.resumen.mesActual = fmtDate_(new Date(), 'yyyy-MM');
    if (movs.length > 0 && !meses[out.resumen.mesActual]) {
      out.problemas.push('Hay movimientos pero NINGUNO en el mes actual (' + out.resumen.mesActual + '). El dashboard filtra por mes: cambia el selector de mes/año a uno con datos: ' + Object.keys(meses).join(', '));
    }

    out.ok = out.problemas.length === 0;
  } catch (e) {
    out.ok = false;
    out.error = String(e);
    out.stack = String(e.stack || '');
  }
  return _sanitizeForClient_(out);
}

/**
 * EJECUTAR DESDE EL EDITOR de Apps Script (selecciona esta función y ▷ Ejecutar).
 * Imprime en el Registro de ejecución el diagnóstico completo Y el resultado
 * real de getDataAPI, capturando cualquier error con su stack. Sirve para ver
 * exactamente por qué el dashboard sale vacío.
 */
function DEBUG_dashboard() {
  Logger.log('======== DIAGNÓSTICO DE DATOS ========');
  var diag = diagnosticarDatos();
  Logger.log(JSON.stringify(diag, null, 2));

  Logger.log('======== PRUEBA getDataAPI (mes actual) ========');
  try {
    var mes = fmtDate_(new Date(), 'yyyy-MM');
    var d = getDataAPI(mes);
    if (d && d.error) {
      Logger.log('getDataAPI DEVOLVIÓ ERROR: ' + d.error);
    } else if (!d) {
      Logger.log('getDataAPI DEVOLVIÓ null/undefined');
    } else {
      Logger.log('getDataAPI OK. KPIs: ' + JSON.stringify(d.kpis));
      Logger.log('Movimientos en historial: ' + ((d.historial || []).length));
      Logger.log('Cuentas: ' + ((d.accounts || []).length));
      Logger.log('Categorías con gasto: ' + Object.keys(d.byCat || {}).length);
    }
  } catch (e) {
    Logger.log('getDataAPI LANZÓ EXCEPCIÓN: ' + e + '\n' + (e.stack || ''));
  }
  Logger.log('======== FIN ========');
  return diag;
}

/**
 * Auto-reparación: si Movimientos está vacía, carga datos de ejemplo para que
 * el dashboard y las gráficas se vean. Devuelve el diagnóstico actualizado.
 */
function cargarDatosDeEjemplo() {
  try {
    // Asegurar estructura de hojas antes de sembrar.
    if (typeof inicializarProyecto === 'function') {
      try { inicializarProyecto({ demo: false }); } catch (e) { Logger.log('init: ' + e); }
    }
    cargarDatosDemo_();
    clearCacheForMonth();
    return { ok: true, diagnostico: diagnosticarDatos() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ═══════════════════════════════════════════════════════
// CACHE HELPERS
// ═══════════════════════════════════════════════════════
/**
 * Token de versión del caché de datos. Va incluido en cada clave de caché de
 * datos (data_v2, dataLight, etc.). Para invalidar TODO el caché de datos sin
 * tener que enumerar las claves (removeAll requiere un array de claves, no se
 * puede vaciar todo), basta con incrementar este token: las claves viejas
 * quedan inalcanzables al instante.
 */
function _cacheVersion_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('CACHE_VER') || '0';
  } catch(e) {
    return '0';
  }
}

function clearCacheForMonth() {
  try {
    const props = PropertiesService.getScriptProperties();
    const next = (parseInt(props.getProperty('CACHE_VER') || '0', 10) + 1) % 1000000;
    props.setProperty('CACHE_VER', String(next));
  } catch(e) {
    Logger.log('Error limpiando cache: ' + e.message);
  }
}

function clasificarEmail_(data, shCfg) {
  return clasificarConIA_(data, shCfg);   // delegado a Services.gs
}

// ═══════════════════════════════════════════════════════
// EDITAR TRANSACCIÓN EXISTENTE
// ═══════════════════════════════════════════════════════
function editarMovimiento(id, changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!sh) throw new Error('Hoja Movimientos no existe');
  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.mov_id] ?? '') !== String(id)) continue;
    const row = r + 1;
    let descCol = null, catCol = null;
    Object.entries(hdr).forEach(([k,v]) => {
      if (k.indexOf('descripci') >= 0) descCol = v;
      if (k.indexOf('categor') >= 0)   catCol  = v;
    });
    if (changes.fecha       != null) sh.getRange(row, hdr.fecha+1).setValue(new Date(changes.fecha));
    if (changes.descripcion != null && descCol != null) sh.getRange(row, descCol+1).setValue(changes.descripcion);
    if (changes.tipo != null && hdr.grupo != null) sh.getRange(row, hdr.grupo+1).setValue(normalizeGroupLabel_(changes.tipo));
    if (changes.categoria   != null && catCol  != null) sh.getRange(row, catCol+1).setValue(stripEmoji_(changes.categoria));
    if (changes.monto       != null) sh.getRange(row, hdr.monto+1).setValue(parseNum_(changes.monto));
    if (changes.moneda      != null) sh.getRange(row, hdr.moneda+1).setValue(changes.moneda);
    if (changes.cuenta      != null) sh.getRange(row, hdr.cuenta_origen+1).setValue(changes.cuenta);
    if (changes.cuentaDestino != null && hdr.cuenta_destino != null) sh.getRange(row, hdr.cuenta_destino+1).setValue(changes.cuentaDestino);
    if (changes.notas       != null) sh.getRange(row, hdr.notas+1).setValue(changes.notas);
    syncAccountBalances_(ss, null, true);
    // Si corregiste la categoría, el clasificador aprendido debe reaprender.
    if (changes.categoria != null && typeof _lcInvalidate_ === 'function') _lcInvalidate_();
    clearCacheForMonth();
    return { ok: true };
  }
  throw new Error('Transacción no encontrada: ' + id);
}

// ═══════════════════════════════════════════════════════
// ACTUALIZAR CORREO — TODOS LOS CAMPOS EDITABLES
// ═══════════════════════════════════════════════════════
function actualizarCorreoCompleto(logId, changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (!sh) throw new Error('Hoja Correos_Gastos no existe');
  ensureColumn_(sh, 'cuenta_sugerida');
  ensureColumn_(sh, 'tipo_ia');
  ensureColumn_(sh, 'notas_ia');
  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  if (hdr.log_id == null) throw new Error('Columna log_id no encontrada');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.log_id] ?? '') !== String(logId)) continue;
    const row = r + 1;
    let obsCol = null;
    Object.entries(hdr).forEach(([k,v]) => { if (k.indexOf('observaci') >= 0) obsCol = v; });
    if (changes.categoria_usuario != null && hdr.categoria_usuario != null)
      sh.getRange(row, hdr.categoria_usuario+1).setValue(stripEmoji_(String(changes.categoria_usuario).trim()));
    if (changes.cuenta_sugerida != null && hdr.cuenta_sugerida != null)
      sh.getRange(row, hdr.cuenta_sugerida+1).setValue(String(changes.cuenta_sugerida).trim());
    if (changes.observacion != null && obsCol != null)
      sh.getRange(row, obsCol+1).setValue(String(changes.observacion));
    if (changes.monto    != null && hdr.monto    != null) sh.getRange(row, hdr.monto+1).setValue(parseNum_(changes.monto));
    if (changes.moneda   != null && hdr.moneda   != null) sh.getRange(row, hdr.moneda+1).setValue(String(changes.moneda));
    if (changes.comercio != null && hdr.comercio != null) sh.getRange(row, hdr.comercio+1).setValue(String(changes.comercio));
    if (changes.fecha    != null && hdr.recibido_el != null) sh.getRange(row, hdr.recibido_el+1).setValue(new Date(changes.fecha));
    if (changes.tipo_ia != null && hdr.tipo_ia != null) sh.getRange(row, hdr.tipo_ia+1).setValue(String(changes.tipo_ia).trim());
    if (changes.notas_ia != null && hdr.notas_ia != null) sh.getRange(row, hdr.notas_ia+1).setValue(String(changes.notas_ia));
    clearCacheForMonth();
    return { ok: true };
  }
  throw new Error('Email no encontrado: ' + logId);
}

function guardarCorreoEditado(logId, changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (!sh) throw new Error('Hoja Correos_Gastos no existe');

  actualizarCorreoCompleto(logId, changes || {});

  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.log_id] ?? '') !== String(logId)) continue;

    const amount = parseNum_(changes?.monto != null ? changes.monto : data[r][hdr.monto]);
    const category = stripEmoji_(String(changes?.categoria_usuario || data[r][hdr.categoria_usuario] || data[r][hdr.categoria_ia] || 'Otros'));
    const account = String(changes?.cuenta_sugerida || data[r][hdr.cuenta_sugerida] || CFG.DEFAULT_ACCOUNT).trim();
    const type = String(changes?.tipo_ia || data[r][hdr.tipo_ia] || 'expense').trim();
    const merchant = String(changes?.comercio || data[r][hdr.comercio] || '');
    const subject = String(data[r][hdr.asunto] || '');
    const notes = String(changes?.observacion || data[r][hdr.observacion] || '');
    const notesSafe = String(changes?.observacion || data[r][hdr.observacion] || '');
    const dateVal = changes?.fecha != null ? changes.fecha : data[r][hdr.recibido_el];
    const dateIso = dateVal instanceof Date
      ? dateVal.toISOString().slice(0, 10)
      : new Date(dateVal || new Date()).toISOString().slice(0, 10);
    const linkedTxnId = String(data[r][hdr.mov_id] || '').trim();

    if (changes?.sincronizar_movimiento) {
      if (linkedTxnId) {
        editarMovimiento(linkedTxnId, {
          fecha: dateIso,
          tipo: type,
          descripcion: (merchant || subject || '').trim().slice(0, 180),
          categoria: category,
          monto: amount,
          cuenta: account,
          notas: notesSafe
        });
      } else {
        const txn = guardarTransaccion({
          tipo: normalizeType_(type) === 'income' ? 'Ingreso' : normalizeType_(type) === 'transfer' ? 'Transferencia' : 'Egreso',
          fecha: dateIso,
          monto: amount,
          categoria: category,
          cuenta: account,
          descripcion: (merchant || subject || '').trim().slice(0, 180),
          notas: notesSafe,
          source: 'gmail'
        });
        if (hdr.mov_id != null) sh.getRange(r + 1, hdr.mov_id + 1).setValue(txn.id || '');
        if (hdr.estado != null) sh.getRange(r + 1, hdr.estado + 1).setValue('aprobado');
        if (hdr.procesado_el != null) sh.getRange(r + 1, hdr.procesado_el + 1).setValue(new Date());
      }
    }

    clearCacheForMonth();
    return { ok: true, movId: sh.getRange(r + 1, hdr.mov_id + 1).getValue() || linkedTxnId || '' };
  }

  throw new Error('Email no encontrado: ' + logId);
}

// ═══════════════════════════════════════════════════════
// GUARDAR / EDITAR INVERSIÓN (upsert)
// ═══════════════════════════════════════════════════════
/**
 * Guarda una nueva inversión o actualiza una existente
 * @param {Object} form - Datos del formulario
 */
function guardarInversionEs(form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!sh) throw new Error('Hoja Inversiones no existe');

  const invId = String(form.inversion_id || '').trim();
  const activo = String(form.activo || '').trim();
  if (!activo) throw new Error('Nombre del activo requerido');

  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);

  // Obtener TRM actual
  const trmActual = obtenerTRM();

  // Valores del formulario
  const fechaCompra = form.fecha_compra || new Date().toISOString().slice(0, 10);
  const cuenta = String(form.cuenta || 'Nu');
  const broker = String(form.broker || '');
  const operacion = String(form.operacion || 'Compra');
  const ticker = String(form.ticker || '').trim().toUpperCase();
  const cantidad = parseNum_(form.cantidad);
  const precioCompra = parseNum_(form.precio_compra);
  const monedaCompra = String(form.moneda_compra || 'USD').toUpperCase();
  const trmCompra = parseNum_(form.trm_compra) || (monedaCompra === 'USD' ? trmActual : 1);
  const fuentePrecio = String(form.fuente_precio || 'MANUAL').toUpperCase();
  const precioActual = parseNum_(form.precio_actual) || precioCompra;
  const monedaActual = String(form.moneda_actual || monedaCompra).toUpperCase();
  const notas = String(form.notas || '');

  // Calcular valores en COP (base)
  const vrMercadoCompraBase = cantidad * precioCompra * trmCompra;
  const precioActualBase = monedaActual === 'USD' ? precioActual * trmActual : precioActual;
  const vrMercadoActualBase = cantidad * precioActualBase;

  // Calcular PyG
  const pygBase = vrMercadoActualBase - vrMercadoCompraBase;
  const pygPct = vrMercadoCompraBase > 0 ? (pygBase / vrMercadoCompraBase) * 100 : 0;

  // Actualizar existente
  if (invId) {
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][hdr.inversion_id] ?? '') === invId) {
        const row = r + 1;
        const setIfExists = (colIdx, val) => {
          if (colIdx != null && colIdx !== undefined) sh.getRange(row, colIdx + 1).setValue(val);
        };

        setIfExists(hdr.fecha_compra, new Date(fechaCompra));
        setIfExists(hdr.cuenta, cuenta);
        setIfExists(hdr.broker, broker);
        setIfExists(hdr.operacion, operacion);
        setIfExists(hdr.ticker, ticker);
        setIfExists(hdr.activo, activo);
        setIfExists(hdr.cantidad, cantidad);
        setIfExists(hdr.precio_compra, precioCompra);
        setIfExists(hdr.moneda_compra, monedaCompra);
        setIfExists(hdr.trm_compra, trmCompra);
        setIfExists(hdr.vr_mercado_compra, vrMercadoCompraBase);
        setIfExists(hdr.fuente_precio, fuentePrecio);
        setIfExists(hdr.precio_actual, precioActual);
        setIfExists(hdr.moneda_actual, monedaActual);
        setIfExists(hdr.trm_actual, trmActual);
        setIfExists(hdr.precio_actual_base, precioActualBase);
        setIfExists(hdr.vr_mercado_actual, cantidad * precioActual);
        setIfExists(hdr.vr_mercado_actual_base, vrMercadoActualBase);
        setIfExists(hdr.pyg_base, pygBase);
        setIfExists(hdr.pyg_pct, pygPct);
        setIfExists(hdr.actualizado_el, new Date());
        setIfExists(hdr.notas, notas);

        clearCacheForMonth();
        return { ok: true, id: invId, action: 'updated' };
      }
    }
  }

  // Crear nueva inversión
  const newId = Utilities.getUuid();
  const nextRow = nextEmpty_(sh, 2);
  const cols = [
    newId,
    new Date(fechaCompra),
    cuenta,
    broker,
    operacion,
    ticker,
    activo,
    cantidad,
    precioCompra,
    monedaCompra,
    trmCompra,
    vrMercadoCompraBase,
    fuentePrecio,
    precioActual,
    monedaActual,
    trmActual,
    precioActualBase,
    cantidad * precioActual,
    vrMercadoActualBase,
    pygBase,
    pygPct,
    new Date(),
    notas
  ];

  sh.getRange(nextRow, 1, 1, cols.length).setValues([cols]);
  clearCacheForMonth();

  // Intentar obtener precio automático si es GOOGLEFINANCE
  if (fuentePrecio === 'GOOGLEFINANCE' && ticker) {
    const precioAuto = obtenerPrecioAutomatico(ticker, fuentePrecio);
    if (precioAuto.precio && precioAuto.precio > 0) {
      const precioAutoBase = precioAuto.moneda === 'USD' ? precioAuto.precio * trmActual : precioAuto.precio;
      const vrAutoBase = cantidad * precioAutoBase;
      const pygAuto = vrAutoBase - vrMercadoCompraBase;
      const pygPctAuto = vrMercadoCompraBase > 0 ? (pygAuto / vrMercadoCompraBase) * 100 : 0;
      
      sh.getRange(nextRow, hdr.precio_actual + 1).setValue(precioAuto.precio);
      sh.getRange(nextRow, hdr.moneda_actual + 1).setValue(precioAuto.moneda);
      sh.getRange(nextRow, hdr.trm_actual + 1).setValue(trmActual);
      sh.getRange(nextRow, hdr.precio_actual_base + 1).setValue(precioAutoBase);
      sh.getRange(nextRow, hdr.vr_mercado_actual + 1).setValue(cantidad * precioAuto.precio);
      sh.getRange(nextRow, hdr.vr_mercado_actual_base + 1).setValue(vrAutoBase);
      sh.getRange(nextRow, hdr.pyg_base + 1).setValue(pygAuto);
      sh.getRange(nextRow, hdr.pyg_pct + 1).setValue(pygPctAuto);
    }
  }

  return { ok: true, id: newId, action: 'created' };
}

// ═══════════════════════════════════════════════════════
// ELIMINAR INVERSIÓN
// ═══════════════════════════════════════════════════════
function eliminarInversionEs(invId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
  if (!sh) throw new Error('Hoja Inversiones no existe');
  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.inversion_id] ?? '') === String(invId)) {
      sh.deleteRow(r + 1);
      clearCacheForMonth();
      return { ok: true };
    }
  }
  throw new Error('Inversión no encontrada: ' + invId);
}

// ═══════════════════════════════════════════════════════
// ACTUALIZAR SALDO CUENTA (español)
// ═══════════════════════════════════════════════════════
function actualizarSaldoCuentaEs(nombre, saldo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!sh) throw new Error('Hoja Cuentas no existe');
  const saldoInicialCol = ensureColumn_(sh, 'saldo_inicial');
  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  if (hdr.nombre == null || hdr.saldo == null) throw new Error('Columnas nombre/saldo no encontradas');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.nombre]||'').trim().toLowerCase() === String(nombre).trim().toLowerCase()) {
      sh.getRange(r + 1, hdr.saldo+1).setValue(parseNum_(saldo));
      if (saldoInicialCol != null) sh.getRange(r + 1, saldoInicialCol + 1).setValue(parseNum_(saldo));
      clearCacheForMonth();
      return { ok: true, cuenta: nombre, nuevoSaldo: parseNum_(saldo) };
    }
  }
  throw new Error(`Cuenta "${nombre}" no encontrada`);
}

// ═══════════════════════════════════════════════════════
// GUARDAR PRESUPUESTOS EN LOTE (reemplaza mes actual)
// ═══════════════════════════════════════════════════════
function guardarPresupuestosLote(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Array de presupuestos requerido');
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
  if (!sh) throw new Error('Hoja Presupuestos no existe');

  // Determinar el período de estos ítems
  const rawPeriod = items[0]?.periodo;
  // 'monthly' = presupuesto permanente; 'yyyy-MM' = eventualidad; '' => tratar como 'monthly'
  const esPermanente = !rawPeriod || rawPeriod === 'monthly';
  const mes = esPermanente ? 'monthly' : String(rawPeriod).slice(0, 7);

  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  let perCol = null;
  Object.entries(hdr).forEach(([k,v]) => { if (k === 'periodo' || k.indexOf('period') >= 0) perCol = v; });

  // Borrar filas existentes del mismo período
  for (let r = data.length - 1; r >= 1; r--) {
    const p = String(perCol != null ? data[r][perCol] : '').trim();
    const esVacioOMensual = !p || p === 'monthly';
    if (esPermanente ? esVacioOMensual : p === mes) sh.deleteRow(r + 1);
  }

  items.forEach(item => {
    const limite = parseNum_(item.limite);
    if (!item.categoria || limite <= 0) return;
    sh.getRange(nextEmpty_(sh, 2), 1, 1, 6).setValues([[
      Utilities.getUuid(), String(item.categoria).trim(),
      mes, limite, parseNum_(item.alerta) || 80, true
    ]]);
  });
  clearCacheForMonth();
  return { ok: true, saved: items.length };
}

// ═══════════════════════════════════════════════════════
// HEALTH SCORE DESDE FRONTEND
// ═══════════════════════════════════════════════════════
function obtenerHealthScore(mes) {
  try {
    const d = getDataAPI(mes);
    if (d.error) return { score: 0, tips: [] };
    const k = d.kpis || {};
    return calcHealthScore_(k.income || 0, k.expense || 0, k.savings || 0, k.txnCount || 0);
  } catch(e) {
    return { score: 0, tips: [e.message] };
  }
}

// ═══════════════════════════════════════════════════════
// PRESUPUESTO PLANTILLA FIJO (cargable manualmente)
// ═══════════════════════════════════════════════════════
function loadBudgetTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
  if (!sh) return { error: 'Hoja Presupuestos no existe' };

  const data = readSheet_(sh);
  const existentes = new Set(data.map(r => String(r.categoría || r.categoria || '').trim()));

  // Plantilla de presupuesto predefinida (en COP)
  const template = [
    { cat: 'Alimentos',           limite: 600000,  alerta: 85 },
    { cat: 'Transporte',          limite: 300000,  alerta: 80 },
    { cat: 'Servicios',           limite: 250000,  alerta: 80 },
    { cat: 'Salud',               limite: 200000,  alerta: 85 },
    { cat: 'Entretenimiento',     limite: 150000,  alerta: 80 },
    { cat: 'Educación',           limite: 400000,  alerta: 90 },
    { cat: 'Ropa',                limite: 200000,  alerta: 80 },
    { cat: 'Hogar',               limite: 300000,  alerta: 85 },
    { cat: 'Mascotas',            limite: 150000,  alerta: 85 },
    { cat: 'Viajes',              limite: 500000,  alerta: 90 }
  ];

  let added = 0;

  template.forEach(t => {
    if (!existentes.has(t.cat)) {
      const row = [Utilities.getUuid(), t.cat, 'monthly', t.limite, t.alerta, true];
      const nextRow = nextEmpty_(sh, 2);
      sh.getRange(nextRow, 1, 1, row.length).setValues([row]);
      added++;
    }
  });

  clearCacheForMonth();
  return { ok: true, loaded: added, total: template.length, message: `Cargadas ${added} categorías nuevas` };
}

// ═══════════════════════════════════════════════════════
// (La gestión de la clave de IA se movió a AIProvider.js:
//  guardarGeminiApiKey / getGeminiKeyStatus / probarClaveIA)
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// RECONCILIACIÓN DE SALDOS — CIERRE DE MES
// ═══════════════════════════════════════════════════════
/**
 * Devuelve el saldo calculado de cada cuenta activa para mostrar en el modal
 * de cierre de mes. El usuario compara con su extracto real y ajusta.
 */
function obtenerSaldosParaReconciliar(mes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!sh) throw new Error('Hoja Cuentas no existe');
  syncAccountBalances_(ss, null, true);
  const cuentas = readSheet_(sh)
    .filter(r => r.activa !== false && String(r.activa) !== 'false' && r.nombre)
    .map(r => ({
      nombre:           String(r.nombre || '').trim(),
      tipo:             String(r.tipo   || '').trim(),
      saldo_calculado:  parseNum_(r.saldo),
      moneda:           String(r.moneda || 'COP')
    }));
  const mesResult = mes || Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM');
  return { ok: true, cuentas, mes: mesResult };
}

/**
 * Reconcilia los saldos de fin de mes.
 * Para cada cuenta donde el saldo real difiere del calculado,
 * crea un movimiento de ajuste (ingreso o egreso) con fuente 'ajuste_cierre'.
 *
 * @param {Array} ajustes  [{nombre, saldo_real, mes}]
 * @returns {Object}  {ok, ajustes:[{cuenta,saldo_calculado,saldo_real,diferencia,tipo,txn_id}]}
 */
function reconciliarSaldosMes(ajustes) {
  if (!Array.isArray(ajustes) || !ajustes.length) throw new Error('Array de ajustes requerido');

  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const shCtas  = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  const shMov   = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!shCtas || !shMov) throw new Error('Faltan hojas Cuentas o Movimientos');

  const shCfg   = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const baseCur = String(getSettingEs_(shCfg, 'moneda_base', 'COP') || 'COP');

  syncAccountBalances_(ss, null, true);

  const cuentasMap = {};
  readSheet_(shCtas).forEach(r => {
    if (r.nombre) cuentasMap[String(r.nombre).trim().toLowerCase()] = r;
  });

  const fechaAjuste  = new Date();
  const mes          = String(ajustes[0]?.mes || Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM')).slice(0, 7);
  const realizados   = [];

  for (const aj of ajustes) {
    const key            = String(aj.nombre || '').trim().toLowerCase();
    const saldoReal      = parseNum_(aj.saldo_real);
    const cuentaRow      = cuentasMap[key];
    if (!cuentaRow) continue;

    const saldoCalc  = parseNum_(cuentaRow.saldo);
    const diferencia = saldoReal - saldoCalc;
    if (Math.abs(diferencia) < 1) continue;          // ignorar diferencias < $1

    const grupo = diferencia > 0 ? 'ingreso' : 'gasto';
    const cat   = diferencia > 0 ? 'Ingresos' : 'Otros';
    const id    = Utilities.getUuid();

    const row = [
      id,
      fechaAjuste,
      `Ajuste cierre ${mes} — ${String(aj.nombre).trim()}`,
      grupo,
      cat,
      Math.abs(diferencia),
      baseCur,
      String(aj.nombre).trim(),
      '',
      '',
      'ajuste_cierre',
      '',
      `Saldo real: ${saldoReal} · Saldo calculado: ${saldoCalc}`,
      new Date()
    ];

    shMov.getRange(nextEmpty_(shMov, 2), 1, 1, row.length).setValues([row]);

    realizados.push({
      cuenta:           String(aj.nombre).trim(),
      saldo_calculado:  saldoCalc,
      saldo_real:       saldoReal,
      diferencia,
      tipo:             grupo,
      txn_id:           id
    });
  }

  syncAccountBalances_(ss, null, true);
  clearCacheForMonth();
  return { ok: true, ajustes: realizados, total: realizados.length, mes };
}

// ═══════════════════════════════════════════════════════
// MODO AUTO DE PRECIOS — getter/setter desde UI
// ═══════════════════════════════════════════════════════
function getPrecioAutoMode() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const val   = String(getSettingEs_(shCfg, 'auto_precios_inv', 'true'));
  return { ok: true, auto: val !== 'false' };
}

function setPrecioAutoMode(enabled) {
  guardarConfiguracion('auto_precios_inv', enabled ? 'true' : 'false');
  return { ok: true, auto: !!enabled };
}

// ═══════════════════════════════════════════════════════
// CHATBOT FINANCIERO — powered by Gemini
// ═══════════════════════════════════════════════════════
function chatbotQuery(message, mes) {
  const apiKey = _aiApiKey_();
  if (!apiKey) {
    return { ok: false, reply: '⚙️ Para usar el asistente, configura tu API key de Gemini en **Ajustes → Integración IA**. Es gratuita en aistudio.google.com' };
  }

  let context = '';
  try {
    const d   = getDataAPI(mes);
    const k   = d.kpis || {};
    const fmt = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
    const byCatStr = Object.entries(d.byCat || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([c, v]) => `${c}: ${fmt(v)}`).join(', ');
    const topCuenta = (d.accounts || []).map(a => `${a.name}: ${fmt(a.bal)}`).join(', ');
    const mes_ = d.mes || mes || '';
    const savingsRate = k.income > 0 ? ((k.savings / k.income) * 100).toFixed(1) : 0;

    context = `Eres un asesor financiero personal amigable y preciso. DATOS DEL USUARIO para ${mes_}:
- Ingresos: ${fmt(k.income)} | Gastos: ${fmt(k.expense)} | Ahorro: ${fmt(k.savings)} (${savingsRate}%)
- Burn rate: ${(k.burnRate || 0).toFixed(1)}% | Capital total: ${fmt(k.totalNeto)}
- Gastos por categoría: ${byCatStr || 'sin datos'}
- Saldos cuentas: ${topCuenta || 'sin datos'}
- Inversiones (valor de mercado): ${fmt(k.inversiones)}
- Score salud financiera: ${d.saas?.healthScore || 0}/100
Responde SIEMPRE en español, de forma concisa (máx 3 párrafos). Usa los datos anteriores para dar respuestas personalizadas. Si preguntan por datos que no tienes, dilo. No inventes cifras.`;
  } catch(e) {
    context = 'Eres un asesor financiero personal. Responde en español de forma concisa y útil.';
  }

  try {
    const payload = {
      contents: [
        {
          parts: [
            { text: `${context}\n\nUsuario: ${message}` }
          ]
        }
      ]
    };
    const r = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
    if (r.code !== 200) {
      Logger.log('❌ ERROR IA HTTP ' + r.code + ': ' + r.raw);
      return { ok: false, reply: '❌ Error conectando con la IA (HTTP ' + r.code + '). Verifica tu API Key en Ajustes.' };
    }
    const texto = r.text || 'Sin respuesta';
    return { ok: true, reply: texto.trim() };
  } catch(e) {
    Logger.log('chatbotQuery error: ' + e);
    return { ok: false, reply: 'Error al llamar a la IA: ' + e.message };
  }
}
