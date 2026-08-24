/**
 * FINANZAS AI PRO — AIProvider.gs
 * ─────────────────────────────────────────────────────────────
 * Adaptador único de IA. Reemplaza las llamadas directas a Gemini
 * por OpenRouter (nivel gratuito, funciona desde Colombia).
 *
 * El nivel gratuito de Gemini NO está disponible en Colombia
 * (todas las claves devuelven "limit: 0"), por eso el proyecto
 * usa OpenRouter, que sí ofrece modelos gratis con texto y visión.
 *
 * Uso: en vez de construir la URL de Gemini y llamar a UrlFetchApp,
 * el resto del código llama a aiGenerateContent_(model, payload) con
 * EXACTAMENTE el mismo payload estilo Gemini que ya construía
 * (contents / parts / text / inlineData / fileData). Este archivo lo
 * traduce a OpenRouter y devuelve un objeto con forma Gemini:
 *   { code: <http>, text: <respuesta>, geminiJson: {candidates:[...]} }
 * de modo que los parsers existentes siguen funcionando sin cambios.
 * ─────────────────────────────────────────────────────────────
 */

const AI_CFG = {
  BASE_URL: 'https://openrouter.ai/api/v1/chat/completions',
  // Modelo gratis con texto + visión, disponible desde Colombia.
  // Cubre chatbot, categorización y lectura de PDF/extractos.
  MODEL: 'nvidia/nemotron-nano-12b-v2-vl:free',
  // Se usa cuando llega un payload con PDF (fileData/inlineData application/pdf).
  // OpenRouter parsea el PDF gratis con este plugin (motor pdf-text).
  PDF_PLUGIN: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }],
  REFERER: 'https://script.google.com',
  TITLE: 'Finanzas AI Pro'
};

/**
 * Lee la clave de IA. Prioriza OPENROUTER_API_KEY; por compatibilidad
 * acepta la vieja GEMINI_API_KEY (donde el usuario haya pegado ya una
 * clave sk-or-... de OpenRouter).
 * @returns {string}
 */
function _aiApiKey_() {
  const props = PropertiesService.getScriptProperties();
  return (props.getProperty('OPENROUTER_API_KEY')
       || props.getProperty('GEMINI_API_KEY')
       || '').trim();
}

/**
 * Convierte un payload estilo Gemini a mensajes de OpenRouter.
 * Soporta parts: {text}, {inlineData:{mimeType,data}}, {fileData:{mimeType,fileUri}}.
 * Imágenes -> image_url ; PDF -> file (activa el plugin de parseo).
 * @returns {{messages:Array, hasPdf:boolean}}
 */
function _geminiPayloadToMessages_(payload) {
  const contents = (payload && payload.contents) || [];
  const messages = [];
  let hasPdf = false;

  // systemInstruction de Gemini -> mensaje system de OpenRouter
  if (payload && payload.systemInstruction && payload.systemInstruction.parts) {
    const sys = payload.systemInstruction.parts
      .map(function (p) { return p.text || ''; }).join('\n');
    if (sys) messages.push({ role: 'system', content: sys });
  }

  // Gemini usa role 'model' para el asistente; OpenRouter usa 'assistant'.
  function mapRole(r) { return r === 'model' ? 'assistant' : (r || 'user'); }

  contents.forEach(function (c) {
    const role = mapRole(c.role);
    const parts = c.parts || [];
    // Si sólo hay texto, mandamos string simple (más compatible).
    const onlyText = parts.every(function (p) { return typeof p.text === 'string' && !p.inlineData && !p.fileData; });
    if (onlyText) {
      messages.push({ role: role, content: parts.map(function (p) { return p.text; }).join('\n') });
      return;
    }
    const arr = [];
    parts.forEach(function (p) {
      if (typeof p.text === 'string') {
        arr.push({ type: 'text', text: p.text });
      } else if (p.inlineData && p.inlineData.data) {
        const mime = p.inlineData.mimeType || 'image/png';
        const dataUri = 'data:' + mime + ';base64,' + p.inlineData.data;
        if (mime.indexOf('pdf') >= 0) {
          hasPdf = true;
          arr.push({ type: 'file', file: { filename: 'documento.pdf', file_data: dataUri } });
        } else {
          arr.push({ type: 'image_url', image_url: { url: dataUri } });
        }
      } else if (p.fileData && p.fileData.fileUri) {
        // Gemini File API no existe en OpenRouter; si llega una URI http la pasamos como imagen.
        const mime = p.fileData.mimeType || '';
        if (mime.indexOf('pdf') >= 0) {
          hasPdf = true;
          arr.push({ type: 'file', file: { filename: 'documento.pdf', file_data: p.fileData.fileUri } });
        } else {
          arr.push({ type: 'image_url', image_url: { url: p.fileData.fileUri } });
        }
      }
    });
    messages.push({ role: role, content: arr });
  });

  return { messages: messages, hasPdf: hasPdf };
}

/**
 * Llama a la IA (OpenRouter) con un payload estilo Gemini.
 * @param {string} model  Ignorado salvo compatibilidad; se usa AI_CFG.MODEL.
 * @param {Object} payload  Payload estilo Gemini (contents/parts/generationConfig).
 * @param {string} [apiKey] Opcional; si no se pasa se lee de propiedades.
 * @returns {{code:number, text:string, geminiJson:Object, raw:string}}
 */
function aiGenerateContent_(model, payload, apiKey) {
  const key = (apiKey || _aiApiKey_());
  if (!key) return { code: 401, text: '', geminiJson: { candidates: [] }, raw: 'No API key' };

  const conv = _geminiPayloadToMessages_(payload);
  const gc = (payload && payload.generationConfig) || {};

  const body = {
    model: AI_CFG.MODEL,
    messages: conv.messages
  };
  if (typeof gc.temperature === 'number') body.temperature = gc.temperature;
  if (typeof gc.maxOutputTokens === 'number') {
    // Este modelo "razona" antes de responder y consume tokens en ello;
    // con límites muy bajos (p.ej. 10) puede quedarse sin margen y devolver vacío.
    // Garantizamos un mínimo razonable.
    body.max_tokens = Math.max(gc.maxOutputTokens, 512);
  }
  // Gemini pedía JSON puro con responseMimeType -> en OpenRouter usamos response_format.
  if (gc.responseMimeType === 'application/json') body.response_format = { type: 'json_object' };
  if (conv.hasPdf) body.plugins = AI_CFG.PDF_PLUGIN;

  let res;
  try {
    res = UrlFetchApp.fetch(AI_CFG.BASE_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      headers: {
        'Authorization': 'Bearer ' + key,
        'HTTP-Referer': AI_CFG.REFERER,
        'X-Title': AI_CFG.TITLE
      }
    });
  } catch (e) {
    Logger.log('aiGenerateContent_ fetch error: ' + e);
    return { code: 0, text: '', geminiJson: { candidates: [] }, raw: String(e) };
  }

  const code = res.getResponseCode();
  const raw = res.getContentText();
  let text = '';
  if (code === 200) {
    try {
      // OpenRouter a veces antepone líneas en blanco al JSON → trim antes de parsear.
      const j = JSON.parse(String(raw).trim());
      const choice = j.choices && j.choices[0] && j.choices[0].message;
      text = (choice && choice.content) || '';
      // Algunos modelos "razonadores" ponen la respuesta en 'reasoning' si content viene vacío.
      if (!text && choice && choice.reasoning) text = choice.reasoning;
    } catch (e) {
      Logger.log('aiGenerateContent_ parse error: ' + e + ' raw: ' + String(raw).slice(0, 300));
    }
  } else {
    Logger.log('aiGenerateContent_ HTTP ' + code + ': ' + String(raw).slice(0, 300));
  }

  // Devolver también con forma Gemini para compatibilidad con parsers existentes.
  return {
    code: code,
    text: text,
    raw: raw,
    geminiJson: { candidates: [{ content: { parts: [{ text: text }] } }] }
  };
}

/**
 * Atajo de sólo-texto. Devuelve el texto de respuesta o ''.
 * @param {string} prompt
 * @param {Object} [opts] { temperature, maxOutputTokens, json }
 * @returns {string}
 */
function aiText_(prompt, opts) {
  opts = opts || {};
  const payload = {
    contents: [{ parts: [{ text: String(prompt) }] }],
    generationConfig: {
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
      maxOutputTokens: opts.maxOutputTokens || 1024
    }
  };
  if (opts.json) payload.generationConfig.responseMimeType = 'application/json';
  const r = aiGenerateContent_(AI_CFG.MODEL, payload);
  return r.code === 200 ? r.text : '';
}

// ═══════════════════════════════════════════════════════
// CLAVE DE IA — guardar y verificar (OpenRouter)
// ═══════════════════════════════════════════════════════

/**
 * Guarda la clave de IA. Acepta claves de OpenRouter (sk-or-...).
 * Se mantiene el nombre guardarGeminiApiKey por compatibilidad con la UI.
 */
function guardarGeminiApiKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('API key vacía');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('OPENROUTER_API_KEY', k);
  // Compat: algunas funciones antiguas leen GEMINI_API_KEY.
  props.setProperty('GEMINI_API_KEY', k);
  return { ok: true };
}

function getGeminiKeyStatus() {
  const k = _aiApiKey_();
  return {
    configured: !!k,
    masked: k ? k.slice(0, 6) + '••••••••' + k.slice(-4) : '',
    provider: 'OpenRouter'
  };
}

/**
 * Prueba la clave con una llamada real mínima. Útil para el botón de la UI.
 * @returns {{ok:boolean, code:number, reply:string}}
 */
function probarClaveIA() {
  const r = aiGenerateContent_(AI_CFG.MODEL, {
    contents: [{ parts: [{ text: 'Responde solo con la palabra: OK' }] }],
    generationConfig: { maxOutputTokens: 10 }
  });
  return { ok: r.code === 200, code: r.code, reply: (r.text || r.raw || '').slice(0, 200) };
}
