const PUBLIC_API_ACTIONS_ = {
  api_status: true,
  sync_email: true,
  save_txn: true,
  get_data: true,
  accept_email: true,
  quick_gasto: true,
  quick_ingreso: true,
  nueva_txn: true,
  crear_movimiento: true,
  saldo: true,
  resumen_mes: true,
  resumen_dia: true,
  presupuesto: true,
  listar_cuentas: true,
  actualizar_precios_inv: true,
  noticias_inv: true,
  saldo_cuentas: true,
  reconciliar_saldos: true,
  auditar_extracto: true,
  importar_extracto: true,
  // Nuevos v3.0
  procesar_pdf: true,
  alertas: true,
  chat_ia: true,
  trucos_ia: true,
  categorizar_ia: true,
  proyeccion_mes: true,
  // Nuevos v4.0 — Metas · Recurrentes · Deudas
  get_metas: true,
  guardar_meta: true,
  aportar_meta: true,
  eliminar_meta: true,
  get_recurrentes: true,
  guardar_recurrente: true,
  marcar_pagado: true,
  eliminar_recurrente: true,
  get_deudas: true,
  guardar_deuda: true,
  pagar_deuda: true,
  eliminar_deuda: true,
  finanzas_completas: true
};

function parseApiRequestBody_(e) {
  const raw = e && e.postData && typeof e.postData.contents === 'string'
    ? e.postData.contents
    : '';
  let parsed = {};

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = {
        raw_text: raw
      };
    }
  }

  const params = e && e.parameter ? e.parameter : {};
  return Object.assign({}, params, parsed);
}

function assertAuthorizedApiRequest_(action, body, e) {
  // Requiere API key para las acciones legacy públicas (Atajos iPhone, etc.)
  // Y también para cualquier acción de RPC_WHITELIST_ (llamadas de la PWA
  // vía el shim google.script.run→fetch) — ésas nunca deben quedar abiertas.
  const necesitaAuth = PUBLIC_API_ACTIONS_[action] || (typeof RPC_WHITELIST_ !== 'undefined' && RPC_WHITELIST_.includes(action));
  if (!necesitaAuth) return;
  if (action === 'api_status') return;

  const scriptProps = PropertiesService.getScriptProperties();
  const configuredKey = String(scriptProps.getProperty('SHORTCUTS_API_KEY') || '').trim();
  if (!configuredKey) {
    throw new Error('Configura SHORTCUTS_API_KEY antes de exponer la API publica.');
  }

  const provided = String(
    (body && (body.api_key || body.apiKey || body.token)) ||
    (e && e.parameter && (e.parameter.api_key || e.parameter.apiKey || e.parameter.token)) ||
    ''
  ).trim();

  if (!provided || provided !== configuredKey) {
    throw new Error('API key invalida.');
  }
}

/**
 * Genera y guarda una SHORTCUTS_API_KEY nueva si no existe todavía.
 * No sobreescribe una clave ya configurada — para rotarla, bórrala antes
 * desde Propiedades del script. Pensada para invocarse una sola vez vía
 * `clasp run generarApiKeySiNoExiste_`.
 * @returns {{ok:boolean, created:boolean, masked:string}}
 */
function generarApiKeySiNoExiste_() {
  const props = PropertiesService.getScriptProperties();
  const existing = String(props.getProperty('SHORTCUTS_API_KEY') || '').trim();
  if (existing) {
    return { ok: true, created: false, key: existing };
  }
  const key = Utilities.getUuid().replace(/-/g, '');
  props.setProperty('SHORTCUTS_API_KEY', key);
  Logger.log('SHORTCUTS_API_KEY generada: ' + key);
  return { ok: true, created: true, key: key };
}

function getApiStatus_() {
  const configuredKey = String(PropertiesService.getScriptProperties().getProperty('SHORTCUTS_API_KEY') || '').trim();
  return {
    ok: true,
    api_ready: !!configuredKey,
    api_key_configured: !!configuredKey,
    actions: Object.keys(PUBLIC_API_ACTIONS_).sort()
  };
}

function listarCuentasAPI_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!sh) throw new Error('Hoja Cuentas no existe');

  const cuentas = readSheet_(sh)
    .filter(r => r.nombre)
    .map(r => ({
      id: String(r.cuenta_id || '').trim(),
      nombre: String(r.nombre || '').trim(),
      tipo: String(r.tipo || '').trim(),
      moneda: String(r.moneda || 'COP').trim(),
      saldo: parseNum_(r.saldo),
      activa: !(r.activa === false || String(r.activa).toLowerCase() === 'false')
    }));

  return { ok: true, cuentas };
}

function ensureMovimientosSchema_(sh) {
  ensureColumn_(sh, 'fingerprint');
  ensureColumn_(sh, 'external_id');
  ensureColumn_(sh, 'statement_id');
  ensureColumn_(sh, 'estado_conciliacion');
  ensureColumn_(sh, 'conciliado_el');
}

function _marcarEstadoConciliacionEnHoja_(sh, rowNum, statementId, estado) {
  try {
    ensureMovimientosSchema_(sh);
    const hdr = rowToObj_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    if (hdr.estado_conciliacion != null)
      sh.getRange(rowNum, hdr.estado_conciliacion + 1).setValue(estado);
    if (hdr.statement_id != null && statementId)
      sh.getRange(rowNum, hdr.statement_id + 1).setValue(statementId);
    if (hdr.conciliado_el != null)
      sh.getRange(rowNum, hdr.conciliado_el + 1).setValue(new Date());
  } catch(e) {
    Logger.log('_marcarEstadoConciliacionEnHoja_ error: ' + e);
  }
}

function ensureAuditoriaExtractosSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = 'Auditoria_Extractos';
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }

  const headers = [
    'audit_id',
    'statement_id',
    'cuenta',
    'fecha',
    'descripcion',
    'monto',
    'tipo',
    'external_id',
    'fingerprint',
    'estado',
    'movimiento_id',
    'detalle',
    'creado_el'
  ];

  const lastCol = Math.max(1, sh.getLastColumn());
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (!existing.filter(Boolean).length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    headers.forEach(header => ensureColumn_(sh, header));
  }

  return sh;
}

function normalizeMovementText_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function parseBankDate_(value) {
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (!value && value !== 0) return null;

  const s = String(value).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const latam = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (latam) {
    const year = Number(latam[3].length === 2 ? '20' + latam[3] : latam[3]);
    return new Date(year, Number(latam[2]) - 1, Number(latam[1]));
  }

  return parseSheetDate_(s);
}

function computeMovimientoFingerprint_(input) {
  const fecha = parseBankDate_(input.fecha || input.date);
  const dateKey = fecha ? Utilities.formatDate(fecha, CFG.TZ, 'yyyy-MM-dd') : 'sin-fecha';
  const amountKey = Math.abs(parseNum_(input.monto || input.amount)).toFixed(2);
  const accountKey = normalizeMovementText_(input.cuenta || input.account);
  const destKey = normalizeMovementText_(input.cuentaDestino || input.accountDestination);
  const descKey = normalizeMovementText_(input.descripcion || input.description);
  const typeKey = normalizeType_(input.grupo || input.tipo || input.type);
  const extKey = normalizeMovementText_(input.externalId || input.external_id);
  const raw = [dateKey, amountKey, accountKey, destKey, descKey, typeKey, extKey].join('|');

  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}

function findExistingMovimiento_(sh, lookup) {
  ensureMovimientosSchema_(sh);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  const hdr = rowToObj_(data[0]);
  const targetDate = parseBankDate_(lookup.fecha);
  const targetYmd = targetDate ? Utilities.formatDate(targetDate, CFG.TZ, 'yyyy-MM-dd') : '';

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const id = String(row[hdr.mov_id] || '').trim();
    const fp = hdr.fingerprint != null ? String(row[hdr.fingerprint] || '').trim() : '';
    const ext = hdr.external_id != null ? String(row[hdr.external_id] || '').trim() : '';

    if (lookup.externalId && ext && ext === lookup.externalId) {
      return { id, row: r + 1, match: 'external_id' };
    }
    if (lookup.fingerprint && fp && fp === lookup.fingerprint) {
      return { id, row: r + 1, match: 'fingerprint' };
    }

    const rowDate = parseBankDate_(row[hdr.fecha]);
    const rowYmd = rowDate ? Utilities.formatDate(rowDate, CFG.TZ, 'yyyy-MM-dd') : '';
    const rowAmount = Math.abs(parseNum_(row[hdr.monto]));
    const rowAccount = normalizeMovementText_(row[hdr.cuenta_origen]);
    if (
      targetYmd &&
      rowYmd === targetYmd &&
      Math.abs(rowAmount - Math.abs(parseNum_(lookup.monto))) < 0.01 &&
      rowAccount === normalizeMovementText_(lookup.cuenta)
    ) {
      return { id, row: r + 1, match: 'natural_key' };
    }
  }

  return null;
}

guardarTransaccion = function(form) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CFG.SHEETS.MOV);
    const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
    if (!sh) throw new Error('Hoja Movimientos no existe');

    ensureMovimientosSchema_(sh);

    const tipo = String(form.tipo || form.type || '').trim();
    const fecha = parseBankDate_(form.fecha || form.date);
    const monto = parseNum_(form.monto || form.amount);
    const categoria = stripEmoji_(String(form.categoria || form.category || 'Otros').trim());
    const cuenta = String(form.cuenta || form.account || '').trim();
    const descripcion = String(form.descripcion || form.description || '').trim();
    const cuentaDestino = String(form.cuentaDestino || form.accountDestination || '').trim();
    const baseCur = String(getSettingEs_(shCfg, 'moneda_base', 'COP') || 'COP');
    const source = String(form.source || 'manual').trim();
    const externalId = String(form.externalId || form.external_id || form.clientTxnId || '').trim();

    if (!fecha) throw new Error('Fecha invalida');
    if (!cuenta) throw new Error('Selecciona una cuenta');
    if (!monto || monto <= 0) throw new Error('Monto invalido');
    if (tipo === 'Transferencia' && (!cuentaDestino || cuentaDestino === cuenta)) {
      throw new Error('Selecciona una cuenta destino diferente');
    }

    const grupo = tipo.toLowerCase() === 'ingreso' ? 'ingreso'
      : tipo.toLowerCase() === 'egreso' ? 'gasto'
      : tipo.toLowerCase() === 'transferencia' ? 'transferencia'
      : (tipo || 'gasto').toLowerCase();

    const fingerprint = computeMovimientoFingerprint_({
      fecha,
      monto,
      cuenta,
      cuentaDestino,
      descripcion,
      categoria,
      grupo,
      externalId
    });

    const existing = findExistingMovimiento_(sh, {
      fingerprint,
      externalId,
      cuenta,
      monto,
      fecha
    });
    if (existing) {
      return { ok: true, id: existing.id, duplicated: true, fingerprint };
    }

    const row = [
      Utilities.getUuid(),
      fecha,
      descripcion || '-',
      grupo,
      categoria,
      monto,
      baseCur,
      cuenta,
      cuentaDestino || '',
      String(form.activoInversion || ''),
      source,
      String(form.referencia || ''),
      String(form.notas || ''),
      new Date(),
      fingerprint,
      externalId,
      String(form.statementId || form.statement_id || '').trim(),
      String(form.estadoConciliacion || form.reconciliationStatus || '').trim(),
      form.conciliadoEl ? (parseBankDate_(form.conciliadoEl) || new Date()) : ''
    ];

    const nextRow = nextEmpty_(sh, 2);
    sh.getRange(nextRow, 1, 1, row.length).setValues([row]);

    syncAccountBalances_(ss, null, true);
    clearCacheForMonth();
    return { ok: true, id: row[0], fingerprint };
  } finally {
    lock.releaseLock();
  }
};

function parseDelimitedExtracto_(text) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!rows.length) return [];

  const separatorCandidates = [';', '\t', ','];
  let separator = ',';
  let bestScore = -1;
  separatorCandidates.forEach(candidate => {
    const score = rows[0].split(candidate).length;
    if (score > bestScore) {
      bestScore = score;
      separator = candidate;
    }
  });

  const parseLine = line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === separator && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());
    return values;
  };

  const firstRow = parseLine(rows[0]);
  const headerLooksLikeHeader = firstRow.some(v => /fecha|date|descripcion|detalle|cargo|abono|debito|credito|amount|monto/i.test(v));
  const headerMap = headerLooksLikeHeader
    ? rowToObj_(firstRow)
    : null;

  return rows.slice(headerLooksLikeHeader ? 1 : 0).map(line => {
    const cols = parseLine(line);
    if (!headerMap) {
      return {
        fecha: cols[0],
        descripcion: cols[1],
        debito: cols[2],
        credito: cols[3],
        monto: cols[4],
        referencia: cols[5]
      };
    }
    return {
      fecha: cols[headerMap.fecha] || cols[headerMap.date] || cols[headerMap.posted_date],
      descripcion: cols[headerMap.descripcion] || cols[headerMap.description] || cols[headerMap.detalle] || cols[headerMap.concepto] || cols[headerMap.merchant],
      debito: cols[headerMap.debito] || cols[headerMap.debit] || cols[headerMap.cargo],
      credito: cols[headerMap.credito] || cols[headerMap.credit] || cols[headerMap.abono],
      monto: cols[headerMap.monto] || cols[headerMap.amount] || cols[headerMap.valor],
      tipo: cols[headerMap.tipo] || cols[headerMap.type],
      referencia: cols[headerMap.referencia] || cols[headerMap.reference] || cols[headerMap.id],
      categoria: cols[headerMap.categoria] || cols[headerMap.category]
    };
  });
}

function aiParseExtractoText_(rawText, accountName, shCfg) {
  const apiKey = _aiApiKey_();
  if (!apiKey) return [];

  const prompt = [
    'Extrae movimientos bancarios desde un extracto en texto.',
    'Devuelve solo JSON valido con esta forma: {"movimientos":[{"fecha":"YYYY-MM-DD","descripcion":"","monto":1234.56,"tipo":"expense|income|transfer","referencia":""}]}',
    'Reglas:',
    '- Debitos o cargos => expense',
    '- Creditos o abonos => income',
    '- Ignora encabezados, subtotales y saldos',
    '- No inventes movimientos',
    '- Cuenta: ' + accountName,
    '',
    String(rawText || '').slice(0, 12000)
  ].join('\n');

  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    };
    const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
    if (res.code !== 200) return [];
    const text = res.text || '{}';
    const parsed = JSON.parse(String(text || '{}').replace(/```json|```/g, '').trim());
    return Array.isArray(parsed.movimientos) ? parsed.movimientos : [];
  } catch (err) {
    Logger.log('aiParseExtractoText_ error: ' + err);
    return [];
  }
}

function normalizeExtractoMovimiento_(row, defaults, shCfg) {
  const fecha = parseBankDate_(row.fecha || row.date || row.posted_at);
  const debito = parseNum_(row.debito || row.debit || row.cargo);
  const credito = parseNum_(row.credito || row.credit || row.abono);
  const montoBase = parseNum_(row.monto || row.amount || row.valor);
  const monto = montoBase || debito || credito;
  if (!fecha || !monto) return null;

  let tipo = normalizeType_(row.tipo || row.type);
  if (!tipo) {
    tipo = credito > 0 && debito === 0 ? 'income' : 'expense';
  }

  const descripcion = String(row.descripcion || row.description || row.detalle || row.concepto || '').trim();
  let categoria = String(row.categoria || row.category || '').trim();
  if (!categoria) {
    const ai = _rulesClassify_({
      subject: descripcion,
      merchant: descripcion,
      body: '',
      amount: monto
    }, shCfg);
    categoria = ai.category || (tipo === 'income' ? 'Ingresos' : 'Otros');
  }

  return {
    fecha,
    descripcion: descripcion || 'Movimiento extracto',
    monto: Math.abs(monto),
    tipo,
    categoria,
    cuenta: String(defaults.cuenta || defaults.account || '').trim(),
    cuentaDestino: String(row.cuentaDestino || row.accountDestination || '').trim(),
    referencia: String(row.referencia || row.reference || '').trim(),
    externalId: String(row.externalId || row.external_id || row.id || row.referencia || row.reference || '').trim()
  };
}

function loadExtractoMovimientos_(body, shCfg) {
  const directRows = body.movimientos || body.rows || body.transactions;
  if (Array.isArray(directRows) && directRows.length) {
    return directRows;
  }

  const rawText = String(body.csv || body.content || body.raw_text || body.text || '').trim();
  if (!rawText) return [];

  const parsedDelimited = parseDelimitedExtracto_(rawText);
  if (parsedDelimited.length) return parsedDelimited;

  return aiParseExtractoText_(rawText, body.cuenta || body.account || '', shCfg);
}

function findApproxLedgerMatch_(ledgerRows, movimiento) {
  const targetDate = movimiento.fecha ? movimiento.fecha.getTime() : 0;
  const targetDesc = normalizeMovementText_(movimiento.descripcion);
  const targetAccount = normalizeMovementText_(movimiento.cuenta);
  const targetAmount = Math.abs(movimiento.monto);
  // ±3 días de tolerancia en fecha
  const maxDiffMs = 3 * 86400000;
  // ±5% de tolerancia en monto (cubre redondeos y diferencias pequeñas)
  const amountTolerance = Math.max(500, targetAmount * 0.05);

  let bestMatch = null;
  let bestScore = Infinity;

  for (let i = 0; i < ledgerRows.length; i++) {
    const row = ledgerRows[i];
    const rowDate = parseBankDate_(row.fecha);
    const rowAccount = normalizeMovementText_(row.cuenta_origen || row.cuenta);
    const rowAmount = Math.abs(parseNum_(row.monto));
    const rowDesc = normalizeMovementText_(row.descripcion);
    if (!rowDate) continue;
    if (targetAccount && rowAccount && targetAccount !== rowAccount) continue;

    const dateDiffMs = Math.abs(rowDate.getTime() - targetDate);
    if (dateDiffMs > maxDiffMs) continue;

    const amountDiff = Math.abs(rowAmount - targetAmount);
    if (amountDiff > amountTolerance) continue;

    // Puntaje combinado: priorizar menor diferencia de fecha + monto
    const score = (dateDiffMs / 86400000) + (amountDiff / Math.max(targetAmount, 1)) * 3;
    if (score < bestScore) {
      bestScore = score;
      bestMatch = row;
    }
  }

  return bestMatch;
}

function appendAuditRows_(sh, rows) {
  if (!rows.length) return;
  sh.getRange(nextEmpty_(sh, 2), 1, rows.length, rows[0].length).setValues(rows);
}

function procesarExtractoBancario_(body, importMissing) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const shMov = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!shMov) throw new Error('Hoja Movimientos no existe');

  ensureMovimientosSchema_(shMov);
  const shAudit = ensureAuditoriaExtractosSheet_();
  const accountName = String(body.cuenta || body.account || '').trim();
  if (!accountName) throw new Error('Cuenta requerida');

  const statementId = String(body.statementId || body.statement_id || Utilities.getUuid()).trim();
  const rawRows = loadExtractoMovimientos_(body, shCfg);
  if (!rawRows.length) throw new Error('No se pudieron extraer movimientos del extracto');

  const normalized = rawRows
    .map(row => normalizeExtractoMovimiento_(row, { cuenta: accountName }, shCfg))
    .filter(Boolean);
  if (!normalized.length) throw new Error('El extracto no contiene movimientos validos');

  const ledgerRows = readSheet_(shMov);
  const seenStatement = {};
  const auditRows = [];
  const review = [];
  let exact = 0;
  let approximate = 0;
  let repeatedInStatement = 0;
  let imported = 0;
  let missing = 0;

  normalized.forEach(mov => {
    const fingerprint = computeMovimientoFingerprint_(mov);
    const key = mov.externalId || fingerprint;
    if (seenStatement[key]) {
      repeatedInStatement++;
      auditRows.push([
        Utilities.getUuid(),
        statementId,
        mov.cuenta,
        mov.fecha,
        mov.descripcion,
        mov.monto,
        mov.tipo,
        mov.externalId,
        fingerprint,
        'duplicado_extracto',
        '',
        'Movimiento repetido dentro del extracto',
        new Date()
      ]);
      return;
    }
    seenStatement[key] = true;

    const exactMatch = findExistingMovimiento_(shMov, {
      fingerprint,
      externalId: mov.externalId,
      cuenta: mov.cuenta,
      monto: mov.monto,
      fecha: mov.fecha
    });
    if (exactMatch) {
      exact++;
      // Marcar el movimiento en la hoja como conciliado automáticamente
      _marcarEstadoConciliacionEnHoja_(shMov, exactMatch.row, statementId, 'cuadrado');
      review.push({
        estado: 'cuadrado',
        fecha: Utilities.formatDate(mov.fecha, CFG.TZ, 'yyyy-MM-dd'),
        descripcion: mov.descripcion,
        monto: mov.monto,
        movimiento_id: exactMatch.id,
        categoria: String(exactMatch.categoría || exactMatch.categoria || '')
      });
      auditRows.push([
        Utilities.getUuid(),
        statementId,
        mov.cuenta,
        mov.fecha,
        mov.descripcion,
        mov.monto,
        mov.tipo,
        mov.externalId,
        fingerprint,
        'cuadrado',
        exactMatch.id,
        'Coincidencia exacta',
        new Date()
      ]);
      return;
    }

    const approxMatch = findApproxLedgerMatch_(ledgerRows, mov);
    if (approxMatch) {
      approximate++;
      const approxFecha = approxMatch.fecha ? (approxMatch.fecha instanceof Date
        ? Utilities.formatDate(approxMatch.fecha, CFG.TZ, 'yyyy-MM-dd')
        : String(approxMatch.fecha).slice(0, 10)) : '';
      review.push({
        estado: 'aproximado',
        fecha: Utilities.formatDate(mov.fecha, CFG.TZ, 'yyyy-MM-dd'),
        descripcion: mov.descripcion,
        monto: mov.monto,
        movimiento_id: String(approxMatch.mov_id || approxMatch.id || ''),
        // Datos del movimiento encontrado en el ledger (para mostrar al usuario)
        match_fecha: approxFecha,
        match_descripcion: String(approxMatch.descripcion || ''),
        match_monto: parseNum_(approxMatch.monto),
        match_categoria: String(approxMatch.categoría || approxMatch.categoria || ''),
        match_cuenta: String(approxMatch.cuenta_origen || approxMatch.cuenta || '')
      });
      auditRows.push([
        Utilities.getUuid(),
        statementId,
        mov.cuenta,
        mov.fecha,
        mov.descripcion,
        mov.monto,
        mov.tipo,
        mov.externalId,
        fingerprint,
        'aproximado',
        String(approxMatch.mov_id || ''),
        'Coincidencia aproximada',
        new Date()
      ]);
      return;
    }

    missing++;
    let insertedId = '';
    if (importMissing) {
      const saveRes = guardarTransaccion({
        tipo: mov.tipo === 'income' ? 'Ingreso' : mov.tipo === 'transfer' ? 'Transferencia' : 'Egreso',
        fecha: mov.fecha,
        monto: mov.monto,
        categoria: mov.categoria,
        cuenta: mov.cuenta,
        cuentaDestino: mov.cuentaDestino,
        descripcion: mov.descripcion,
        referencia: mov.referencia,
        source: 'statement_import',
        externalId: mov.externalId,
        statementId,
        estadoConciliacion: 'importado_desde_extracto',
        conciliadoEl: new Date(),
        notas: 'Importado automaticamente desde extracto'
      });
      insertedId = saveRes.id || '';
      imported++;
    }

    review.push({
      estado: importMissing ? 'importado' : 'faltante',
      fecha: Utilities.formatDate(mov.fecha, CFG.TZ, 'yyyy-MM-dd'),
      descripcion: mov.descripcion,
      monto: mov.monto,
      categoria: mov.categoria,
      movimiento_id: insertedId
    });

    auditRows.push([
      Utilities.getUuid(),
      statementId,
      mov.cuenta,
      mov.fecha,
      mov.descripcion,
      mov.monto,
      mov.tipo,
      mov.externalId,
      fingerprint,
      importMissing ? 'importado' : 'faltante',
      insertedId,
      importMissing ? 'Insertado en Movimientos' : 'No existe en libros',
      new Date()
    ]);
  });

  appendAuditRows_(shAudit, auditRows);

  return {
    ok: true,
    statement_id: statementId,
    cuenta: accountName,
    total_movimientos: normalized.length,
    exactos: exact,
    aproximados: approximate,
    faltantes: missing,
    importados: imported,
    duplicados_en_extracto: repeatedInStatement,
    review: review.slice(0, 100)
  };
}

function auditarExtractoBancario_(body) {
  return procesarExtractoBancario_(body, false);
}

function importarExtractoBancario_(body) {
  return procesarExtractoBancario_(body, true);
}
