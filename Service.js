/**
 * FINANZAS AI PRO — Services.gs
 * Clasificación IA · FX · Notificaciones
 * v2.0 — Gemini 1.5 Flash + fallback reglas mejorado
 */

// ═══════════════════════════════════════════════════════
// AI SERVICE — clasificarConIA_
// ═══════════════════════════════════════════════════════
/**
 * @param {Object} data - {from, subject, body, amount, currency, merchant}
 * @param {Sheet}  shCfg
 * @returns {Object} {category, type, confidence, notes, tags}
 */
function clasificarConIA_(data, shCfg) {
  const provider = getSettingEs_(shCfg, 'proveedor_ia', 'gemini');

  // Cache por fingerprint del contenido (evita llamadas repetidas)
  const fp = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    `${data.merchant}|${data.subject}|${data.amount}`
  ).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  const cached = CacheService.getScriptCache().get('ai_' + fp);
  if (cached) return JSON.parse(cached);

  let result = null;

  // 1º) MEMORIA APRENDIDA de tu historial (instantánea, gratis). Si está segura,
  //     se usa directamente sin gastar llamadas a la IA.
  try {
    const aprendido = _learnedClassify_(data);
    if (aprendido) result = aprendido;
  } catch(e) { Logger.log('learned error: ' + e); }

  // 2º) Si la memoria no supo, usar el proveedor configurado (IA o reglas).
  if (!result) {
    try {
      result = provider === 'gemini'
        ? _callGemini_(data, shCfg)
        : _rulesClassify_(data, shCfg);
    } catch(e) {
      Logger.log('IA error → fallback reglas: ' + e);
      result = _rulesClassify_(data, shCfg);
    }
  }

  // Normalizar
  result.confidence = Math.min(1, Math.max(0, parseFloat(result.confidence) || 0));
  CacheService.getScriptCache().put('ai_' + fp, JSON.stringify(result), 86400);
  return result;
}

// ─── Gemini 1.5 Flash ────────────────────────────────
function _callGemini_(data, shCfg) {
  const apiKey = _aiApiKey_();
  if (!apiKey) {
    Logger.log('⚠️ Clave de IA no configurada → usando reglas');
    return _rulesClassify_(data, shCfg);
  }

  const cats = _getCategories_().join(', ');
  const prompt = `Eres un clasificador de gastos personales para usuarios colombianos. Analiza este correo financiero y clasifica la transacción con precisión.

CATEGORÍAS DISPONIBLES: ${cats}

DATOS DEL EMAIL:
- Remitente: ${data.from || '?'}
- Asunto: ${data.subject || '?'}
- Comercio detectado: ${data.merchant || '?'}
- Monto detectado: ${data.amount > 0 ? data.amount : 'no detectado'} ${data.currency || 'COP'}
- Cuerpo del email (primeros 600 chars): "${(data.body || '').substring(0, 600)}"

REGLAS IMPORTANTES:
1. tipo: "income" = nómina/salario/abono/consignación recibida; "transfer" = traslado entre cuentas propias, Nequi, Daviplata, retiro; "expense" = compra, pago, cobro, débito
2. En Colombia, $ = COP (NO USD). Si el monto tiene puntos como separadores de miles (1.234.567), es COP.
3. Si Remitente contiene "Bancolombia", "Davivienda", "Nequi" → probablemente notificación de banco
4. Bancos colombianos reportan: "Se realizó un pago", "Compra con tarjeta", "Débito en su cuenta"
5. Si monto = 0 o no detectado → confianza máximo 0.55
6. "Nequi" y "Daviplata" son apps de transferencia → tipo "transfer"
7. Selecciona la categoría más específica posible

RESPONDE SOLO CON JSON VÁLIDO (sin markdown, sin explicaciones):
{"type":"expense|income|transfer","category":"nombre exacto de la categoría","confidence":0.00,"merchant":"nombre limpio del comercio","notes":"razón muy breve"}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 256, responseMimeType: 'application/json' }
  };

  const res = aiGenerateContent_(AI_CFG.MODEL, payload, apiKey);
  if (res.code !== 200) {
    throw new Error('IA HTTP ' + res.code);
  }

  const text = res.text || '{}';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

  return {
    type:       parsed.type || 'expense',
    category:   _validateCategory_(parsed.category),
    confidence: parseFloat(parsed.confidence) || 0.7,
    merchant:   parsed.merchant || data.merchant,
    notes:      parsed.notes || ''
  };
}

// ─── Clasificador por Reglas (fallback robusto) ───────
function _rulesClassify_(data, shCfg) {
  const text = `${data.from} ${data.subject} ${data.merchant} ${(data.body||'').substring(0,300)}`.toLowerCase();
  const amount = parseFloat(data.amount) || 0;
  const categories = _getCategories_();

  const rules = [
    // Ingresos
    { type:'income',   cat:'Ingresos',       score:0, kw:['nómina','nomina','salario','pago recibido','abono','depósito','deposito','transferencia recibida','ingreso','consignación','consignacion','reembolso','cashback','devolución','devolucion','bonificacion','auxilio','subsidio','dividendo'] },
    // Alimentos
    { type:'expense',  cat:'Alimentos',       score:0, kw:['rappi','ifood','didi food','mcdonald','mcdonalds','kfc','subway','domicilio','supermercado','éxito','exito','jumbo','carulla','almacen','mercado','restaurante','comida','almuerzo','desayuno','cena','pizza','burger','hamburguesa','sushi','oma','crepes','frisby','el corral','sandwich','panaderia','pasteleria','verduleria','frutería','frutas','pollo','dominos','pizza hut'] },
    // Transporte
    { type:'expense',  cat:'Transporte',      score:0, kw:['uber','cabify','indriver','taxi','gasolina','combustible','peaje','parqueadero','parqueo','transmilenio','sitp','metro','tiquete','bus','moto','bicicleta','patineta','blablacar','servicio de transporte'] },
    // Servicios
    { type:'expense',  cat:'Servicios',       score:0, kw:['epm','codensa','gas natural','claro','movistar','tigo','wom','netflix','spotify','amazon prime','disney','youtube premium','hbo','paramount','apple tv','internet','acueducto','servicios publicos','celular','plan movil','telefonia','streaming','suscripcion','adobe','microsoft','office 365','icloud','google one','dropbox'] },
    // Salud
    { type:'expense',  cat:'Salud',           score:0, kw:['farmacia','droguería','drogueria','cruz verde','locatel','medplus','eps','medicina','cita medica','laboratorio','hospital','clinica','dentista','gym','bodytech','smartfit','smartgym','optometria','veterinario','medicamento','salud','consulta','copago','duquesa','olimpica farma'] },
    // Entretenimiento
    { type:'expense',  cat:'Entretenimiento', score:0, kw:['cine','cinemas','steam','playstation','xbox','nintendo','concierto','teatro','parque','bar','discoteca','tragos','karaoke','escape room','bowling','paintball','juegos','videojuego','evento','festival','rumba','tickets','ticketmaster'] },
    // Educación
    { type:'expense',  cat:'Educación',       score:0, kw:['universidad','colegio','udemy','coursera','platzi','libro','educación','educacion','matrícula','matricula','pensión colegio','libreria','papeleria','certificado','diplomado','idiomas','ingles','duolingo','skillshare'] },
    // Ropa
    { type:'expense',  cat:'Ropa',            score:0, kw:['zara','h&m','studio f','adidas','nike','under armour','ropa','calzado','zapatos','falabella','liverpool','almacén','tennis','reebok','levis','puma','forever 21','mango','koaj','americanino','arturo calle','pronto'] },
    // Hogar
    { type:'expense',  cat:'Hogar',           score:0, kw:['arriendo','alkosto','homecenter','easy','corona','muebles','electrodoméstico','ferretería','decoración','sodimac','ikea','bata','colchones','baldosa','pintura','plomero','electricista','aseo','limpieza'] },
    // Mascotas
    { type:'expense',  cat:'Mascotas',        score:0, kw:['veterinario','petco','laika','animal','mascota','perro','gato','acuario','petshop'] },
    // Viajes
    { type:'expense',  cat:'Viajes',          score:0, kw:['avianca','latam','copa','wingo','vuelo','hotel','airbnb','booking','hostal','turismo','hospedaje','hospederia','pasajes','aeropuerto','maleta','viaje','tiquete','boleto','despegar','viajes falabella'] },
    // Transferencias
    { type:'transfer', cat:'Transferencia',   score:0, kw:['transferencia','nequi','daviplata','corresponsal','retiro','consignación interna','traslado','pse','movimiento','entre cuentas'] },
    { type:'expense',  cat:'Otros',           score:0, kw:[] }
  ];

  let best = rules[rules.length - 1]; // default: Otros
  let bestScore = -1;

  for (const rule of rules.slice(0, -1)) {
    const score = rule.kw.filter(k => text.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = rule; }
  }

  const transferHints = ['transferencia','traslado','movimiento entre cuentas','nequi','daviplata','retiro','pse'];
  const incomeHints = ['abono','ingreso','pago recibido','salario','nomina','devolucion','reembolso','cashback','consignacion'];
  const expenseHints = ['compra','pago','debito','consumo','factura','cobro','cargo','suscripcion'];

  const hasTransfer = transferHints.some(k => text.includes(k));
  const hasIncome = incomeHints.some(k => text.includes(k));
  const hasExpense = expenseHints.some(k => text.includes(k));

  if (hasTransfer && !hasIncome) best = { type:'transfer', cat:'Transferencia' };
  if (hasIncome && !hasExpense) best = { type:'income', cat:'Ingresos' };
  if (hasExpense && !hasIncome && bestScore < 1) best = { type:'expense', cat:'Otros' };

  const categoryByText = categories.find(cat => {
    const normalizedCat = String(cat || '').toLowerCase();
    return normalizedCat && text.includes(normalizedCat);
  });
  if (categoryByText && best.type === 'expense') best.cat = categoryByText;

  // Boost de confianza basado en monto detectado
  const baseConf = bestScore >= 2 ? 0.82 : bestScore === 1 ? 0.68 : 0.45;
  const amtBoost = amount > 0 ? 0.08 : -0.12;
  const typeBoost = (hasTransfer || hasIncome || hasExpense) ? 0.07 : 0;
  const merchantBoost = data.merchant && data.merchant !== 'Desconocido' ? 0.04 : 0;

  return {
    type:       best.type,
    category:   _validateCategory_(best.cat),
    confidence: Math.min(0.97, Math.max(0.25, baseConf + amtBoost + typeBoost + merchantBoost)),
    merchant:   data.merchant || 'Desconocido',
    notes:      `Clasificación por reglas (${bestScore} coincidencias)`
  };
}

function _getCategories_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CFG.SHEETS.CATEGORIAS);
    if (!sh) throw new Error('no sheet');
    const data = sh.getDataRange().getValues();
    return data.slice(1).map(r => String(r[1]||'').trim()).filter(Boolean);
  } catch(e) {
    return ['Alimentos','Transporte','Servicios','Salud','Entretenimiento','Educación','Ropa','Hogar','Mascotas','Viajes','Ingresos','Transferencia','Otros'];
  }
}

function _validateCategory_(cat) {
  const valid = _getCategories_();
  const norm  = String(cat||'').trim();
  if (valid.includes(norm)) return norm;
  // Fuzzy match
  const lower = norm.toLowerCase();
  return valid.find(v => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase())) || 'Otros';
}

// ═══════════════════════════════════════════════════════
// FX SERVICE
// ═══════════════════════════════════════════════════════
function getExchangeRate_(from, to) {
  if (from === to) return 1;

  const cacheKey = `fx_${from}_${to}`;
  const cached   = CacheService.getScriptCache().get(cacheKey);
  if (cached) return parseFloat(cached);

  // Intentar API (exchangerate-api pública, sin key)
  try {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const json = JSON.parse(res.getContentText());
      const rate = json.rates?.[to];
      if (rate) {
        CacheService.getScriptCache().put(cacheKey, String(rate), 3600);
        _saveFXRate_(from, to, rate);
        return rate;
      }
    }
  } catch(e) { Logger.log('FX API error: ' + e); }

  // Tasas hardcoded de fallback
  const fallback = { 'USD_COP': 4050, 'EUR_COP': 4350, 'USD_EUR': 0.92 };
  return fallback[`${from}_${to}`] || 1;
}

function _saveFXRate_(base, target, rate) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CFG.SHEETS.TIPOS_CAMBIO);
    if (!sh) return;
    sh.appendRow([base, target, rate, Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), 'open.er-api.com']);
  } catch(e) {}
}

function actualizarFXServicio_() {
  const pairs = [['USD','COP'],['EUR','COP'],['USD','EUR']];
  // Limpiar el caché FX de estos pares (removeAll requiere un array de claves).
  try {
    CacheService.getScriptCache().removeAll(pairs.map(([b,t]) => `fx_${b}_${t}`));
  } catch(e) { Logger.log('Error limpiando cache FX: ' + e.message); }
  const results = pairs.map(([b,t]) => ({ pair:`${b}/${t}`, rate: getExchangeRate_(b,t) }));
  clearCacheForMonth();
  return { ok: true, rates: results };
}
