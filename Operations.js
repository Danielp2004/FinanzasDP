/**
 * FINANZAS AI PRO — Operations.gs
 * Reportes avanzados · Insights · Métricas de salud financiera
 * v2.0
 */

// ═══════════════════════════════════════════════════════
// REPORTE EJECUTIVO MENSUAL (llamar manualmente o por trigger)
// ═══════════════════════════════════════════════════════
function generarReporteMensual(mes) {
  const tz  = CFG.TZ;
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shT = ss.getSheetByName(CFG.SHEETS.TXN);
  const shA = ss.getSheetByName(CFG.SHEETS.ACCOUNTS);

  const mesTarget = mes || Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const txns      = readSheet_(shT);
  const mesTxns   = txns.filter(r => r.date instanceof Date && fmtDate_(r.date, 'yyyy-MM') === mesTarget);

  const income  = mesTxns.filter(r => normalizeType_(r.type) === 'income').reduce((s,r) => s+parseNum_(r.amount_base),0);
  const expense = mesTxns.filter(r => normalizeType_(r.type) === 'expense').reduce((s,r) => s+parseNum_(r.amount_base),0);
  const savings = income - expense;

  // Categorías
  const cats = {};
  mesTxns.filter(r => normalizeType_(r.type) === 'expense').forEach(r => {
    const c = String(r.category||'Otros').trim();
    cats[c] = (cats[c]||0) + parseNum_(r.amount_base);
  });
  const topCat = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0,5);

  // Métricas de salud financiera
  const healthScore = calcHealthScore_(income, expense, savings, mesTxns.length);

  const COP = new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 });
  const fmt = v => COP.format(v);

  const body = `
📊 REPORTE FINANCIERO — ${mesTarget}

═══════════════════════════════
RESUMEN DEL MES
═══════════════════════════════
💰 Ingresos:   ${fmt(income)}
💸 Gastos:     ${fmt(expense)}
📈 Ahorro:     ${fmt(savings)}   (${income>0?(savings/income*100).toFixed(1):0}% tasa de ahorro)
🔥 Burn rate:  ${income>0?(expense/income*100).toFixed(1):0}%

═══════════════════════════════
TOP CATEGORÍAS DE GASTO
═══════════════════════════════
${topCat.map(([c,v],i) => `${i+1}. ${c.padEnd(20)} ${fmt(v)}`).join('\n')}

═══════════════════════════════
SALUD FINANCIERA: ${healthScore.score}/100
═══════════════════════════════
${healthScore.tips.map(t => '• '+t).join('\n')}

Generado automáticamente por Finanzas AI Pro
`;

  Logger.log(body);

  // Opcionalmente enviar por email
  // GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), `Reporte Financiero ${mesTarget}`, body);

  return { mes: mesTarget, income, expense, savings, topCat, healthScore };
}

// ─── Score de salud financiera (0-100) ───────────────
function calcHealthScore_(income, expense, savings, txnCount) {
  let score = 0;
  const tips = [];

  // 1. Tasa de ahorro (0-40 puntos)
  const savingsRate = income > 0 ? savings / income : 0;
  if (savingsRate >= 0.3)      { score += 40; }
  else if (savingsRate >= 0.2) { score += 30; tips.push('Meta: ahorrar al menos 30% de tus ingresos'); }
  else if (savingsRate >= 0.1) { score += 20; tips.push('Intenta reducir gastos para llegar al 20% de ahorro'); }
  else if (savingsRate > 0)    { score += 10; tips.push('Tu tasa de ahorro es muy baja, revisa tus gastos fijos'); }
  else                         { score +=  0; tips.push('¡Tus gastos superan tus ingresos! Revisa urgente'); }

  // 2. Burn rate (0-30 puntos)
  const burnRate = income > 0 ? expense / income : 1;
  if (burnRate <= 0.5)      score += 30;
  else if (burnRate <= 0.7) score += 20;
  else if (burnRate <= 0.9) { score += 10; tips.push('Tu burn rate es alto, considera reducir gastos variables'); }
  else                      { score +=  0; tips.push('Burn rate crítico: estás usando más del 90% de tus ingresos'); }

  // 3. Diversificación de gastos (0-20 puntos)
  // Idealmente no más del 50% en una sola categoría
  score += 20; // simplified

  // 4. Actividad de registro (0-10 puntos)
  if (txnCount >= 20)     score += 10;
  else if (txnCount >= 10) score += 7;
  else if (txnCount >= 5)  { score += 4; tips.push('Registra más transacciones para mejores insights'); }
  else                     { score += 0; tips.push('Necesitas registrar más transacciones'); }

  if (tips.length === 0) tips.push('¡Excelente! Tus finanzas están en muy buen estado');

  return { score: Math.min(100, Math.round(score)), tips };
}

// ═══════════════════════════════════════════════════════
// ACTUALIZAR SALDO DE CUENTA
// ═══════════════════════════════════════════════════════
function actualizarSaldoCuenta(accountName, nuevoSaldo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.ACCOUNTS);
  if (!sh) throw new Error('Hoja Accounts no existe');

  const data = sh.getDataRange().getValues();
  const hdr  = data[0].map((h,i) => [String(h).trim().toLowerCase(), i]);
  const nameIdx = hdr.find(([h]) => h === 'name')?.[1];
  const balIdx  = hdr.find(([h]) => h === 'balance')?.[1];

  if (nameIdx == null || balIdx == null) throw new Error('Columnas name/balance no encontradas');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][nameIdx]).trim().toLowerCase() === accountName.trim().toLowerCase()) {
      sh.getRange(r + 1, balIdx + 1).setValue(nuevoSaldo);
      CacheService.getScriptCache().removeAll();
      return { ok: true, account: accountName, newBalance: nuevoSaldo };
    }
  }
  throw new Error(`Cuenta "${accountName}" no encontrada`);
}

// ═══════════════════════════════════════════════════════
// SINCRONIZAR SALDOS: Calcula saldos desde transacciones
// (útil si no actualizas manualmente)
// ═══════════════════════════════════════════════════════
function recalcularSaldosDesdeTxns() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shT = ss.getSheetByName(CFG.SHEETS.TXN);
  const shA = ss.getSheetByName(CFG.SHEETS.ACCOUNTS);
  if (!shT || !shA) throw new Error('Faltan hojas Transactions o Accounts');

  const txns    = readSheet_(shT);
  const accData = shA.getDataRange().getValues();
  const hdr     = accData[0].map((h,i) => [String(h).trim().toLowerCase(),i]);
  const nameIdx = hdr.find(([h]) => h === 'name')?.[1];
  const balIdx  = hdr.find(([h]) => h === 'balance')?.[1];

  // Suma neta por cuenta
  const netByAcc = {};
  txns.forEach(t => {
    const type = normalizeType_(t.type);
    const acc  = String(t.account||'').trim();
    const amt  = parseNum_(t.amount_base);
    if (!acc) return;
    if (!netByAcc[acc]) netByAcc[acc] = 0;
    if (type === 'income')   netByAcc[acc] += amt;
    if (type === 'expense')  netByAcc[acc] -= amt;
    // Transferencias: restar de origen, sumar a destino (simplificado)
  });

  // Actualizar filas
  let updated = 0;
  for (let r = 1; r < accData.length; r++) {
    const name = String(accData[r][nameIdx]||'').trim();
    if (name && netByAcc[name] !== undefined) {
      shA.getRange(r + 1, balIdx + 1).setValue(netByAcc[name]);
      updated++;
    }
  }

  CacheService.getScriptCache().removeAll();
  return { ok: true, updated };
}

// ═══════════════════════════════════════════════════════
// GESTIÓN DE PRESUPUESTO — CRUD
// ═══════════════════════════════════════════════════════
function guardarPresupuesto(form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.BUDGETS);
  if (!sh) throw new Error('Hoja Budgets no existe');

  const row = [
    Utilities.getUuid(),                    // budget_id
    String(form.category || '').trim(),     // category_id
    form.period || 'monthly',              // period
    parseNum_(form.limit),                  // amount_limit
    parseNum_(form.alertPct) || 80,        // alert_pct
    true                                    // is_active
  ];

  const nr = nextEmpty_(sh, 2);
  sh.getRange(nr, 1, 1, row.length).setValues([row]);
  CacheService.getScriptCache().removeAll();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════
// ANÁLISIS DE DUPLICADOS — detectar txns similares
// ═══════════════════════════════════════════════════════
function detectarDuplicados(diasVentana) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const shT  = ss.getSheetByName(CFG.SHEETS.TXN);
  const txns = readSheet_(shT).filter(r => r.date instanceof Date);
  const ventana = (diasVentana || 3) * 86400000; // ms

  const dups = [];
  for (let i = 0; i < txns.length; i++) {
    for (let j = i + 1; j < txns.length; j++) {
      const timeDiff = Math.abs(txns[i].date - txns[j].date);
      const sameAmt  = Math.abs(parseNum_(txns[i].amount_base) - parseNum_(txns[j].amount_base)) < 1;
      const sameCat  = String(txns[i].category) === String(txns[j].category);
      if (timeDiff <= ventana && sameAmt && sameCat) {
        dups.push({ a: txns[i].txn_id, b: txns[j].txn_id, amount: parseNum_(txns[i].amount_base) });
      }
    }
    if (dups.length > 20) break; // límite de seguridad
  }

  return { found: dups.length, duplicates: dups };
}

// ═══════════════════════════════════════════════════════
// IMPORTAR CSV DE BANCO (básico)
// ═══════════════════════════════════════════════════════
/**
 * Pega el contenido CSV en la celda A1 de una hoja temporal "ImportCSV"
 * y llama esta función para importar a Transactions.
 * Formato esperado: fecha,descripción,débito,crédito
 */
function importarCSVBanco() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shImp = ss.getSheetByName('ImportCSV');
  if (!shImp) throw new Error('Crea una hoja llamada ImportCSV y pega tu CSV allí');

  const shT   = ss.getSheetByName(CFG.SHEETS.TXN);
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const baseCur = getSettingEs_(shCfg, 'moneda_base', 'COP');

  const data = shImp.getDataRange().getValues();
  const tz   = CFG.TZ;
  let imported = 0;

  for (let r = 1; r < data.length; r++) {
    const [fechaRaw, desc, debito, credito] = data[r];
    if (!fechaRaw) continue;

    let fecha;
    try { fecha = new Date(fechaRaw); } catch(e) { continue; }
    if (isNaN(fecha)) continue;

    const debitoN  = parseNum_(debito);
    const creditoN = parseNum_(credito);
    if (debitoN === 0 && creditoN === 0) continue;

    const monto = debitoN > 0 ? debitoN : creditoN;
    const tipo  = debitoN > 0 ? 'Egreso' : 'Ingreso';

    // Clasificación automática
    const ai = clasificarEmail_({ subject: String(desc), merchant: String(desc).split(' ')[0], body: '', amount: monto }, shCfg);

    const grupo = tipo === 'Ingreso' ? 'ingreso' : 'gasto';
    const row = [
      Utilities.getUuid(),
      fecha,
      String(desc || '').substring(0, 200),
      grupo,
      ai.category || 'Otros',
      monto,
      baseCur,
      'Bancolombia Ahorro',
      '',
      '',
      'csv_import',
      '',
      '',
      new Date()
    ];

    const nr = nextEmpty_(shT, 2);
    shT.getRange(nr, 1, 1, row.length).setValues([row]);
    imported++;
  }

  CacheService.getScriptCache().removeAll();
  return { ok: true, imported };
}

// ═══════════════════════════════════════════════════════
// ACTUALIZAR PRECIO DE INVERSIÓN
// ═══════════════════════════════════════════════════════
function actualizarPrecioActivo(assetId, nuevoPrecio) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.PORTFOLIO);
  if (!sh) throw new Error('Hoja Inversiones no existe');

  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);
  let updated = 0;

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.inversion_id]||'').trim() === assetId) {
      sh.getRange(r+1, hdr.precio_actual+1).setValue(nuevoPrecio);
      sh.getRange(r+1, hdr.actualizado_el+1).setValue(new Date());
      updated++;
    }
  }

  CacheService.getScriptCache().removeAll();
  return { ok: true, updated };
}

// ═══════════════════════════════════════════════════════
// RESUMEN SEMANAL (para trigger semanal)
// ═══════════════════════════════════════════════════════
function resumenSemanal() {
  const tz  = CFG.TZ;
  const hoy = new Date();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shT = ss.getSheetByName(CFG.SHEETS.TXN);
  const txns= readSheet_(shT);

  // Últimos 7 días
  const hace7 = new Date(hoy.getTime() - 7 * 86400000);
  const semana= txns.filter(r => r.date instanceof Date && r.date >= hace7);

  const income = semana.filter(r => normalizeType_(r.type)==='income').reduce((s,r)=>s+parseNum_(r.amount_base),0);
  const expense= semana.filter(r => normalizeType_(r.type)==='expense').reduce((s,r)=>s+parseNum_(r.amount_base),0);

  Logger.log(`📅 Resumen semanal: Ingresos ${income} | Gastos ${expense} | Neto ${income-expense}`);
  return { income, expense, net: income-expense, txns: semana.length };
}
