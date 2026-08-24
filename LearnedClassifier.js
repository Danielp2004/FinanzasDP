/**
 * FINANZAS AI PRO — LearnedClassifier.gs
 * ─────────────────────────────────────────────────────────────
 * Clasificador que APRENDE de tu propio historial de movimientos.
 *
 * En vez de una red neuronal (inviable con ~400 datos y sin GPU en Apps
 * Script), usa un modelo de FRECUENCIA estilo Naive Bayes:
 *   - Recorre todos tus movimientos ya categorizados.
 *   - Para cada palabra/token de la descripción, cuenta a qué categoría la
 *     asignaste (y con qué tipo income/expense/transfer).
 *   - Al clasificar uno nuevo, suma los "votos" de sus tokens y elige la
 *     categoría con más peso.
 *
 * Ventajas: instantáneo, gratis, corre en Apps Script y MEJORA solo cada vez
 * que corriges una categoría (basta reconstruir el modelo). Es el primer
 * intento; si no está seguro, el flujo cae a reglas y luego a la IA.
 * ─────────────────────────────────────────────────────────────
 */

const LC_CFG = {
  CACHE_KEY: 'learned_model_v1',
  CACHE_TTL: 21600,          // 6h (máximo de Apps Script cache)
  MIN_TOKEN_LEN: 3,          // ignora tokens muy cortos
  MIN_CONFIANZA: 0.55,       // por debajo de esto, no se confía y se delega
  MIN_EJEMPLOS_TOKEN: 1      // un token cuenta desde 1 aparición
};

// Palabras vacías que no aportan a la categorización.
const LC_STOPWORDS = {
  'de':1,'la':1,'el':1,'en':1,'a':1,'por':1,'con':1,'para':1,'del':1,'los':1,
  'las':1,'un':1,'una':1,'y':1,'o':1,'pago':1,'compra':1,'abono':1,'cargo':1,
  'transferencia':1,'transf':1,'movimiento':1,'ref':1,'no':1,'nro':1,'col':1,
  'cop':1,'pse':1,'debito':1,'credito':1,'tarjeta':1,'cuenta':1
};

/**
 * Tokeniza una descripción: minúsculas, sin acentos, sin símbolos, sin números
 * sueltos ni stopwords.
 * @returns {string[]}
 */
function _lcTokens_(texto) {
  const base = String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
  return base.split(/\s+/).filter(function (w) {
    return w.length >= LC_CFG.MIN_TOKEN_LEN && !LC_STOPWORDS[w] && !/^\d+$/.test(w);
  });
}

/**
 * Construye el modelo aprendido a partir de la hoja Movimientos.
 * Estructura: { tokens: { token: { cat: count } }, cats: { cat: count }, total }
 * @param {boolean} [force] Reconstruir aunque haya caché.
 */
function _lcBuildModel_(force) {
  if (!force) {
    try {
      const cached = CacheService.getScriptCache().get(LC_CFG.CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  const model = { tokens: {}, cats: {}, catType: {}, total: 0 };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CFG.SHEETS.MOV);
    if (!sh) return model;
    const rows = readSheet_(sh);

    rows.forEach(function (m) {
      const cat = String(m.categoria || m['categoría'] || m.category || '').trim();
      if (!cat || cat.toLowerCase() === 'otros') return;      // no aprendemos de "Otros"
      const desc = String(m.descripcion || m['descripción'] || '').trim();
      const tipo = normalizeType_(m.grupo || m.tipo || m.type || '');
      if (!desc) return;

      model.cats[cat] = (model.cats[cat] || 0) + 1;
      model.total++;
      // Recordar el tipo dominante por categoría.
      model.catType[cat] = model.catType[cat] || {};
      if (tipo) model.catType[cat][tipo] = (model.catType[cat][tipo] || 0) + 1;

      const tokens = _lcTokens_(desc);
      // Deduplicar tokens por movimiento (una compra no debe contar 3 veces "exito").
      const seen = {};
      tokens.forEach(function (tok) {
        if (seen[tok]) return;
        seen[tok] = 1;
        if (!model.tokens[tok]) model.tokens[tok] = {};
        model.tokens[tok][cat] = (model.tokens[tok][cat] || 0) + 1;
      });
    });

    try {
      CacheService.getScriptCache().put(LC_CFG.CACHE_KEY, JSON.stringify(model), LC_CFG.CACHE_TTL);
    } catch (e) { /* modelo grande: se recalcula la próxima */ }
  } catch (e) {
    Logger.log('_lcBuildModel_ error: ' + e);
  }
  return model;
}

/** Invalida el modelo (llamar tras editar/corregir categorías). */
function _lcInvalidate_() {
  try { CacheService.getScriptCache().remove(LC_CFG.CACHE_KEY); } catch (e) {}
}

/**
 * Clasifica un movimiento usando el modelo aprendido.
 * @param {Object} data  {merchant, subject, body, amount, description}
 * @returns {Object|null}  {category, type, confidence, ...} o null si no sabe.
 */
function _learnedClassify_(data, model) {
  model = model || _lcBuildModel_();
  if (!model.total) return null;

  const texto = [data.description, data.merchant, data.subject, data.body]
    .filter(Boolean).join(' ');
  const tokens = _lcTokens_(texto);
  if (!tokens.length) return null;

  // Sumar votos por categoría, ponderando por rareza del token (un token que
  // solo aparece en una categoría vale más que uno repartido en muchas).
  const votes = {};
  let matched = 0;
  tokens.forEach(function (tok) {
    const dist = model.tokens[tok];
    if (!dist) return;
    matched++;
    const totalTok = Object.keys(dist).reduce(function (s, c) { return s + dist[c]; }, 0);
    Object.keys(dist).forEach(function (cat) {
      // peso = frecuencia en esa cat / total del token (precisión del token)
      const peso = dist[cat] / totalTok * (1 + Math.log(1 + dist[cat]));
      votes[cat] = (votes[cat] || 0) + peso;
    });
  });

  if (!matched) return null;

  // Elegir la categoría ganadora.
  let bestCat = null, bestScore = 0, sumScore = 0;
  Object.keys(votes).forEach(function (cat) {
    sumScore += votes[cat];
    if (votes[cat] > bestScore) { bestScore = votes[cat]; bestCat = cat; }
  });
  if (!bestCat) return null;

  // Confianza = cuán dominante es la ganadora + cuántos tokens reconoció.
  const dominancia = sumScore > 0 ? bestScore / sumScore : 0;
  const cobertura = Math.min(1, matched / Math.max(1, tokens.length));
  const confidence = Math.min(0.97, 0.4 + dominancia * 0.45 + cobertura * 0.15);

  if (confidence < LC_CFG.MIN_CONFIANZA) return null;   // no está seguro → delega

  // Tipo dominante aprendido para esa categoría.
  const tipos = model.catType[bestCat] || {};
  let tipo = 'expense', tmax = -1;
  Object.keys(tipos).forEach(function (t) { if (tipos[t] > tmax) { tmax = tipos[t]; tipo = t; } });

  return {
    type: tipo,
    category: _validateCategory_(bestCat),
    confidence: confidence,
    merchant: data.merchant || 'Desconocido',
    notes: 'Aprendido de tu historial (' + matched + ' señales, ' + Math.round(confidence * 100) + '%)',
    _source: 'learned'
  };
}

/**
 * Estadísticas del modelo aprendido — para mostrar en la UI ("qué sé").
 */
function estadisticasClasificadorAprendido() {
  const model = _lcBuildModel_(true);
  const topCats = Object.keys(model.cats)
    .map(function (c) { return { categoria: c, ejemplos: model.cats[c] }; })
    .sort(function (a, b) { return b.ejemplos - a.ejemplos; });
  return {
    ok: true,
    totalMovimientosAprendidos: model.total,
    tokensAprendidos: Object.keys(model.tokens).length,
    categorias: topCats
  };
}
