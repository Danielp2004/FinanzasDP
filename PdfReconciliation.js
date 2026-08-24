/**
 * FINANZAS AI PRO — PdfReconciliation.gs
 * Conciliación de extractos PDF bancarios con clave
 * Clave por defecto del PDF: 1069582324
 * v3.0 — Lectura IA de PDFs · Alertas inteligentes · Conciliación automática
 */

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN DE CONCILIACIÓN PDF
// ═══════════════════════════════════════════════════════
const PDF_CFG = {
  DEFAULT_PASSWORD: '1069582324',
  AUDIT_SHEET: 'Auditoria_Extractos',
  MAX_PDF_SIZE_MB: 10,
  GEMINI_MODEL: 'gemini-2.0-flash-lite',
  MATCH_DAYS_TOLERANCE: 3,
  MATCH_AMOUNT_TOLERANCE: 0.01
};

// ═══════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — Procesar PDF con clave
// ═══════════════════════════════════════════════════════

/**
 * Procesa un extracto bancario en PDF con clave.
 * Usa Gemini Vision para leer el PDF y extraer movimientos.
 * La clave del PDF siempre es 1069582324.
 *
 * @param {Object} params
 *   params.pdfBase64   {string}  PDF en base64
 *   params.cuenta      {string}  Nombre de la cuenta
 *   params.password    {string}  Clave del PDF (default: 1069582324)
 *   params.autoImport  {boolean} Si importar automáticamente los faltantes
 * @returns {Object} Resultado de la auditoría
 */
function procesarExtractoPDF(params) {
  const apiKey = _aiApiKey_();
  if (!apiKey) throw new Error('Configura tu API key de OpenRouter en Ajustes → Integración IA');

  const pdfBase64 = String(params.pdfBase64 || '').trim();
  const cuenta = String(params.cuenta || 'Bancolombia Ahorro').trim();
  const password = String(params.password || PDF_CFG.DEFAULT_PASSWORD).trim();
  if (!pdfBase64) throw new Error('PDF requerido en base64');

  // Generar hash simple del PDF para detectar duplicados
  const pdfHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, pdfBase64.slice(0, 2000))
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('').slice(0, 16);
  const statementId = 'PDF_' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd_HHmmss');

  // Paso 1: Extraer texto del PDF via Google Drive (una sola vez)
  const textoPlano = _pdfToTextViaDrive_(pdfBase64);
  const bancoDetectado = textoPlano ? _detectarBanco_(textoPlano) : 'desconocido';
  Logger.log('Banco detectado: ' + bancoDetectado);

  const movimientos = _extractMovimientosPDF_(pdfBase64, cuenta, apiKey, password, textoPlano);
  if (!movimientos || movimientos.length === 0) {
    guardarHistorialExtracto({
      statement_id: statementId, cuenta, banco_detectado: bancoDetectado,
      total_movimientos: 0, exactos: 0, aproximados: 0, faltantes: 0, importados: 0,
      estado_final: 'error', notas: 'No se pudieron extraer movimientos'
    });
    const textoDebug = textoPlano && textoPlano.length > 10
      ? 'Texto extraído del PDF (' + textoPlano.length + ' chars): ' + textoPlano.slice(0, 300)
      : 'No se extrajo texto del PDF (posiblemente protegido o escaneado como imagen).';
    return {
      ok: false,
      error: 'No se pudieron extraer movimientos del PDF.\n\n' + textoDebug + '\n\nSi el extracto está protegido con clave, desbloquéalo antes de subirlo. Si el texto se extrajo pero no se detectaron movimientos, puede que el formato del banco no sea reconocido; verifica tu API key de IA en Ajustes → Integración IA.',
      cuenta,
      movimientos: []
    };
  }

  // Paso 2: Auditar SIN auto-importar — el usuario revisa uno a uno en la UI
  const resultado = auditarExtractoBancario_({
    cuenta,
    movimientos,
    statementId,
    autoImport: false
  });

  // Paso 3: Generar análisis IA del extracto
  const analisisIA = _analizarExtractoConIA_(movimientos, cuenta, apiKey);
  resultado.analisisIA = analisisIA;
  resultado.banco_detectado = bancoDetectado;

  // Paso 4: Guardar en historial de extractos
  guardarHistorialExtracto({
    statement_id: statementId,
    cuenta,
    banco_detectado: bancoDetectado,
    total_movimientos: resultado.total_movimientos || movimientos.length,
    exactos:    resultado.exactos    || 0,
    aproximados:resultado.aproximados|| 0,
    faltantes:  resultado.faltantes  || 0,
    importados: resultado.importados || 0,
    estado_final: 'pendiente_revision',
    notas: ''
  });

  // Guardar el review completo para poder reabrirlo sin re-subir el PDF
  guardarReviewExtracto_(statementId, resultado);

  // Paso 5: Crear alertas para faltantes
  if (resultado.faltantes && resultado.faltantes > 0) {
    const faltantesItems = (resultado.review || []).filter(r => r.estado === 'faltante');
    if (faltantesItems.length > 0) _crearAlertasFaltantes_(faltantesItems, cuenta);
  }

  clearCacheForMonth();
  return resultado;
}

// ─── Extracción de movimientos del PDF (acepta texto ya extraído) ─────────
function _extractMovimientosPDF_(pdfBase64, cuenta, apiKey, password, textoYaExtraido) {
  const textoPlano = textoYaExtraido || _pdfToTextViaDrive_(pdfBase64);
  Logger.log('Texto extraído (' + textoPlano.length + ' chars): ' + textoPlano.slice(0, 500));

  if (textoPlano && textoPlano.length > 50) {
    const banco = _detectarBanco_(textoPlano);
    Logger.log('Banco detectado: ' + banco);

    // Intentar todos los parsers regex (incluye variantes de tabla)
    const movsRegex = _parseTextoConRegex_(textoPlano);
    if (movsRegex && movsRegex.length > 0) {
      Logger.log('Regex extrajo ' + movsRegex.length + ' movimientos (banco: ' + banco + ')');
      return movsRegex;
    }

    Logger.log('Regex falló — texto (800): ' + textoPlano.slice(0, 800));

    // Solo usar IA si hay API key disponible
    if (apiKey) {
      const movsIA = _extractViaTextoConIA_(textoPlano, cuenta, apiKey, banco);
      if (movsIA && movsIA.length > 0) return movsIA;
    }
  }

  if (!apiKey) {
    Logger.log('Sin API key — no se puede usar fallback IA');
    return [];
  }

  Logger.log('Fallback a File API...');
  const banco = textoPlano ? _detectarBanco_(textoPlano) : 'desconocido';
  const prompt = _buildPromptExtraccion_(cuenta, banco);
  return _extractViaFileAPI_(pdfBase64, prompt, apiKey, password);
}

// ─── Detectar tipo de banco por el texto del extracto ────────────────────
function _detectarBanco_(texto) {
  const t = texto.toLowerCase();
  if (/nequi|bancolombia.*nequi|nequi.*bancolombia/i.test(t)) return 'nequi';
  if (/nu bank|nubank|nu colombia|cuenta nu/i.test(t)) return 'nu';
  if (/bancolombia/i.test(t)) return 'bancolombia';
  if (/davivienda/i.test(t)) return 'davivienda';
  if (/bbva/i.test(t)) return 'bbva';
  if (/scotiabank|colpatria/i.test(t)) return 'scotiabank';
  if (/av villas/i.test(t)) return 'avvillas';
  if (/banco de bogota|bogota/i.test(t)) return 'bogota';
  return 'generico';
}

// ─── Convertir monto COP con puntos de miles y coma decimal ──────────────
function _parseMontoCOP_(str) {
  if (!str) return NaN;
  const limpio = String(str).replace(/[+\-$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(limpio);
}

// ─── Detectar si una descripción es una transferencia entre cuentas propias ──
// Reglas:
// 1. En Nequi: "RECIBI POR BRE-B DE: Daniel" → el nombre "Daniel" soy yo
// 2. En Nu: "Enviaste a Daniel Alfonso Parrado Cardenas" → yo enviándome a mí mismo
// 3. Cualquier mención a banco propio (Nequi/Nu/etc.) como destino/origen
function _esTransferenciaPropia_(desc) {
  // Nombre propio del titular — detectado por el nombre "Daniel" en el extracto
  const NOMBRE_PROPIO = /\bDaniel\b/i;

  // Nequi BRE-B: "RECIBI POR BRE-B DE: Daniel" o "ENVIO CON BRE-B A: Daniel"
  // Si el nombre es el propio titular → transferencia entre cuentas propias
  if (/BRE-?B/i.test(desc) && NOMBRE_PROPIO.test(desc)) return true;

  // Nu: "Enviaste a Daniel Alfonso Parrado Cardenas" (yo enviándome a Nequi)
  if (/enviaste\s+a\s+Daniel/i.test(desc)) return true;

  // Cualquier banco propio mencionado explícitamente como destino/origen
  if (/\b(nequi|nu\b|daviplata)\b/i.test(desc) &&
      /\b(enviaste\s+a|recibiste\s+de|traslado|desde|hacia)\b/i.test(desc)) return true;

  return false;
}

// ─── Parser regex para extractos de texto plano ──────────────────────────
// Soporta: Nu/Nequi, Bancolombia, Davivienda, BBVA, genérico
function _parseTextoConRegex_(texto) {
  const meses = { ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12,
                  jan:1,apr:4,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const anioMatch = texto.match(/\b(20\d{2})\b/);
  const anio = anioMatch ? anioMatch[1] : new Date().getFullYear().toString();
  const banco = _detectarBanco_(texto);
  let movimientos = [];

  // ── Formato Nequi ──────────────────────────────────────────────────────────
  // El PDF original tiene columnas: Fecha | Descripción | Valor | Saldo
  // Google Drive OCR puede extraerlo de dos formas:
  //   A) Todo en una línea: "24/03/2026  Para BRIAN  $-5,900.00  $119,070.35"
  //   B) Columnas separadas en líneas distintas (tabla fragmentada)
  if (banco === 'nequi') {
    // Variante A: una línea completa con fecha, desc, valor y saldo
    const patronA = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+\$(-?[\d,]+\.?\d*)\s+\$([\d,]+\.?\d*)/gm;
    let m;
    while ((m = patronA.exec(texto)) !== null) {
      const desc = m[4].trim();
      if (/fecha|descripci[oó]n|valor|saldo/i.test(desc)) continue;
      const monto = parseFloat(m[5].replace(/,/g, ''));
      if (!isFinite(monto) || monto === 0) continue;
      const fecha = m[3] + '-' + m[2] + '-' + m[1];
      let tipo = monto > 0
        ? (_esTransferenciaPropia_(desc) ? 'transfer' : 'income')
        : (_esTransferenciaPropia_(desc) ? 'transfer' : 'expense');
      if (/gravamen/i.test(desc)) tipo = 'expense';
      movimientos.push({ fecha, descripcion: desc, monto: Math.abs(monto), tipo, referencia: '', saldo: parseFloat(m[6].replace(/,/g,''))||null });
    }

    // Variante B: líneas separadas — fecha sola, luego descripción, luego valor $-X
    // Reconstruye filas buscando fecha seguida de desc y monto en líneas cercanas
    if (movimientos.length === 0) {
      const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
      let i = 0;
      while (i < lineas.length) {
        const fechaM = lineas[i].match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (fechaM) {
          // La descripción puede estar en la misma línea o en la siguiente
          let desc = '';
          let montoStr = '';
          // Buscar en las siguientes 4 líneas el monto con $
          for (let j = i + 1; j < Math.min(i + 5, lineas.length); j++) {
            const montoM = lineas[j].match(/^\$(-?[\d,]+\.?\d*)$/);
            if (montoM) {
              montoStr = montoM[1];
              // Todo lo que hay entre la fecha y el monto es la descripción
              desc = lineas.slice(i + 1, j).join(' ').trim();
              i = j + 1; // saltar el saldo si viene después
              break;
            }
          }
          if (!desc || !montoStr) { i++; continue; }
          if (/fecha|descripci[oó]n|valor|saldo/i.test(desc)) { i++; continue; }
          const monto = parseFloat(montoStr.replace(/,/g, ''));
          if (!isFinite(monto) || monto === 0) { i++; continue; }
          const fecha = fechaM[3] + '-' + fechaM[2] + '-' + fechaM[1];
          let tipo = monto > 0
            ? (_esTransferenciaPropia_(desc) ? 'transfer' : 'income')
            : (_esTransferenciaPropia_(desc) ? 'transfer' : 'expense');
          if (/gravamen/i.test(desc)) tipo = 'expense';
          movimientos.push({ fecha, descripcion: desc, monto: Math.abs(monto), tipo, referencia: '', saldo: null });
        } else {
          i++;
        }
      }
    }

    // Variante C: fecha y monto en la misma línea, descripción en otra
    // "24/03/2026  $-5,900.00" seguido de "Para BRIAN DELGADO"
    if (movimientos.length === 0) {
      const patronC = /(\d{2})\/(\d{2})\/(\d{4})\s+\$(-?[\d,]+\.?\d*)/gm;
      const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
      lineas.forEach((linea, idx) => {
        const mC = linea.match(/(\d{2})\/(\d{2})\/(\d{4})\s+\$(-?[\d,]+\.?\d*)/);
        if (!mC) return;
        const monto = parseFloat(mC[4].replace(/,/g, ''));
        if (!isFinite(monto) || monto === 0) return;
        const fecha = mC[3] + '-' + mC[2] + '-' + mC[1];
        // Tomar la línea siguiente como descripción
        const desc = (lineas[idx + 1] || '').trim();
        if (!desc || /fecha|saldo|\$/.test(desc)) return;
        let tipo = monto > 0
          ? (_esTransferenciaPropia_(desc) ? 'transfer' : 'income')
          : (_esTransferenciaPropia_(desc) ? 'transfer' : 'expense');
        if (/gravamen/i.test(desc)) tipo = 'expense';
        movimientos.push({ fecha, descripcion: desc, monto: Math.abs(monto), tipo, referencia: '', saldo: null });
      });
    }

    Logger.log('Nequi extrajo ' + movimientos.length + ' movimientos (A/B/C)');
  }

  // ── Formato Nu/Nequi: "01 jun Enviaste a NOMBRE -$50.000,00" ─────────────
  // Regex tolerante: el $ es opcional, el signo puede ir pegado o separado del
  // monto, y acepta montos con puntos de miles y coma decimal. Así funciona
  // aunque la extracción del PDF pierda el símbolo $ o cambie el espaciado.
  if (banco === 'nu' || banco === 'nequi' || movimientos.length === 0) {
    const patronNu = /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\.?\s+(.+?)\s+([+\-]?)\s*\$?\s*([\d][\d.,]*\d|\d)\b/gi;
    let m;
    while ((m = patronNu.exec(texto)) !== null) {
      const mes = meses[m[2].toLowerCase()];
      if (!mes) continue;
      const montoStr = m[4] + m[5];               // signo + número
      const monto = _parseMontoCOP_(montoStr);
      if (!isFinite(monto) || Math.abs(monto) < 1) continue;
      const desc = m[3].trim();
      // Descartar líneas que claramente no son movimientos (encabezados, saldos).
      if (/saldo|total|per[ií]odo|extracto|n[uú]mero de cuenta|^cuenta\b/i.test(desc)) continue;
      // Sin signo explícito y monto pequeño → probable ruido (año, número de cuenta).
      if (!m[4] && Math.abs(monto) < 100) continue;
      const signo = m[4] === '-' ? -1 : 1;
      const tipo = _esTransferenciaPropia_(desc)
        ? 'transfer'
        : (signo > 0 ? 'income' : 'expense');
      movimientos.push({
        fecha: anio + '-' + String(mes).padStart(2,'0') + '-' + m[1].padStart(2,'0'),
        descripcion: desc,
        monto: Math.abs(monto),
        tipo,
        referencia: '', saldo: null
      });
    }
  }

  // ── Formato Bancolombia: "DD/MM/YYYY  DESCRIPCIÓN  DÉBITO  CRÉDITO  SALDO" ──
  if (banco === 'bancolombia' || (banco === 'generico' && movimientos.length === 0)) {
    // Bancolombia usa columnas separadas para débito y crédito
    const patronBanc = /(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})\s{2,}(.+?)\s{2,}([\d.,]+)?\s{2,}([\d.,]+)?\s{2,}([\d.,]+)/gm;
    let m;
    while ((m = patronBanc.exec(texto)) !== null) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const desc = m[4].trim();
      const debito  = m[5] ? _parseMontoCOP_(m[5]) : 0;
      const credito = m[6] ? _parseMontoCOP_(m[6]) : 0;
      if (debito === 0 && credito === 0) continue;
      const monto = debito > 0 ? debito : credito;
      const tipo  = credito > 0 ? 'income' : (/transfer/i.test(desc) ? 'transfer' : 'expense');
      movimientos.push({
        fecha: y + '-' + m[2] + '-' + m[1],
        descripcion: desc,
        monto: Math.abs(monto),
        tipo,
        referencia: '', saldo: null
      });
    }
  }

  // ── Formato Davivienda / BBVA / AV Villas: "DD/MM/YYYY DESCRIPCIÓN MONTO±" ──
  if (banco === 'davivienda' || banco === 'bbva' || banco === 'avvillas' || banco === 'bogota' ||
      banco === 'scotiabank' || (banco === 'generico' && movimientos.length === 0)) {
    const patronDavi = /(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})\s+(.+?)\s+([\-]?\$?[\d.,]+)\s*$/gm;
    let m;
    while ((m = patronDavi.exec(texto)) !== null) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const desc = m[4].trim();
      const monto = _parseMontoCOP_(m[5]);
      if (!isFinite(monto) || monto === 0) continue;
      movimientos.push({
        fecha: y + '-' + m[2] + '-' + m[1],
        descripcion: desc,
        monto: Math.abs(monto),
        tipo: monto < 0 ? 'expense' : 'income',
        referencia: '', saldo: null
      });
    }
  }

  // ── Fallback genérico: "DD/MM/YYYY ... monto" ────────────────────────────
  if (movimientos.length === 0) {
    const patronGenerico = /(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})\s+(.+?)\s+([\-]?[\d.,]+)\s*$/gm;
    let m;
    while ((m = patronGenerico.exec(texto)) !== null) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const desc = m[4].trim();
      const monto = _parseMontoCOP_(m[5]);
      if (!isFinite(monto) || monto === 0) continue;
      movimientos.push({
        fecha: y + '-' + m[2] + '-' + m[1],
        descripcion: desc,
        monto: Math.abs(monto),
        tipo: monto < 0 ? 'expense' : 'income',
        referencia: '', saldo: null
      });
    }
  }

  return movimientos;
}

// ─── Convertir PDF a texto plano via Google Drive ────────────────────────
// Convierte el PDF a Google Doc y extrae el texto. Gratis, sin tokens de IA.
function _pdfToTextViaDrive_(pdfBase64) {
  let fileId = null;
  let docId = null;
  try {
    const pdfBytes = Utilities.base64Decode(pdfBase64);
    const blob = Utilities.newBlob(pdfBytes, 'application/pdf', 'extracto_tmp.pdf');

    // Subir a Drive
    const file = DriveApp.createFile(blob);
    fileId = file.getId();

    // Convertir a Google Doc (Drive lo hace automáticamente con OCR)
    const convUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?supportsAllDrives=true';
    const token = ScriptApp.getOAuthToken();
    const convRes = UrlFetchApp.fetch(convUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: 'extracto_doc_tmp' }),
      muteHttpExceptions: true
    });

    if (convRes.getResponseCode() !== 200) {
      Logger.log('Drive convert error: ' + convRes.getContentText().slice(0, 300));
      return '';
    }

    docId = JSON.parse(convRes.getContentText()).id;

    // Exportar como texto plano
    const exportRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/plain',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );

    if (exportRes.getResponseCode() !== 200) {
      Logger.log('Drive export error: ' + exportRes.getResponseCode());
      return '';
    }

    return exportRes.getContentText();
  } catch(e) {
    Logger.log('_pdfToTextViaDrive_ error: ' + e);
    return '';
  } finally {
    // Limpiar archivos temporales
    try { if (fileId)  DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {}
    try { if (docId)   DriveApp.getFileById(docId).setTrashed(true);  } catch(e) {}
  }
}

// ─── Extraer movimientos mandando texto a la IA (OpenRouter), POR TROZOS ──
// Los modelos gratis son lentos (pueden tardar >60s con textos largos), y
// UrlFetchApp de Apps Script corta a ~60s. Por eso dividimos el texto en
// trozos pequeños: cada llamada es rápida y no se cuelga. El regex ya corrió
// antes; esto es el respaldo cuando el regex no encontró nada.
function _extractViaTextoConIA_(textoPlano, cuenta, apiKey, banco) {
  try {
    const lineas = String(textoPlano).split('\n').map(l => l.trim()).filter(Boolean);
    // Nos quedamos sólo con líneas que parecen movimientos (empiezan por día+mes
    // o contienen un monto), para no gastar tokens en encabezados.
    const relevantes = lineas.filter(l =>
      /\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i.test(l) ||
      /[\$]|\d[\d.,]{2,}/.test(l)
    );
    const fuente = relevantes.length >= 3 ? relevantes : lineas;

    // Trozos de ~25 líneas: cada llamada procesa poco y responde en <45s.
    const TAM = 25;
    const todos = [];
    for (let i = 0; i < fuente.length; i += TAM) {
      const trozo = fuente.slice(i, i + TAM).join('\n');
      if (!trozo.trim()) continue;
      const prompt = _buildPromptExtraccion_(cuenta, banco) + '\n\nTEXTO DEL EXTRACTO (parte):\n' + trozo;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      };
      const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
      Logger.log('TextoIA trozo ' + (i / TAM + 1) + ' status: ' + res.code);
      if (res.code === 200) {
        const movs = _parseGeminiMovimientos_(JSON.stringify(res.geminiJson));
        for (let k = 0; k < movs.length; k++) todos.push(movs[k]);
      } else if (res.code === 429) {
        Logger.log('TextoIA 429 — límite de la IA; se detiene el fallback IA.');
        break;
      }
      // Cortafuegos de tiempo: no procesar más de 6 trozos (~150 líneas) para
      // no acercarnos al límite total de ejecución de Apps Script.
      if (i / TAM >= 5) { Logger.log('TextoIA: corte por seguridad tras 6 trozos'); break; }
    }
    Logger.log('TextoIA total movimientos: ' + todos.length);
    return todos;
  } catch(e) {
    Logger.log('_extractViaTextoConIA_ error: ' + e);
    return [];
  }
}

// ─── Prompt reutilizable (acepta banco detectado para contexto) ──────────
function _buildPromptExtraccion_(cuenta, banco) {
  const bancoHint = banco && banco !== 'generico' && banco !== 'desconocido'
    ? 'Banco/entidad: ' + banco.charAt(0).toUpperCase() + banco.slice(1) + '. '
    : '';
  const formatosConocidos = {
    nu:          'Formato Nu: "DD mes descripcion [+/-]$monto" con puntos de miles y coma decimal.',
    nequi:       'Formato Nequi/Nu: "DD mes descripcion [+/-]$monto".',
    bancolombia: 'Formato Bancolombia: tabla con columnas fecha, descripción, débito, crédito, saldo.',
    davivienda:  'Formato Davivienda: fecha, descripcion, valor (negativo=débito).',
    bbva:        'Formato BBVA Colombia: fecha, concepto, importe.',
    avvillas:    'Formato AV Villas: fecha, descripción, débitos, créditos, saldo.'
  };
  const fmtHint = banco && formatosConocidos[banco] ? formatosConocidos[banco] + ' ' : '';

  return [
    'Eres un extractor de datos bancarios colombianos. Lee este extracto y extrae TODOS los movimientos.',
    'Cuenta bancaria: ' + cuenta + '. ' + bancoHint + fmtHint,
    'IMPORTANTE: Extrae CADA movimiento sin excepción. El extracto está en español (Colombia).',
    '',
    'Devuelve SOLO este JSON válido (sin markdown, sin texto extra):',
    '{"movimientos":[',
    '  {"fecha":"YYYY-MM-DD","descripcion":"texto exacto del banco","monto":123456.78,"tipo":"expense|income|transfer","referencia":"123456","saldo":987654.32}',
    ']}',
    '',
    'Reglas:',
    '- Débitos, cargos, pagos, compras, gravamen al movimiento => "expense"',
    '- Créditos, abonos, consignaciones, depósitos => "income"',
    '- Transferencias entre cuentas propias del titular => "transfer". El titular se llama Daniel Alfonso Parrado Cardenas.',
    '- En Nequi: "RECIBI POR BRE-B DE: Daniel" o "ENVIO CON BRE-B A: Daniel" => "transfer" (es él mismo)',
    '- En Nu: "Enviaste a Daniel Alfonso Parrado Cardenas" => "transfer" (se envió a sí mismo a Nequi)',
    '- Si el nombre en el movimiento NO es Daniel (ej: "Para BRIAN DELGADO") => "expense" o "income"',
    '- monto siempre positivo',
    '- fecha formato YYYY-MM-DD obligatorio',
    '- Si el monto tiene puntos de miles (ej: 1.234.567), conviértelo al número 1234567',
    '- NO incluyas totales, subtotales ni encabezados'
  ].join('\n');
}

// ─── Estrategia 1: PDF directo a la IA (OpenRouter file-parser) ─────────
// OpenRouter no tiene File API; se manda el PDF inline y el plugin
// file-parser (motor pdf-text) lo procesa gratis. Ver AIProvider.js.
function _extractViaFileAPI_(pdfBase64, prompt, apiKey, password) {
  try {
    const genPayload = {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    };

    const genRes = aiGenerateContent_(AI_CFG.MODEL, genPayload, apiKey);
    Logger.log('PDF IA status: ' + genRes.code);
    Logger.log('PDF IA body (500): ' + genRes.raw.slice(0, 500));

    const movs = genRes.code === 200 ? _parseGeminiMovimientos_(JSON.stringify(genRes.geminiJson)) : [];
    Logger.log('PDF IA movimientos extraídos: ' + movs.length);
    return movs;
  } catch(e) {
    Logger.log('Error PDF IA: ' + e);
    return [];
  }
}

// ─── Estrategia 2: inlineData base64 ────────────────────────────────────
function _extractViaInlineData_(pdfBase64, prompt, apiKey) {
  try {
    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    };

    const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
    Logger.log('inlineData status: ' + res.code);
    if (res.code !== 200) {
      Logger.log('inlineData error: ' + res.raw.slice(0, 500));
      return [];
    }
    const movs = _parseGeminiMovimientos_(JSON.stringify(res.geminiJson));
    Logger.log('inlineData movimientos: ' + movs.length);
    return movs;
  } catch(e) {
    Logger.log('Error inlineData: ' + e);
    return [];
  }
}

// ─── Parser de respuesta Gemini ──────────────────────────────────────────
function _parseGeminiMovimientos_(responseText) {
  try {
    const json = JSON.parse(responseText);
    let text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    Logger.log('Gemini text (300): ' + text.slice(0, 300));

    // Limpiar markdown code blocks si los hay
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      // Buscar el primer objeto JSON válido en el texto
      const match = text.match(/\{[\s\S]*"movimientos"[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch(e2) {}
      }
    }

    if (!parsed?.movimientos) {
      Logger.log('Sin campo movimientos en respuesta. parsed: ' + JSON.stringify(parsed)?.slice(0,200));
      return [];
    }

    return parsed.movimientos.map(m => ({
      fecha: m.fecha,
      descripcion: String(m.descripcion || '').trim(),
      monto: Math.abs(parseNum_(m.monto)),
      tipo: String(m.tipo || 'expense').toLowerCase(),
      referencia: String(m.referencia || '').trim(),
      saldo: m.saldo ? parseNum_(m.saldo) : null
    })).filter(m => m.monto > 0 && m.fecha);
  } catch(e) {
    Logger.log('Error parseando respuesta Gemini: ' + e);
    return [];
  }
}

// ─── Fallback: enviar como texto si el PDF es simple ────────────────────
function _fallbackParseExtractoTexto_(pdfBase64, cuenta, apiKey) {
  try {
    const pdfBytes = Utilities.base64Decode(pdfBase64);
    const blob = Utilities.newBlob(pdfBytes, 'application/pdf', 'extracto.pdf');
    const textContent = blob.getAs('text/plain').getDataAsString();
    if (textContent && textContent.length > 50) {
      return aiParseExtractoText_(textContent, cuenta, SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEETS.CONFIG));
    }
  } catch(e) {
    Logger.log('Fallback texto PDF: ' + e);
  }
  return [];
}

// ─── Análisis IA del extracto ────────────────────────────────────────────
function _analizarExtractoConIA_(movimientos, cuenta, apiKey) {
  if (!apiKey || !movimientos.length) return null;

  const totalIngresos = movimientos.filter(m => m.tipo === 'income').reduce((s, m) => s + m.monto, 0);
  const totalGastos = movimientos.filter(m => m.tipo === 'expense').reduce((s, m) => s + m.monto, 0);
  const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  const resumen = movimientos.slice(0, 30).map(m =>
    `${m.fecha} | ${m.tipo} | ${COP.format(m.monto)} | ${m.descripcion}`
  ).join('\n');

  const prompt = `Analiza este extracto bancario de la cuenta "${cuenta}" y dame insights financieros útiles en español.

Total ingresos: ${COP.format(totalIngresos)}
Total gastos: ${COP.format(totalGastos)}
Movimientos: ${movimientos.length}

Extracto (muestra):
${resumen}

Dame:
1. Un resumen ejecutivo de 2 oraciones
2. Los 3 gastos más relevantes o inusuales
3. Una recomendación financiera específica basada en los patrones
4. ¿Hay algún cobro que podría ser evitable?

Responde en español, conciso y práctico. Formato JSON:
{"resumen":"...","gastos_relevantes":["..."],"recomendacion":"...","cobros_evitables":"..."}`;

  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 800, responseMimeType: 'application/json' }
    };
    const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
    if (res.code !== 200) return null;
    const text = (res.text || '').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch(e) {
    return null;
  }
}

// ─── Crear alertas para movimientos faltantes ───────────────────────────
function _crearAlertasFaltantes_(faltantes, cuenta) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let shAlerts = ss.getSheetByName('Alertas_Sistema');
  if (!shAlerts) {
    shAlerts = ss.insertSheet('Alertas_Sistema');
    shAlerts.getRange(1, 1, 1, 6).setValues([['alerta_id', 'tipo', 'mensaje', 'cuenta', 'monto', 'creado_el']]);
    shAlerts.setFrozenRows(1);
  }

  const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  faltantes.forEach(f => {
    const row = [
      Utilities.getUuid(),
      'movimiento_faltante',
      `Movimiento del extracto NO registrado: ${f.descripcion} (${COP.format(f.monto)}) del ${f.fecha}`,
      cuenta,
      f.monto,
      new Date()
    ];
    shAlerts.appendRow(row);
  });
}

// ═══════════════════════════════════════════════════════
// SISTEMA DE ALERTAS INTELIGENTES
// ═══════════════════════════════════════════════════════

/**
 * Motor de alertas automáticas — se ejecuta via trigger diario
 * Detecta: gastos no registrados, presupuestos excedidos,
 * días sin actividad, patrones inusuales
 */
function verificarAlertasInteligentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shCfg = ss.getSheetByName(CFG.SHEETS.CONFIG);
  const apiKey = _aiApiKey_();
  const tz = CFG.TZ;
  const hoy = new Date();
  const mesActual = Utilities.formatDate(hoy, tz, 'yyyy-MM');
  const diaHoy = parseInt(Utilities.formatDate(hoy, tz, 'dd'));
  const alertas = [];

  // ── 1. Días consecutivos sin movimientos ──────────────────────────────
  const shMov = ss.getSheetByName(CFG.SHEETS.MOV);
  if (shMov) {
    const txns = readSheet_(shMov);
    const mesActualTxns = txns.filter(r => {
      const d = parseSheetDate_(r.fecha);
      return d instanceof Date && Utilities.formatDate(d, tz, 'yyyy-MM') === mesActual;
    });

    const diasConMovimiento = new Set(mesActualTxns.map(r => {
      const d = parseSheetDate_(r.fecha);
      return d instanceof Date ? Utilities.formatDate(d, tz, 'dd') : null;
    }).filter(Boolean));

    let diasSinActividad = 0;
    for (let d = diaHoy; d >= 1; d--) {
      if (diasConMovimiento.has(String(d).padStart(2, '0'))) break;
      diasSinActividad++;
    }

    if (diasSinActividad >= 3) {
      alertas.push({
        tipo: 'sin_actividad',
        nivel: diasSinActividad >= 7 ? 'critica' : 'advertencia',
        titulo: `${diasSinActividad} días sin registrar movimientos`,
        mensaje: `Llevas ${diasSinActividad} días sin registrar ningún movimiento. Revisa si olvidaste registrar gastos del ${diaHoy - diasSinActividad} al ${diaHoy} de este mes.`,
        accion: 'Ir a Movimientos y registrar tus gastos pendientes'
      });
    }

    // ── 2. Gasto inusualmente alto ──────────────────────────────────────
    const gastosHoy = txns.filter(r => {
      const d = parseSheetDate_(r.fecha);
      return d instanceof Date &&
        Utilities.formatDate(d, tz, 'yyyy-MM-dd') === Utilities.formatDate(hoy, tz, 'yyyy-MM-dd') &&
        normalizeType_(r.grupo) === 'expense';
    });

    const totalHoy = gastosHoy.reduce((s, r) => s + Math.abs(parseNum_(r.monto)), 0);
    const promedioMes = mesActualTxns.filter(r => normalizeType_(r.grupo) === 'expense')
      .reduce((s, r) => s + Math.abs(parseNum_(r.monto)), 0) / Math.max(1, diaHoy);

    if (totalHoy > promedioMes * 3 && totalHoy > 100000) {
      const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
      alertas.push({
        tipo: 'gasto_inusual',
        nivel: 'advertencia',
        titulo: 'Gasto inusualmente alto hoy',
        mensaje: `Hoy gastaste ${COP.format(totalHoy)}, que es ${Math.round(totalHoy/promedioMes)}x tu promedio diario de ${COP.format(promedioMes)}.`,
        accion: 'Revisa si todos los gastos de hoy están bien categorizados'
      });
    }
  }

  // ── 3. Presupuestos a punto de excederse ────────────────────────────
  const shPres = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
  if (shPres && shMov) {
    const presupuestos = readSheet_(shPres).filter(r => r.activo !== false && String(r.activo) !== 'false');
    const txnsMes = readSheet_(shMov).filter(r => {
      const d = parseSheetDate_(r.fecha);
      return d instanceof Date && Utilities.formatDate(d, tz, 'yyyy-MM') === mesActual;
    });

    presupuestos.forEach(b => {
      const cat = String(b.categoría || b.categoria || '').trim();
      const limite = parseNum_(b.límite || b.limite);
      if (!limite) return;
      const gastado = txnsMes.filter(r => normalizeType_(r.grupo) === 'expense' && String(r.categoría || r.categoria || '').trim() === cat)
        .reduce((s, r) => s + Math.abs(parseNum_(r.monto)), 0);
      const pct = (gastado / limite) * 100;
      if (pct >= 90) {
        const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
        alertas.push({
          tipo: 'presupuesto_critico',
          nivel: pct >= 100 ? 'critica' : 'advertencia',
          titulo: `Presupuesto ${cat}: ${Math.round(pct)}% usado`,
          mensaje: `Ya usaste ${COP.format(gastado)} de ${COP.format(limite)} en "${cat}". ${pct >= 100 ? '¡Excedido!' : `Solo quedan ${COP.format(limite - gastado)}.`}`,
          accion: pct >= 100 ? 'Analiza cómo reducir gastos en esta categoría' : 'Modera los gastos en esta categoría por el resto del mes'
        });
      }
    });
  }

  // ── 4. Correos pendientes de clasificar ─────────────────────────────
  const shCorrr = ss.getSheetByName(CFG.SHEETS.CORREOS);
  if (shCorrr) {
    const pendientes = readSheet_(shCorrr).filter(r => String(r.estado || '') === 'pendiente').length;
    if (pendientes > 0) {
      alertas.push({
        tipo: 'correos_pendientes',
        nivel: pendientes > 5 ? 'advertencia' : 'info',
        titulo: `${pendientes} correo(s) pendientes de revisar`,
        mensaje: `Tienes ${pendientes} correo(s) con transacciones detectadas que necesitan tu revisión o aprobación.`,
        accion: 'Ir a la sección Emails y aprobar o categorizar los correos pendientes'
      });
    }
  }

  // ── 5. Recordatorio fin de mes — conciliación ────────────────────────
  const diasRestantes = new Date(parseInt(mesActual.split('-')[0]), parseInt(mesActual.split('-')[1]), 0).getDate() - diaHoy;
  if (diasRestantes <= 5) {
    alertas.push({
      tipo: 'fin_mes',
      nivel: 'info',
      titulo: `Fin de mes en ${diasRestantes} días — Concilia tu extracto`,
      mensaje: `Quedan ${diasRestantes} días para fin de mes. Es el momento ideal para subir tu extracto bancario PDF (clave: ${PDF_CFG.DEFAULT_PASSWORD}) y verificar que todos los movimientos estén registrados.`,
      accion: 'Ir a Cuentas > Conciliar con extracto PDF'
    });
  }

  // ── 6. IA — Análisis de patrones con Gemini ──────────────────────────
  if (apiKey && alertas.length === 0) {
    alertas.push({
      tipo: 'estado_ok',
      nivel: 'exito',
      titulo: 'Tus finanzas están al día',
      mensaje: 'No hay alertas críticas. Sigue así y recuerda conciliar con tu extracto bancario al fin del mes.',
      accion: null
    });
  }

  // Guardar alertas en hoja del sistema
  _guardarAlertas_(ss, alertas);

  Logger.log(`✅ Alertas verificadas: ${alertas.length} alertas generadas`);
  return { ok: true, alertas };
}

// ─── Guardar alertas en hoja ─────────────────────────────────────────────
function _guardarAlertas_(ss, alertas) {
  let sh = ss.getSheetByName('Alertas_Sistema');
  if (!sh) {
    sh = ss.insertSheet('Alertas_Sistema');
    sh.getRange(1, 1, 1, 8).setValues([['alerta_id','tipo','nivel','titulo','mensaje','accion','cuenta','creado_el']]);
    sh.setFrozenRows(1);
  }

  alertas.forEach(a => {
    sh.appendRow([
      Utilities.getUuid(),
      a.tipo || '',
      a.nivel || 'info',
      a.titulo || '',
      a.mensaje || '',
      a.accion || '',
      a.cuenta || '',
      new Date()
    ]);
  });
}

// ─── Obtener alertas activas para la UI ─────────────────────────────────
function getAlertasActivas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Alertas_Sistema');

  // Siempre ejecutar verificación en tiempo real
  const resultado = verificarAlertasInteligentes();

  if (!sh) return resultado.alertas || [];

  const hoy = new Date();
  const hoyStr = Utilities.formatDate(hoy, CFG.TZ, 'yyyy-MM-dd');

  const alertasHoy = readSheet_(sh)
    .filter(r => {
      const creado = parseSheetDate_(r.creado_el);
      return creado instanceof Date && Utilities.formatDate(creado, CFG.TZ, 'yyyy-MM-dd') === hoyStr;
    })
    .map(r => ({
      tipo: String(r.tipo || ''),
      nivel: String(r.nivel || 'info'),
      titulo: String(r.titulo || ''),
      mensaje: String(r.mensaje || ''),
      accion: String(r.accion || '')
    }));

  return alertasHoy.length > 0 ? alertasHoy : resultado.alertas || [];
}

// ═══════════════════════════════════════════════════════
// ASISTENTE IA FINANCIERO AVANZADO
// ═══════════════════════════════════════════════════════

/**
 * Chat IA con contexto financiero completo del usuario.
 * Puede categorizar, registrar gastos, dar trucos, analizar patrones.
 */
function chatFinanciero(pregunta, historialChat) {
  const apiKey = _aiApiKey_();
  if (!apiKey) return { ok: false, respuesta: 'Configura tu API Key de Gemini para usar el asistente IA.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = CFG.TZ;
  const mesActual = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  // Obtener contexto financiero del usuario
  const contexto = _buildContextoFinanciero_(ss, mesActual);

  const systemPrompt = `Eres un asesor financiero personal experto para Colombia. Tienes acceso al resumen financiero actualizado del usuario y puedes ayudarlo con:

1. CATEGORIZAR gastos: si menciona un gasto, sugieres la categoría correcta
2. REGISTRAR: si quiere anotar algo, extraes fecha/monto/categoría y confirmas
3. TRUCOS financieros para ahorrar en Colombia (Nequi, Daviplata, CDTs, ETFs en Trii/Nu)
4. ANALIZAR patrones de gasto y dar recomendaciones específicas
5. CONCILIACIÓN: explicar cómo conciliar con el extracto bancario
6. INVERSIONES: consejos sobre ETFs, acciones, CDTs, tasas actuales
7. ALERTAS: recordar registrar movimientos, presupuestos

CONTEXTO FINANCIERO ACTUAL DEL USUARIO (${mesActual}):
${contexto}

REGLAS:
- Responde SIEMPRE en español, tono cercano pero profesional
- Si detectas un gasto en el mensaje (monto + descripción), extrae la info y sugiere registrarlo
- Da consejos ESPECÍFICOS para Colombia (tasas CDT, fondos, impuestos 4x1000, etc.)
- Si no tienes suficiente info, pídela de forma concisa
- Máximo 200 palabras por respuesta salvo análisis complejos
- Usa emojis con moderación (1-2 máximo por respuesta)

Para acciones de registro responde con JSON al final:
{"accion":"registrar","monto":25000,"categoria":"Alimentos","descripcion":"Almuerzo","tipo":"Egreso"}`;

  const messages = [];
  if (historialChat && historialChat.length > 0) {
    historialChat.slice(-6).forEach(msg => {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    });
  }
  messages.push({ role: 'user', parts: [{ text: pregunta }] });

  try {
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: messages,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    };

    const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
    if (res.code !== 200) {
      return { ok: false, respuesta: 'Error conectando con la IA. Intenta de nuevo.' };
    }

    const respuesta = res.text || 'Sin respuesta';

    // Detectar acción de registro
    let accion = null;
    const jsonMatch = respuesta.match(/\{[^{}]*"accion"\s*:\s*"registrar"[^{}]*\}/);
    if (jsonMatch) {
      try { accion = JSON.parse(jsonMatch[0]); } catch(e) {}
    }

    return {
      ok: true,
      respuesta: respuesta.replace(/\{[^{}]*"accion"[^{}]*\}/g, '').trim(),
      accion
    };
  } catch(e) {
    Logger.log('Error chat IA: ' + e);
    return { ok: false, respuesta: 'Error interno del asistente. Intenta de nuevo.' };
  }
}

// ─── Construir contexto financiero para la IA ────────────────────────────
function _buildContextoFinanciero_(ss, mes) {
  try {
    const tz = CFG.TZ;
    const shMov = ss.getSheetByName(CFG.SHEETS.MOV);
    const shAcc = ss.getSheetByName(CFG.SHEETS.CUENTAS);
    const shPres = ss.getSheetByName(CFG.SHEETS.PRESUPUESTO);
    const shInv = ss.getSheetByName(CFG.SHEETS.INVERSIONES);
    const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

    const txns = shMov ? readSheet_(shMov) : [];
    const mesTxns = txns.filter(r => {
      const d = parseSheetDate_(r.fecha);
      return d instanceof Date && Utilities.formatDate(d, tz, 'yyyy-MM') === mes;
    });

    const ingresos = mesTxns.filter(r => normalizeType_(r.grupo) === 'income').reduce((s, r) => s + parseNum_(r.monto), 0);
    const gastos = mesTxns.filter(r => normalizeType_(r.grupo) === 'expense').reduce((s, r) => s + parseNum_(r.monto), 0);
    const ahorro = ingresos - gastos;
    const tasaAhorro = ingresos > 0 ? (ahorro / ingresos * 100).toFixed(1) : '0';

    const byCat = {};
    mesTxns.filter(r => normalizeType_(r.grupo) === 'expense').forEach(r => {
      const c = String(r.categoría || r.categoria || 'Otros').trim();
      byCat[c] = (byCat[c] || 0) + parseNum_(r.monto);
    });
    const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const cuentas = shAcc ? readSheet_(shAcc).filter(r => r.activa !== false && String(r.activa) !== 'false') : [];
    const totalEfectivo = cuentas.reduce((s, r) => s + parseNum_(r.saldo), 0);

    const presupuestos = shPres ? readSheet_(shPres).filter(r => r.activo !== false) : [];
    const presExcedidos = presupuestos.filter(b => {
      const cat = String(b.categoría || b.categoria || '').trim();
      const limite = parseNum_(b.límite || b.limite);
      const gastado = (byCat[cat] || 0);
      return limite > 0 && gastado > limite * 0.9;
    });

    const inversiones = shInv ? readSheet_(shInv) : [];
    const totalInv = inversiones.reduce((s, r) => s + parseNum_(r.vr_mercado_actual || r.vr_mercado_actual_base || 0), 0);

    const lines = [
      `Mes: ${mes}`,
      `Ingresos: ${COP.format(ingresos)}`,
      `Gastos: ${COP.format(gastos)}`,
      `Ahorro: ${COP.format(ahorro)} (${tasaAhorro}% tasa de ahorro)`,
      `Saldo efectivo total: ${COP.format(totalEfectivo)}`,
      `Portafolio inversiones: ${COP.format(totalInv)}`,
      `Top gastos: ${topCats.map(([c, v]) => `${c}: ${COP.format(v)}`).join(', ')}`,
      `Movimientos este mes: ${mesTxns.length}`,
    ];

    if (presExcedidos.length > 0) {
      lines.push(`ALERTAS PRESUPUESTO: ${presExcedidos.map(b => String(b.categoría || b.categoria)).join(', ')} cerca del límite`);
    }

    if (cuentas.length > 0) {
      lines.push(`Cuentas: ${cuentas.map(c => `${c.nombre}: ${COP.format(parseNum_(c.saldo))}`).join(', ')}`);
    }

    return lines.join('\n');
  } catch(e) {
    return 'Contexto no disponible: ' + e.message;
  }
}

// ═══════════════════════════════════════════════════════
// TRIGGER — Verificación diaria de alertas
// ═══════════════════════════════════════════════════════
function setupAlertasTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'verificarAlertasInteligentes')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('verificarAlertasInteligentes')
    .timeBased().everyDays(1).atHour(9).create();

  Logger.log('✅ Trigger de alertas configurado: 9am diario');
}

// ═══════════════════════════════════════════════════════
// TRUCOS IA — Consejos financieros personalizados
// ═══════════════════════════════════════════════════════
function getTrucosFinancieros() {
  const apiKey = _aiApiKey_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mes = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM');
  const contexto = _buildContextoFinanciero_(ss, mes);

  if (!apiKey) {
    return _trucosEstaticos_();
  }

  try {
    const prompt = `Basándote en este resumen financiero del usuario colombiano:
${contexto}

Genera 5 trucos o consejos financieros MUY ESPECÍFICOS y ACCIONABLES para Colombia.
Considera: CDTs, Nequi/Daviplata, ETFs en Trii/Nu, impuesto 4x1000, fondos voluntarios de pensión, DIAN, Bolsa de Colombia.

Formato JSON obligatorio:
{"trucos":[
  {"emoji":"💡","titulo":"Título corto","consejo":"Consejo específico de máx 80 palabras con acción concreta"},
  ...
]}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 1200, responseMimeType: 'application/json' }
    };
    const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
    if (res.code === 200) {
      const text = (res.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(text);
      return parsed?.trucos || _trucosEstaticos_();
    }
  } catch(e) {
    Logger.log('Trucos IA error: ' + e);
  }

  return _trucosEstaticos_();
}

function _trucosEstaticos_() {
  return [
    { emoji: '💰', titulo: 'CDT Digital al mejor rendimiento', consejo: 'Los CDTs digitales de Bancolombia, Nu y Lulo Bank ofrecen tasas entre 11-13% EA. Invierte el dinero que no usarás en 30-90 días en lugar de tenerlo en cuenta de ahorros (que rinde apenas 1-2%).' },
    { emoji: '🚫', titulo: 'Evita el 4x1000', consejo: 'Cada retiro de efectivo o transferencia entre bancos distintos cobra el 4x1000. Usa Nequi o Daviplata para transferencias internas, y consolida tus pagos en un solo banco para minimizar transacciones gravadas.' },
    { emoji: '📈', titulo: 'ETFs desde $1 dólar en Trii', consejo: 'Con Trii puedes invertir en el S&P 500 (SPY/VOO) desde $1 USD. Una estrategia DCA (compra mensual fija) de $100k COP en ETF diversificado históricamente supera la inflación y los CDTs en 5+ años.' },
    { emoji: '🎯', titulo: 'Fondo Voluntario de Pensión', consejo: 'Los aportes al Fondo Voluntario de Pensión son deducibles de impuestos (hasta 30% del ingreso). Si pagas renta, este beneficio puede ahorrate millones. Consulta con Protección, Porvenir o Old Mutual.' },
    { emoji: '⚡', titulo: 'Regla 50-30-20 adaptada a Colombia', consejo: '50% para gastos fijos (arriendo, servicios, mercado), 30% para gastos variables y ocio, 20% para ahorro e inversión. Si no llegas al 20% de ahorro, empieza con el 10% y automatiza la transferencia el día de nómina.' }
  ];
}

// ═══════════════════════════════════════════════════════
// CATEGORIZACIÓN IA MASIVA
// ═══════════════════════════════════════════════════════

/**
 * Categoriza automáticamente movimientos sin categoría.
 * Estrategia: 1º memoria APRENDIDA de tu historial (instantánea) para todo lo
 * que reconozca; 2º IA (OpenRouter) solo para los que la memoria no supo. Así
 * es rápido, barato y aprovecha tus propias categorizaciones pasadas.
 */
function categorizarMovimientosSinCategoria() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!sh) return { ok: false, error: 'Hoja Movimientos no encontrada' };

  const data = sh.getDataRange().getValues();
  const hdr = rowToObj_(data[0]);
  const catCol = hdr.categor_a ?? hdr.categoria ?? hdr['categoría'];
  const descCol = hdr.descripci_n ?? hdr.descripcion ?? hdr['descripción'];
  const sinCat = [];

  for (let r = 1; r < data.length; r++) {
    const cat = String(data[r][catCol] || '').trim();
    const desc = String(data[r][descCol] || '').trim();
    if ((!cat || cat === 'Otros' || cat === '') && desc) {
      sinCat.push({ row: r + 1, desc, monto: data[r][hdr.monto], grupo: data[r][hdr.grupo] });
    }
  }

  if (!sinCat.length) return { ok: true, categorizados: 0, mensaje: 'Todos los movimientos ya tienen categoría' };

  const targetCol = (catCol != null ? catCol : 4) + 1;
  let porMemoria = 0, porIA = 0;
  const model = _lcBuildModel_(true);   // modelo fresco de tu historial

  // ── Paso 1: memoria aprendida (instantánea) ──────────────────────────────
  const pendientesIA = [];
  sinCat.forEach(function (m) {
    const pred = _learnedClassify_({ description: m.desc, merchant: m.desc }, model);
    if (pred && pred.category && pred.category !== 'Otros') {
      sh.getRange(m.row, targetCol).setValue(pred.category);
      porMemoria++;
    } else {
      pendientesIA.push(m);
    }
  });

  // ── Paso 2: IA solo para lo que la memoria no supo (en lotes pequeños) ────
  const apiKey = _aiApiKey_();
  if (apiKey && pendientesIA.length) {
    const LOTE = 15;
    for (let i = 0; i < pendientesIA.length && i < 60; i += LOTE) {  // tope 60 por corrida
      const batch = pendientesIA.slice(i, i + LOTE);
      const prompt = 'Categoriza estos movimientos bancarios colombianos. Categorías: Alimentos, Transporte, Servicios, Salud, Entretenimiento, Educación, Ropa, Hogar, Mascotas, Viajes, Ingresos, Transferencia, Aporte a inversiones, Otros.\n\nMovimientos:\n' +
        batch.map(function (m, j) { return (j + 1) + '. ' + m.desc + ' (' + (m.grupo || 'gasto') + ')'; }).join('\n') +
        '\n\nResponde JSON: {"categorias":["Alimentos",...]} — un elemento por movimiento, mismo orden.';
      try {
        const res = aiGenerateContent_(AI_CFG.MODEL, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }
        }, apiKey);
        if (res.code === 200) {
          const parsed = JSON.parse((res.text || '{}').replace(/```json|```/g, '').trim());
          const cats = (parsed && parsed.categorias) || [];
          batch.forEach(function (m, j) {
            const c = cats[j];
            if (c && c !== 'Otros') { sh.getRange(m.row, targetCol).setValue(c); porIA++; }
          });
        }
      } catch (e) { Logger.log('categorizar IA lote: ' + e); }
    }
  }

  _lcInvalidate_();       // el modelo cambió → invalidar caché
  clearCacheForMonth();
  return {
    ok: true,
    categorizados: porMemoria + porIA,
    porMemoria: porMemoria,
    porIA: porIA,
    total: sinCat.length,
    mensaje: porMemoria + ' por memoria aprendida, ' + porIA + ' por IA'
  };
}

// ═══════════════════════════════════════════════════════
// SALDO PROYECTADO FIN DE MES
// ═══════════════════════════════════════════════════════
function proyectarSaldoFinMes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = CFG.TZ;
  const hoy = new Date();
  const mesActual = Utilities.formatDate(hoy, tz, 'yyyy-MM');
  const diaHoy = parseInt(Utilities.formatDate(hoy, tz, 'dd'));
  const diasMes = new Date(parseInt(mesActual.split('-')[0]), parseInt(mesActual.split('-')[1]), 0).getDate();
  const diasRestantes = diasMes - diaHoy;

  const shMov = ss.getSheetByName(CFG.SHEETS.MOV);
  const shAcc = ss.getSheetByName(CFG.SHEETS.CUENTAS);
  if (!shMov || !shAcc) return null;

  const txns = readSheet_(shMov);
  const mesTxns = txns.filter(r => {
    const d = parseSheetDate_(r.fecha);
    return d instanceof Date && Utilities.formatDate(d, tz, 'yyyy-MM') === mesActual;
  });

  const gastosHastaHoy = mesTxns.filter(r => normalizeType_(r.grupo) === 'expense').reduce((s, r) => s + parseNum_(r.monto), 0);
  const promedioDiario = diaHoy > 0 ? gastosHastaHoy / diaHoy : 0;
  const proyeccionGastos = gastosHastaHoy + (promedioDiario * diasRestantes);

  const ingresos = mesTxns.filter(r => normalizeType_(r.grupo) === 'income').reduce((s, r) => s + parseNum_(r.monto), 0);
  const saldoActual = readSheet_(shAcc).filter(r => r.activa !== false && String(r.activa) !== 'false').reduce((s, r) => s + parseNum_(r.saldo), 0);
  const proyeccionAhorro = ingresos - proyeccionGastos;
  const proyeccionSaldoFin = saldoActual - (promedioDiario * diasRestantes);

  return {
    saldoActual,
    gastosHastaHoy,
    promedioDiario,
    proyeccionGastos,
    proyeccionAhorro,
    proyeccionSaldoFin,
    diasRestantes,
    diaHoy,
    diasMes,
    tendencia: proyeccionAhorro > 0 ? 'positiva' : 'negativa'
  };
}

// ═══════════════════════════════════════════════════════
// HISTORIAL DE EXTRACTOS
// ═══════════════════════════════════════════════════════

function limpiarDuplicadosHistorial_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Historial_Extractos');
  if (!sh || sh.getLastRow() < 2) return { ok: true, eliminados: 0 };

  const data = sh.getDataRange().getValues();
  const primeraFila = data[0].map(v => String(v).toLowerCase().trim());
  const tieneHeader = primeraFila.some(v => v === 'statement_id');
  const startRow = tieneHeader ? 1 : 0;

  const HDR = ['statement_id','cuenta','banco_detectado','fecha_procesado',
               'total_movimientos','exactos','aproximados','faltantes','importados',
               'estado_final','notas'];
  const hdr = tieneHeader ? data[0].map(v => String(v).trim()) : HDR;

  // Construir clave de deduplicación: banco + total_movimientos + día
  const iStmt  = hdr.indexOf('statement_id');
  const iBanco = hdr.indexOf('banco_detectado');
  const iTotal = hdr.indexOf('total_movimientos');
  const iFecha = hdr.indexOf('fecha_procesado');
  const iEst   = hdr.indexOf('estado_final');

  // Recorrer de más reciente a más antiguo, marcar duplicados para borrar
  const vistas = {}; // clave -> true
  const filasBorrar = []; // índices en data[] (0-based, incluyendo header)

  for (let i = data.length - 1; i >= startRow; i--) {
    const r = data[i];
    const stmtId = String(r[iStmt] || '');
    if (!stmtId || stmtId.indexOf('PDF_') !== 0) continue;

    const banco = String(r[iBanco] || '');
    const total = String(r[iTotal] || '0');
    const fecha = r[iFecha] instanceof Date
      ? Utilities.formatDate(r[iFecha], CFG.TZ, 'yyyy-MM-dd')
      : String(r[iFecha] || '').slice(0, 10);

    const clave = banco + '|' + total + '|' + fecha;
    if (vistas[clave]) {
      filasBorrar.push(i + 1); // fila en Sheets (1-based)
    } else {
      vistas[clave] = true;
    }
  }

  // Borrar de abajo hacia arriba para no desplazar índices
  filasBorrar.sort((a, b) => b - a);
  filasBorrar.forEach(fila => sh.deleteRow(fila));

  return { ok: true, eliminados: filasBorrar.length };
}

/**
 * Guarda un registro resumen en la hoja Historial_Extractos cada vez que
 * se procesa un PDF. Así se puede saber qué extractos ya se conciliaron.
 */
function guardarHistorialExtracto(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombre = 'Historial_Extractos';
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, 11).setValues([[
      'statement_id', 'cuenta', 'banco_detectado', 'fecha_procesado',
      'total_movimientos', 'exactos', 'aproximados', 'faltantes', 'importados',
      'estado_final', 'notas'
    ]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Si la hoja existe pero no tiene header, insertar header en fila 1
    const primeraFila = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const tieneHeader = primeraFila.some(v => String(v).toLowerCase().trim() === 'statement_id');
    if (!tieneHeader) {
      sh.insertRowBefore(1);
      sh.getRange(1, 1, 1, 11).setValues([[
        'statement_id', 'cuenta', 'banco_detectado', 'fecha_procesado',
        'total_movimientos', 'exactos', 'aproximados', 'faltantes', 'importados',
        'estado_final', 'notas'
      ]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }

  const row = [
    String(params.statement_id || ''),
    String(params.cuenta || ''),
    String(params.banco_detectado || 'desconocido'),
    new Date(),
    Number(params.total_movimientos || 0),
    Number(params.exactos || 0),
    Number(params.aproximados || 0),
    Number(params.faltantes || 0),
    Number(params.importados || 0),
    String(params.estado_final || 'pendiente'),
    String(params.notas || '')
  ];

  sh.appendRow(row);
  return { ok: true };
}

function formatFechaHistorial_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd HH:mm');
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 16);
  // formato d/M/yyyy HH:mm:ss (como devuelve Sheets a veces)
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var mm = m[2].length === 1 ? '0' + m[2] : m[2];
    var dd = m[1].length === 1 ? '0' + m[1] : m[1];
    return m[3] + '-' + mm + '-' + dd + (s.slice(m[0].length, m[0].length + 6) || '');
  }
  return s;
}

/**
 * Devuelve los últimos N extractos procesados para mostrar en la UI.
 */
function getHistorialExtractos(limite) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Historial_Extractos');
  if (!sh || sh.getLastRow() < 1) return [];

  const data = sh.getDataRange().getValues();
  if (!data || data.length === 0) return [];

  // Detectar si la primera fila es header (contiene 'statement_id') o ya son datos
  const primeraFila = data[0].map(v => String(v).toLowerCase().trim());
  const tieneHeader = primeraFila.some(v => v === 'statement_id');

  let hdr, rows;
  if (tieneHeader) {
    hdr  = data[0].map(v => String(v).trim());
    rows = data.slice(1).reverse().slice(0, limite || 80);
  } else {
    // Sin header: columnas fijas según el orden definido en guardarHistorialExtracto
    // statement_id, cuenta, banco_detectado, fecha_procesado, total_movimientos,
    // exactos, aproximados, faltantes, importados, estado_final, notas
    hdr  = ['statement_id','cuenta','banco_detectado','fecha_procesado',
            'total_movimientos','exactos','aproximados','faltantes','importados',
            'estado_final','notas'];
    rows = data.slice(0).reverse().slice(0, limite || 80);
  }

  return rows
    .map(r => {
      const obj = {};
      hdr.forEach((h, i) => { obj[h] = r[i]; });
      return {
        statement_id:      String(obj.statement_id || ''),
        cuenta:            String(obj.cuenta || ''),
        banco_detectado:   String(obj.banco_detectado || ''),
        fecha_procesado:   formatFechaHistorial_(obj.fecha_procesado),
        total_movimientos: Number(obj.total_movimientos || 0),
        exactos:           Number(obj.exactos || 0),
        aproximados:       Number(obj.aproximados || 0),
        faltantes:         Number(obj.faltantes || 0),
        importados:        Number(obj.importados || 0),
        estado_final:      String(obj.estado_final || 'pendiente'),
        notas:             String(obj.notas || '')
      };
    })
    .filter(h => h.statement_id !== '' && h.statement_id.indexOf('PDF_') === 0);
}

/**
 * Elimina un extracto del historial por su statement_id.
 */
function eliminarHistorialExtracto(statementId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Historial_Extractos');
  if (!sh) return { ok: false };
  const data = sh.getDataRange().getValues();
  const hdr  = data[0];
  const idCol = hdr.indexOf('statement_id');
  if (idCol < 0) return { ok: false };
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][idCol]) === String(statementId)) {
      sh.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No encontrado' };
}

/**
 * Actualiza el estado_final de un extracto ya guardado en el historial.
 */
function actualizarEstadoHistorialExtracto(statementId, estadoFinal) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Historial_Extractos');
  if (!sh) return { ok: false };

  const data = sh.getDataRange().getValues();
  const hdr  = data[0];
  const idCol = hdr.indexOf('statement_id');
  const estCol = hdr.indexOf('estado_final');
  if (idCol < 0 || estCol < 0) return { ok: false };

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(statementId)) {
      sh.getRange(r + 1, estCol + 1).setValue(estadoFinal);
      return { ok: true };
    }
  }
  return { ok: false, error: 'statement_id no encontrado' };
}

/**
 * Guarda el resultado completo del review en una hoja auxiliar (JSON).
 * Permite reabrir un extracto sin re-subir el PDF.
 */
function guardarReviewExtracto_(statementId, resultado) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const nombre = 'Reviews_Extractos';
    let sh = ss.getSheetByName(nombre);
    if (!sh) {
      sh = ss.insertSheet(nombre);
      sh.getRange(1, 1, 1, 2).setValues([['statement_id', 'review_json']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // Buscar si ya existe una fila para este statement_id y actualizarla
    const data = sh.getDataRange().getValues();
    const json = JSON.stringify(resultado);
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(statementId)) {
        sh.getRange(r + 1, 2).setValue(json);
        return;
      }
    }
    sh.appendRow([String(statementId), json]);
  } catch(e) {
    Logger.log('guardarReviewExtracto_ error: ' + e.message);
  }
}

/**
 * Actualiza solo el campo review[] dentro del JSON guardado,
 * preservando el resto del resultado (totales, banco, etc.)
 */
function actualizarReviewExtracto_(statementId, reviewJson) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Reviews_Extractos');
    if (!sh) return { ok: false };
    const data = sh.getDataRange().getValues();
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][0]) === String(statementId)) {
        let resultado = {};
        try { resultado = JSON.parse(String(data[r][1])); } catch(e) {}
        resultado.review = JSON.parse(reviewJson);
        sh.getRange(r + 1, 2).setValue(JSON.stringify(resultado));
        return { ok: true };
      }
    }
    return { ok: false, error: 'statement_id no encontrado' };
  } catch(e) {
    Logger.log('actualizarReviewExtracto_ error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Carga el review guardado de un extracto por su statement_id.
 */
function cargarReviewExtracto(statementId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Reviews_Extractos');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(statementId)) {
      try { return JSON.parse(String(data[r][1])); } catch(e) { return null; }
    }
  }
  return null;
}

/**
 * Marca un movimiento en la hoja Movimientos como conciliado.
 * Actualiza estado_conciliacion, statement_id y conciliado_el.
 */
function marcarMovimientoConciliado(movimientoId, statementId, estado) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CFG.SHEETS.MOV);
  if (!sh) return { ok: false };

  ensureMovimientosSchema_(sh);
  const data = sh.getDataRange().getValues();
  const hdr  = rowToObj_(data[0]);

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.mov_id] || '') === String(movimientoId)) {
      if (hdr.estado_conciliacion != null)
        sh.getRange(r + 1, hdr.estado_conciliacion + 1).setValue(estado || 'conciliado');
      if (hdr.statement_id != null && statementId)
        sh.getRange(r + 1, hdr.statement_id + 1).setValue(statementId);
      if (hdr.conciliado_el != null)
        sh.getRange(r + 1, hdr.conciliado_el + 1).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, error: 'Movimiento no encontrado' };
}
