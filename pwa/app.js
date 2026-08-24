/**
 * FINANZAS AI PRO — app.html
 * Frontend JS — Navegación · Charts · Formularios · Exports
 * v2.0
 */

// ═══════════════════════════════════════════════════════
// CAPTURA GLOBAL DE ERRORES — muestra en pantalla cualquier error de JS
// (incluso los que abortarían el script) para poder diagnosticar.
// ═══════════════════════════════════════════════════════
window.__appErrors = [];
function __showAppError(msg) {
  window.__appErrors.push(msg);
  try {
    var box = document.getElementById('__appErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = '__appErrorBox';
      box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:100000;max-height:40vh;overflow:auto;background:#1a0a0a;color:#ffb4b4;font:12px/1.5 monospace;padding:10px 14px;border-top:2px solid #ef4444;white-space:pre-wrap';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = 'ERRORES JS (' + window.__appErrors.length + '):\n' + window.__appErrors.join('\n\n');
  } catch (e) { /* nada */ }
}
window.addEventListener('error', function (ev) {
  __showAppError((ev.message || 'error') + '\n  en ' + (ev.filename || '?') + ':' + (ev.lineno || '?') + ':' + (ev.colno || '?'));
});
window.addEventListener('unhandledrejection', function (ev) {
  __showAppError('Promesa rechazada: ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason));
});

// ═══════════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

let _data = null;
let _emailLogs = [];
let _emailFilter = 'all';
let _trendMode = 'mix';
let _charts = {};
const PALETTE = ['#00d4aa','#3b82f6','#8b5cf6','#f5a623','#ff4d6d','#22c55e','#06b6d4','#ec4899','#84cc16','#f97316'];

// Chart.js defaults — dark theme.
// IMPORTANTE: si el CDN de Chart.js no cargó, "Chart" es undefined y estas
// líneas lanzaban un ReferenceError A NIVEL SUPERIOR, abortando TODO el script
// → ninguna función quedaba definida → ningún botón funcionaba. Por eso va
// dentro de un guard.
if (typeof Chart !== 'undefined') {
  try {
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = 'Outfit, sans-serif';
  } catch (e) { console.warn('Chart defaults:', e); }
} else {
  console.error('Chart.js no cargó (CDN bloqueado). Las gráficas no se dibujarán, pero la app funciona.');
}

// ═══════════════════════════════════════════════════════
// TEMA CLARO/OSCURO
// ═══════════════════════════════════════════════════════
function toggleTheme() {
  const body = document.body;
  const toggle = $('themeToggle');
  const icon = toggle.querySelector('i');

  if (body.classList.contains('light-theme')) {
    body.classList.remove('light-theme');
    icon.className = 'fas fa-moon';
    localStorage.setItem('theme', 'dark');
  } else {
    body.classList.add('light-theme');
    icon.className = 'fas fa-sun';
    localStorage.setItem('theme', 'light');
  }

  // Re-render charts with new theme
  if (_data) buildCharts(_data);
}

// Load theme on init
let _initializing = false;
let _filtroCatActiva = ''; // categoría activa para filtrar dashboard

window.onload = () => {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    $('themeToggle').querySelector('i').className = 'fas fa-sun';
  }

  const hoy = new Date();
  _initializing = true;

  // Poblar selector de años (5 años atrás hasta año actual)
  const anioEl = $('filtroAnio');
  const anioHoy = hoy.getFullYear();
  if (anioEl) {
    for (let y = anioHoy; y >= anioHoy - 4; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      anioEl.appendChild(opt);
    }
    anioEl.value = anioHoy;
  }
  // Seleccionar mes actual
  const mesSel = $('filtroMesSel');
  if (mesSel) mesSel.value = String(hoy.getMonth() + 1).padStart(2, '0');

  // Mantener filtroMes hidden sincronizado
  const mesVal = `${anioHoy}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  if ($('filtroMes')) $('filtroMes').value = mesVal;

  _initializing = false;
  $('pageDate').textContent = hoy.toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  $('txnDate').value = hoy.toISOString().slice(0, 10);
  loadPrecioMode();
  refreshData();   // carga inicial: usa caché (rápida)

  // WATCHDOG: a los 4s, si el overlay de carga sigue tapando la pantalla o hay
  // otro elemento interceptando los clics en el centro, lo neutraliza y lo
  // reporta. Así los botones nunca quedan bloqueados por un overlay pegado.
  setTimeout(function () {
    try {
      const l = $('loader');
      if (l && !l.classList.contains('hidden')) {
        l.classList.add('hidden');
        __showAppError('WATCHDOG: el loader seguía visible y se ocultó. (El servidor tardó; la app ya está desbloqueada.)');
      }
      const cx = Math.floor(window.innerWidth / 2), cy = Math.floor(window.innerHeight / 2);
      const top = document.elementFromPoint(cx, cy);
      if (top) {
        // ¿El elemento superior en el centro es un overlay fijo a pantalla completa?
        const cs = getComputedStyle(top);
        const r = top.getBoundingClientRect();
        const cubreTodo = cs.position === 'fixed' && r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
        if (cubreTodo && top.id !== '__appErrorBox') {
          __showAppError('WATCHDOG: un overlay a pantalla completa está bloqueando los clics: <' +
            top.tagName.toLowerCase() + ' id="' + top.id + '" class="' + top.className + '"> z-index=' + cs.zIndex +
            '. Se desactivan sus pointer-events.');
          top.style.pointerEvents = 'none';
        }
      }
    } catch (e) { __showAppError('WATCHDOG error: ' + e.message); }
  }, 4000);
};

// Sincroniza los selectores de año/mes y dispara refreshData
function _onFiltroChange() {
  const anio = $('filtroAnio')?.value || new Date().getFullYear();
  const mes  = $('filtroMesSel')?.value || '01';
  const mesVal = `${anio}-${mes}`;
  if ($('filtroMes')) $('filtroMes').value = mesVal;
  _filtroCatActiva = '';
  if ($('filtroCat')) $('filtroCat').value = '';
  _updateCatFilterUI();
  refreshData(mesVal);
}

// Filtro por categoría — filtra localmente sin llamar al backend
function _onFiltroCatChange() {
  _filtroCatActiva = $('filtroCat')?.value || '';
  _updateCatFilterUI();
  if (!_data) return;
  const _mesF = _data.mes || $('filtroMes')?.value || '';
  if (!_filtroCatActiva) {
    buildCharts(_data);
    renderTopGastos(_data.topGastos || []);
    renderResumenMes(_data);
    renderRecentTxns(_mesF ? (_data.historial||[]).filter(t=>t.mes===_mesF).slice(0,8) : (_data.historial||[]).slice(0,8));
    return;
  }
  const cat = _filtroCatActiva;
  const txns = (_data.historial || []).filter(t => t.cat === cat && (!_mesF || t.mes === _mesF));
  const byCatFilt = {};
  txns.forEach(t => {
    if (t.type === 'expense' || t.type === 'investment') byCatFilt[t.cat] = (byCatFilt[t.cat]||0) + Math.abs(t.monto);
  });
  const totalFilt = txns.reduce((s,t) => (t.type === 'expense' || t.type === 'investment') ? s + Math.abs(t.monto) : s, 0);
  const topFilt = Object.entries(byCatFilt).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,v])=>({cat:c,val:v}));
  const kpisFilt = Object.assign({}, _data.kpis, { expense: totalFilt });
  const dFilt = Object.assign({}, _data, { byCat: byCatFilt, topGastos: topFilt, kpis: kpisFilt });
  buildCharts(dFilt);
  renderTopGastos(topFilt);
  renderResumenMes(dFilt);
  renderRecentTxns(txns.slice(0,8));
}

function _clearCatFilter() {
  const sel = $('filtroCat');
  if (sel) sel.value = '';
  _onFiltroCatChange();
}

function _updateCatFilterUI() {
  const cat = _filtroCatActiva;
  const btn = $('btnClearCat');
  const badge = $('filtroActivoBadge');
  if (btn) btn.style.display = cat ? 'block' : 'none';
  if (badge) {
    if (cat) {
      badge.style.display = 'flex';
      badge.innerHTML = `<i class="fas fa-tag" style="font-size:9px"></i> ${esc(cat)}`;
    } else {
      badge.style.display = 'none';
    }
  }
}

// ═══════════════════════════════════════════════════════
// NAVEGACIÓN
// ═══════════════════════════════════════════════════════
const PAGE_TITLES = {
  dashboard: 'Dashboard', movimientos: 'Movimientos',
  presupuesto: 'Presupuesto', cuentas: 'Cuentas',
  inversiones: 'Inversiones', emails: 'Emails',
  alertas: 'Alertas Inteligentes', asistente: 'Asistente IA',
  conciliacion: 'Conciliar PDF', configuracion: 'Configuración'
};

function navTo(pageId, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = $('page-' + pageId);
  if (page) page.classList.add('active');

  if (el) el.classList.add('active');
  else {
    const navEl = document.querySelector(`[data-page="${pageId}"]`);
    if (navEl) navEl.classList.add('active');
  }

  $('pageTitle').textContent = PAGE_TITLES[pageId] || pageId;

  // Acciones especiales por página
  if (pageId === 'emails') { loadEmailLogs(); }
  if (pageId === 'movimientos') renderMovimientos();
  if (pageId === 'configuracion') loadConfigPage();
  if (pageId === 'conciliacion') loadHistorialExtractos();
  if (pageId === 'presupuesto') {
    if (_data) { renderPresupuesto(_data.budget || {}); renderBudgetTemplateEditor(_data.budget || {}); }
    else refreshData();
  }

  closeSidebar();
}

function toggleSidebar() {
  $('sidebar').classList.toggle('open');
  $('sidebarOverlay').classList.toggle('show');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('show');
}

// ═══════════════════════════════════════════════════════
// DATA LOAD
// ═══════════════════════════════════════════════════════

// refreshData(mes, {light:true}) → usa API ligera (rápida, sin gráficas de inversiones)
// refreshData(mes)              → API completa (cargada desde cache o calculada)
let _loaderTimer = null;
function _hideLoader() {
  const l = $('loader');
  if (l) l.classList.add('hidden');
  if (_loaderTimer) { clearTimeout(_loaderTimer); _loaderTimer = null; }
}
function refreshData(mes, opts) {
  const mesVal = mes || $('filtroMes').value;
  const light = opts && opts.light;
  const l = $('loader');
  if (l) l.classList.remove('hidden');
  // Seguro anti-cuelgue: si el servidor no responde en 20s, ocultar el loader
  // igual para que la app no quede bloqueada (Apps Script puede tardar en frío).
  if (_loaderTimer) clearTimeout(_loaderTimer);
  _loaderTimer = setTimeout(() => {
    _hideLoader();
    __showAppError('El servidor tardó demasiado (>20s). Se desbloqueó la app. Intenta recargar o cambiar de mes.');
  }, 20000);

  // Por defecto usamos getDataAPI (cacheable → rápido). Sólo forzamos recálculo
  // (clearAndGetDataAPI) cuando se pide explícitamente opts.fresh, p.ej. tras
  // guardar/editar datos. Antes se limpiaba el caché en CADA refresco, así que
  // nunca se aprovechaba y todo era lento (>8s).
  const fresh = opts && opts.fresh;
  const apiMethod = light ? 'getDataAPILight' : (fresh ? 'clearAndGetDataAPI' : 'getDataAPI');
  google.script.run
    .withSuccessHandler(d => {
      _hideLoader();
      renderAll(d);
    })
    .withFailureHandler(e => {
      _hideLoader();
      __showAppError('Error del servidor: ' + (e && e.message ? e.message : e));
      toast('Error cargando datos: ' + (e && e.message ? e.message : e), 'error');
    })
    [apiMethod](mesVal);
}

// refreshSection() → solo actualiza la sección activa sin re-renderizar todo
// Úsala después de guardar/editar para respuesta inmediata sin delay
function refreshSection() {
  const mesVal = $('filtroMes').value;
  const activePage = document.querySelector('.page.active');
  const pageId = activePage ? activePage.id.replace('page-', '') : 'dashboard';

  // Páginas que tienen su propio loader independiente: usar refreshData light
  if (['inversiones', 'configuracion'].includes(pageId)) {
    refreshData(null, { light: true });
    return;
  }

  google.script.run
    .withSuccessHandler(d => {
      if (!d || d.error) return;
      // Actualizar _data con los nuevos datos sin tocar inversiones
      if (_data) {
        d.inversiones  = _data.inversiones  || [];
        d.invPorTipo   = _data.invPorTipo   || [];
        d.invPorBroker = _data.invPorBroker || [];
        d.series       = _data.series       || {};
        d.summary      = _data.summary      || {};
        d.saas         = _data.saas         || {};
        d.kpis.inversiones = _data.kpis?.inversiones || 0;
        d.kpis.totalNeto   = d.kpis.efectivo + (d.kpis.inversiones || 0);
      }
      _data = d;

      // KPIs siempre
      setText('kpi-neto',    COP.format(d.kpis.totalNeto  || 0));
      setText('kpi-income',  COP.format(d.kpis.income     || 0));
      setText('kpi-expense', COP.format(d.kpis.expense    || 0));
      setText('kpi-savings', COP.format(d.kpis.savings    || 0));
      setText('kpi-burn',    (d.kpis.burnRate || 0).toFixed(1) + '%');
      setText('kpi-efec',    COP.format(d.kpis.efectivo   || 0));
      // Email badge
      if (d.emailPending > 0) { $('emailBadge').textContent = d.emailPending; $('emailBadge').style.display = 'inline-block'; }
      else $('emailBadge').style.display = 'none';
      // Selects
      const cats = (d.combos?.categorias || []).filter(c => !c.includes('↔'));
      const cts  = d.combos?.cuentas || [];
      ['selCat','emailEditCat','editTxnCat','eventCat','pdfCuenta'].forEach(id => fillSelect(id, cats));
      ['selCuenta','selDest','emailEditAccount','editTxnCuenta'].forEach(id => fillSelect(id, cts));

      // Sección específica
      if (pageId === 'dashboard') {
        renderTopGastos(d.topGastos || []);
        renderResumenMes(d);
        const _m2 = d.mes || mesVal || '';
        renderRecentTxns(_m2 ? (d.historial||[]).filter(t=>t.mes===_m2).slice(0,8) : (d.historial||[]).slice(0,8));
        renderPresupuesto(d.budget);
        renderAccounts(d.accounts || []);
      } else if (pageId === 'movimientos') {
        renderMovimientos();
        renderRecentTxns((d.historial||[]).slice(0, 8));
      } else if (pageId === 'presupuesto') {
        renderPresupuesto(d.budget);
      } else if (pageId === 'cuentas') {
        renderAccounts(d.accounts || []);
      } else if (pageId === 'emails') {
        loadEmailLogs();
      } else {
        // fallback: re-render todo con light
        renderAll(d);
      }
    })
    .withFailureHandler(e => toast('Error actualizando: ' + e.message, 'error'))
    .getDataAPILight(mesVal);
}

// ═══════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════
// Banner de estado vacío / diagnóstico. Se inserta arriba del dashboard.
function mostrarEstadoVacio(mensajeCustom) {
  let el = $('estadoVacioBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'estadoVacioBanner';
    el.style.cssText = 'margin:0 0 16px;padding:16px 20px;border-radius:14px;background:linear-gradient(135deg,rgba(245,158,11,.12),rgba(99,102,241,.10));border:1px solid rgba(245,158,11,.35);font-size:14px;line-height:1.5';
    const cont = document.querySelector('#page-dashboard > div') || document.querySelector('#page-dashboard') || document.body;
    cont.insertBefore(el, cont.firstChild);
  }
  const msg = mensajeCustom
    || 'No hay datos para mostrar. Puede que las hojas <b>Movimientos</b>/<b>Cuentas</b> estén vacías, o que el mes seleccionado no tenga movimientos.';
  el.innerHTML =
    '<div style="display:flex;gap:12px;align-items:flex-start">' +
      '<i class="fas fa-circle-info" style="color:var(--gold);margin-top:2px"></i>' +
      '<div style="flex:1">' +
        '<div style="font-weight:700;margin-bottom:4px">Dashboard vacío</div>' +
        '<div style="color:var(--text-muted);margin-bottom:10px">' + msg + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-primary btn-sm" onclick="cargarEjemploUI()"><i class="fas fa-wand-magic-sparkles"></i> Cargar datos de ejemplo</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="verDiagnosticoUI()"><i class="fas fa-stethoscope"></i> Ver diagnóstico</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  el.style.display = 'block';
}
function ocultarEstadoVacio() {
  const el = $('estadoVacioBanner');
  if (el) el.style.display = 'none';
}

// Banner cuando el MES filtrado está vacío pero hay datos en otros meses.
const _MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function _mesLabel(ym) {
  const p = String(ym).split('-');
  if (p.length < 2) return ym;
  const mi = parseInt(p[1], 10) - 1;
  return (_MESES_ES[mi] || p[1]) + ' ' + p[0];
}
function mostrarMesVacio(mesActivo, mesSugerido, mesesData) {
  let el = $('estadoVacioBanner');
  if (!el) { mostrarEstadoVacio(''); el = $('estadoVacioBanner'); }
  const n = mesesData[mesSugerido] || 0;
  // Lista de meses con datos, del más reciente al más antiguo.
  const chips = Object.keys(mesesData).sort().reverse().slice(0, 6).map(m =>
    '<button class="btn btn-ghost btn-sm" style="margin:2px" onclick="irAMes(\'' + m + '\')">' +
      _mesLabel(m) + ' <span style="opacity:.6">(' + mesesData[m] + ')</span></button>').join('');
  el.innerHTML =
    '<div style="display:flex;gap:12px;align-items:flex-start">' +
      '<i class="fas fa-calendar-xmark" style="color:var(--gold);margin-top:2px"></i>' +
      '<div style="flex:1">' +
        '<div style="font-weight:700;margin-bottom:4px">No hay movimientos en ' + esc(_mesLabel(mesActivo)) + '</div>' +
        '<div style="color:var(--text-muted);margin-bottom:10px">Tus datos están intactos, solo que este mes no tiene movimientos. Elige un mes con datos:</div>' +
        '<div style="margin-bottom:6px"><button class="btn btn-primary btn-sm" onclick="irAMes(\'' + mesSugerido + '\')"><i class="fas fa-arrow-right"></i> Ir a ' + esc(_mesLabel(mesSugerido)) + ' (' + n + ' mov.)</button></div>' +
        '<div>' + chips + '</div>' +
      '</div>' +
    '</div>';
  el.style.display = 'block';
}
// Cambia el filtro de mes/año y recarga.
function irAMes(ym) {
  const p = String(ym).split('-');
  if (p.length < 2) return;
  const anioEl = $('filtroAnio'), mesEl = $('filtroMesSel');
  if (anioEl) {
    // Asegurar que el año exista como opción.
    if (![...anioEl.options].some(o => o.value === p[0])) {
      const opt = document.createElement('option'); opt.value = p[0]; opt.textContent = p[0];
      anioEl.appendChild(opt);
    }
    anioEl.value = p[0];
  }
  if (mesEl) mesEl.value = p[1];
  if ($('filtroMes')) $('filtroMes').value = ym;
  ocultarEstadoVacio();
  refreshData(ym);
}
function cargarEjemploUI() {
  toast('Cargando datos de ejemplo...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      if (r && r.ok) { toast('Datos de ejemplo cargados', 'success'); refreshData(null, { fresh: true }); }
      else toast('No se pudo: ' + (r && r.error ? r.error : 'error'), 'error');
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .cargarDatosDeEjemplo();
}
function verDiagnosticoUI() {
  const el = $('estadoVacioBanner');
  if (el) el.innerHTML = '<div style="padding:8px">Ejecutando diagnóstico...</div>';
  google.script.run
    .withSuccessHandler(r => {
      console.log('[DIAGNÓSTICO]', r);
      const probs = (r.problemas || []);
      const meses = r.resumen && r.resumen.mesesConDatos ? r.resumen.mesesConDatos : {};
      const mesesStr = Object.keys(meses).length
        ? Object.entries(meses).map(([m,n]) => m + ' (' + n + ')').join(', ')
        : 'ninguno';
      let html = '<div style="font-family:monospace;font-size:12px;line-height:1.6">';
      if (r.error) {
        html += '<div style="color:#ef4444;font-weight:700">ERROR BACKEND: ' + esc(r.error) + '</div>';
      }
      html += 'Hoja: <b>' + esc(r.spreadsheet ? r.spreadsheet.nombre : '?') + '</b><br>';
      html += 'Movimientos: <b>' + (r.resumen ? r.resumen.movimientos : '?') + '</b> · Cuentas: <b>' + (r.resumen ? r.resumen.cuentas : '?') + '</b><br>';
      html += 'Mes actual (filtro): <b>' + (r.resumen ? r.resumen.mesActual : '?') + '</b><br>';
      html += 'Meses con datos: <b>' + esc(mesesStr) + '</b><br>';
      if (r.hojasExistentes) html += 'Hojas en el archivo: ' + esc(r.hojasExistentes.join(', ')) + '<br>';
      if (probs.length) {
        html += '<div style="margin-top:8px;color:var(--gold)"><b>PROBLEMAS:</b><br>- ' + probs.map(esc).join('<br>- ') + '</div>';
      } else {
        html += '<div style="margin-top:8px;color:var(--emerald)">Sin problemas detectados.</div>';
      }
      html += '<div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="cargarEjemploUI()"><i class="fas fa-wand-magic-sparkles"></i> Cargar datos de ejemplo</button></div>';
      html += '</div>';
      let box = $('estadoVacioBanner');
      if (!box) { mostrarEstadoVacio(''); box = $('estadoVacioBanner'); }
      box.innerHTML = html;
      box.style.display = 'block';
    })
    .withFailureHandler(e => {
      let box = $('estadoVacioBanner');
      if (!box) { mostrarEstadoVacio(''); box = $('estadoVacioBanner'); }
      if (box) box.innerHTML = '<div style="color:#ef4444;padding:8px;font-family:monospace;font-size:12px"><b>El diagnóstico también falló:</b><br>' + esc(e.message || String(e)) + '</div>';
    })
    .diagnosticarDatos();
}

function renderAll(d) {
  try { _renderAll(d); }
  catch (e) {
    // Blindaje total: un error de render JAMÁS debe romper la app ni dejar los
    // botones sin funcionar. Se registra y se sigue.
    console.error('[renderAll] ' + (e && e.stack ? e.stack : e));
    __showAppError('[renderAll] ' + (e && e.stack ? e.stack : e));
    try { toast('Error al dibujar el panel (revisa consola)', 'error'); } catch(_) {}
  }
  // Red de seguridad: pase lo que pase, el overlay de carga NUNCA debe quedar
  // encima bloqueando los clics.
  try { const l = $('loader'); if (l) l.classList.add('hidden'); } catch(_) {}
}
function _renderAll(d) {
  if (!d) { toast('Sin datos del servidor', 'error'); mostrarEstadoVacio('El servidor no devolvió datos.'); return; }
  if (d.error) { toast(d.error, 'error'); mostrarEstadoVacio('Error del servidor: ' + d.error); return; }
  if (d._debug && localStorage.getItem('debug') === '1') console.log('[DEBUG API]', d._debug);
  // Salvaguarda: si no vienen KPIs, evitar que el render explote y avisar.
  if (!d.kpis) d.kpis = {};
  // En modo ligero conservar inversiones del dataset anterior (no se recalcularon)
  if (d.__light && _data) {
    d.inversiones   = _data.inversiones   || [];
    d.invPorTipo    = _data.invPorTipo    || [];
    d.invPorBroker  = _data.invPorBroker  || [];
    d.series        = _data.series        || {};
    d.summary       = _data.summary       || {};
    d.saas          = _data.saas          || {};
    d.kpis.inversiones = _data.kpis?.inversiones || 0;
    d.kpis.totalNeto   = (d.kpis.efectivo || 0) + (d.kpis.inversiones || 0);
  }
  _data = d;

  // Estado del dashboard:
  //  a) el mes filtrado no tiene movimientos, pero SÍ hay datos en otros meses
  //     → avisar y ofrecer saltar al mes con datos más reciente.
  //  b) no hay datos en ningún lado → banner de "cargar ejemplo".
  const mesesData   = d.mesesConDatos || {};
  const mesesKeys   = Object.keys(mesesData).sort();       // asc
  const hayAlgunDato = mesesKeys.length > 0;
  const mesActivo   = d.mes || $('filtroMes')?.value || '';
  const mesVacio    = (d.kpis.txnCount || 0) === 0;

  if (!hayAlgunDato && !(d.accounts && d.accounts.length)) {
    mostrarEstadoVacio();           // caso b: no hay nada en ningún mes
  } else if (mesVacio && hayAlgunDato) {
    const ultimo = mesesKeys[mesesKeys.length - 1];         // mes con datos más reciente
    mostrarMesVacio(mesActivo, ultimo, mesesData);          // caso a
  } else {
    ocultarEstadoVacio();
  }

  // KPIs
  setText('kpi-neto',     COP.format(d.kpis.totalNeto   || 0));
  setText('kpi-income',   COP.format(d.kpis.income      || 0));
  setText('kpi-expense',  COP.format(d.kpis.expense     || 0));
  setText('kpi-savings',  COP.format(d.kpis.savings     || 0));
  setText('kpi-burn',     (d.kpis.burnRate || 0).toFixed(1) + '%');
  setText('kpi-inv',      COP.format(d.kpis.inversiones || 0));
  setText('kpi-efec',     COP.format(d.kpis.efectivo    || 0));
  setText('kpi-cuentas-n',d.accounts?.length || 0);
  setText('invTotal',     COP.format(d.kpis.inversiones || 0));
  setText('invPositions', d.inversiones?.length || 0);

  // Email badge
  if (d.emailPending > 0) {
    const badge = $('emailBadge');
    badge.textContent = d.emailPending;
    badge.style.display = 'inline-block';
  } else {
    $('emailBadge').style.display = 'none';
  }

  // Llenar selects
  const cats = (d.combos?.categorias  || []).filter(c => !c.includes('↔'));
  const cts = d.combos?.cuentas || [];

  // Poblar filtro de categorías del topbar
  // value = nombre sin emoji (para coincidir con t.cat en historial), texto = con emoji
  const filtroCatEl = $('filtroCat');
  if (filtroCatEl && cats.length) {
    const prev = filtroCatEl.value;
    const _stripE = s => String(s||'').replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}‍\s]+/u,'').trim();
    filtroCatEl.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => {
        const plainName = _stripE(c);
        return `<option value="${esc(plainName)}"${plainName===prev?'selected':''}>${esc(c)}</option>`;
      }).join('');
  }
  fillSelect('selCat',    cats);
  fillSelect('selCuenta', cts);
  fillSelect('selDest',   cts);
  // Llenar selects de modales de edición
  fillSelect('emailEditCat', cats);
  fillSelect('emailEditAccount', cts);
  fillSelect('editTxnCat', cats);
  fillSelect('editTxnCuenta', cts);
  fillSelect('eventCat', cats);
  fillSelect('pdfCuenta', cts);

  // Cada sección se renderiza aislada: si una falla, NO debe impedir que se
  // dibujen las demás (antes, un error aquí dejaba las gráficas en blanco).
  _safe('topGastos',    () => renderTopGastos(d.topGastos || []));
  _safe('resumenMes',   () => renderResumenMes(d));
  _safe('patterns',     () => renderPatternInsights(d));
  _safe('heatmap',      () => renderSpendingHeatmap(d));
  _safe('kpiDeltas',    () => _renderKpiDeltas(d));

  // Transacciones recientes en dashboard — solo del mes filtrado
  _safe('recentTxns',   () => {
    const _mesActivo = d.mes || $('filtroMes')?.value || '';
    const _recentMes = _mesActivo
      ? (d.historial||[]).filter(t => t.mes === _mesActivo).slice(0, 8)
      : (d.historial||[]).slice(0, 8);
    renderRecentTxns(_recentMes);
  });

  _safe('accounts',     () => renderAccounts(d.accounts || []));
  _safe('inversiones',  () => renderInversiones(d.inversiones || [], d.invPorTipo || [], d.invPorBroker || []));
  _safe('presupuesto',  () => renderPresupuesto(d.budget || {}));
  _safe('budgetTpl',    () => renderBudgetTemplateEditor(d.budget || {}));
  _safe('periodSumm',   () => renderPeriodSummaries(d.summary || {}));
  _safe('workspace',    () => renderWorkspaceSummary(d));

  // Charts — SIEMPRE se intentan al final, pase lo que pase arriba.
  _safe('charts',       () => buildCharts(d));

  // If a non-default period is active, re-render it with new data
  if (_periodView === 'semana')   renderWeekView(d);
  if (_periodView === 'año')      renderYearView(d);
  if (_periodView === 'comparar') renderCompareView(d);

  // Re-render movimientos if that page is active
  if ($('page-movimientos')?.classList.contains('active')) renderMovimientos();
}

function renderWorkspaceSummary(d) {
  const month = d.mes || $('filtroMes')?.value || '';
  const [year, monthNum] = String(month).split('-').map(Number);
  const monthDate = year && monthNum ? new Date(year, monthNum - 1, 1) : null;
  const prettyMonth = monthDate
    ? monthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
    : month;
  const saas = d.saas || {};
  const healthScore = Number(saas.healthScore || 0);
  const budgetPct = Number(saas.budgetUsagePct || 0);
  const runway = saas.runwayMonths == null ? 'Sin gasto' : `${saas.runwayMonths.toFixed(1)} meses`;

  setText('heroMonthLabel', prettyMonth ? prettyMonth.replace(/^\w/, c => c.toUpperCase()) : '-');
  setText('saasRunway', runway);
  setText('saasSetupProgress', `${Math.round(saas.setupProgress || 0)}%`);
  setText('saasHealthScore', String(Math.round(healthScore)));
  setText('saasHealthText', `${saas.healthLabel || 'Sin clasificar'}${saas.healthTips?.[0] ? ` · ${saas.healthTips[0]}` : ''}`);
  setText('saasBudgetStatus', `${budgetPct.toFixed(0)}%`);
  setText('saasInboxStatus', String(d.emailPending || 0));

  const setupBar = $('saasSetupBar');
  if (setupBar) setupBar.style.width = `${Math.max(0, Math.min(100, Number(saas.setupProgress || 0)))}%`;

  const checklist = $('saasChecklist');
  if (checklist) {
    checklist.innerHTML = (saas.setupItems || []).map(item => `
      <div class="saas-check ${item.ready ? 'ready' : 'pending'}">
        <div class="saas-check-left">
          <i class="fas ${item.ready ? 'fa-circle-check' : 'fa-circle'}"></i>
          <span>${esc(item.label)}</span>
        </div>
        <span class="saas-check-state">${item.ready ? 'Listo' : 'Pendiente'}</span>
      </div>
    `).join('') || '<div class="empty-state"><p>Sin checklist disponible</p></div>';
  }

  const alerts = $('saasAlerts');
  if (alerts) {
    alerts.innerHTML = (saas.alerts || []).map(alert => `
      <div class="saas-list-item ${esc(alert.level || 'success')}">
        <i class="fas ${alert.level === 'danger' ? 'fa-triangle-exclamation' : alert.level === 'warning' ? 'fa-bell' : 'fa-circle-check'}"></i>
        <div>${esc(alert.text || '')}</div>
      </div>
    `).join('');
  }

  // Inbox alert badge en el header compacto
  const alertBadge = $('alertBadge');
  if (alertBadge) {
    const pending = d.emailPending || 0;
    alertBadge.style.display = pending > 0 ? 'flex' : 'none';
    setText('saasInboxStatus', String(pending));
  }

  // Re-apply period view if changed
  if (_periodView !== 'mes') {
    const activeTab = $('ptab-' + _periodView);
    setPeriodView(_periodView, activeTab);
  }
}

function renderPeriodSummaries(summary) {
  const render = (id, data, label) => {
    const el = $(id);
    if (!el) return;
    const income = Number(data?.income || 0);
    const expense = Number(data?.expense || 0);
    const net = Number(data?.net || 0);
    const transfer = Number(data?.transfer || 0);
    const count = Number(data?.count || 0);
    el.innerHTML = `
      <div style="display:grid;gap:10px">
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px">
          <span>Ingresos</span><strong class="mono" style="color:var(--emerald)">${COP.format(income)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px">
          <span>Gastos</span><strong class="mono" style="color:var(--red)">${COP.format(expense)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px">
          <span>Neto</span><strong class="mono" style="color:${net >= 0 ? 'var(--emerald)' : 'var(--red)'}">${COP.format(net)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px">
          <span>Transferencias</span><strong class="mono">${COP.format(transfer)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--text-muted)">
          <span>${label}</span><strong class="mono">${count} movimientos</strong>
        </div>
      </div>
    `;
  };
  render('summaryWeek', summary.week || {}, 'Últimos 7 días');
  render('summaryMonth', summary.month || {}, 'Mes filtrado');
  render('summaryYear', summary.year || {}, 'Año filtrado');
}

// ═══════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════
// Ejecuta un render aislado: si falla, lo registra pero no rompe el resto.
function _safe(label, fn) {
  try { fn(); }
  catch (e) { console.warn('[render:' + label + '] ' + (e && e.message ? e.message : e)); }
}

function safeChart(key, canvasId, config) {
  try {
    const el = $(canvasId);
    if (!el) return;
    if (_charts[key]) { try { _charts[key].destroy(); } catch(e){} }
    _charts[key] = new Chart(el, config);
  } catch(e) { console.warn('Chart error [' + key + ']:', e.message); }
}

// Opciones base compartidas para tooltips oscuros uniformes
const _tooltipBase = {
  backgroundColor: 'rgba(10,15,26,.95)',
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  padding: 10,
  titleColor: '#e2e8f0',
  bodyColor: '#94a3b8',
  titleFont: { size: 12, weight: '600' },
  bodyFont: { size: 12 },
  cornerRadius: 8,
  displayColors: true,
  boxWidth: 8,
  boxHeight: 8,
  usePointStyle: true
};

// Gradiente vertical para canvas
function _grad(ctx, colorTop, colorBot) {
  try {
    const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    g.addColorStop(0, colorTop);
    g.addColorStop(1, colorBot);
    return g;
  } catch(e) { return colorTop; }
}

function buildCharts(d) {
  // Si Chart.js no cargó (CDN bloqueado, sin internet), avisar en vez de dejar
  // las tarjetas de gráficas en blanco sin explicación.
  if (typeof Chart === 'undefined') {
    console.error('Chart.js no está disponible (¿CDN bloqueado?). Las gráficas no se dibujarán.');
    document.querySelectorAll('.chart-wrap').forEach(w => {
      if (w.querySelector('.chart-missing-msg')) return;
      const m = document.createElement('div');
      m.className = 'chart-missing-msg';
      m.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--text-muted);font-size:12px;text-align:center;padding:12px;gap:6px';
      m.innerHTML = '<i class="fas fa-triangle-exclamation" style="color:var(--gold)"></i> No se pudo cargar la librería de gráficas (Chart.js). Revisa tu conexión.';
      w.appendChild(m);
    });
    return;
  }
  destroyAll();
  const isDark = !document.body.classList.contains('light-theme');
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const borderBg  = isDark ? '#0f1520' : '#ffffff';

  // ── TENDENCIA 12 MESES ─────────────────────────────────────────
  const sm = d.series?.monthly || {};
  const hasMonthly = (sm.labels||[]).length > 0;

  if (hasMonthly) {
    const trendEl = $('chartTrend');
    const trendDatasets = _trendMode === 'savings'
      ? [{
          label: 'Ahorro mensual', data: sm.savings||[],
          borderColor: '#00d4aa', backgroundColor: (ctx) => {
            if (!ctx.chart.chartArea) return 'rgba(0,212,170,.0)';
            return _grad(ctx.chart.ctx, 'rgba(0,212,170,.25)', 'rgba(0,212,170,.0)');
          },
          fill: true, tension: .45, pointRadius: 4, pointHoverRadius: 6,
          pointBackgroundColor: '#00d4aa', pointBorderColor: borderBg, pointBorderWidth: 2, borderWidth: 2
        }]
      : [
          {
            label: 'Ingresos', data: sm.income||[],
            borderColor: '#00d4aa', backgroundColor: (ctx) => {
              if (!ctx.chart.chartArea) return 'rgba(0,212,170,.0)';
              return _grad(ctx.chart.ctx, 'rgba(0,212,170,.18)', 'rgba(0,212,170,.0)');
            },
            fill: true, tension: .45, pointRadius: 3, pointHoverRadius: 5,
            pointBackgroundColor: '#00d4aa', pointBorderColor: borderBg, pointBorderWidth: 2, borderWidth: 2
          },
          {
            label: 'Gastos', data: sm.expense||[],
            borderColor: '#ff4d6d', backgroundColor: (ctx) => {
              if (!ctx.chart.chartArea) return 'rgba(255,77,109,.0)';
              return _grad(ctx.chart.ctx, 'rgba(255,77,109,.15)', 'rgba(255,77,109,.0)');
            },
            fill: true, tension: .45, pointRadius: 3, pointHoverRadius: 5,
            pointBackgroundColor: '#ff4d6d', pointBorderColor: borderBg, pointBorderWidth: 2, borderWidth: 2
          },
          {
            label: 'Ahorro', data: sm.savings||[],
            borderColor: '#3b82f6', backgroundColor: 'transparent',
            fill: false, tension: .45, pointRadius: 3, pointHoverRadius: 5,
            pointBackgroundColor: '#3b82f6', pointBorderColor: borderBg, pointBorderWidth: 2, borderWidth: 2,
            borderDash: [5, 3]
          }
        ];

    safeChart('trend', 'chartTrend', {
      type: 'line',
      data: { labels: sm.labels, datasets: trendDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeInOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16, font: { size: 11 } } },
          tooltip: {
            ...Object.assign({}, _tooltipBase),
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw || 0)}`
            }
          }
        },
        scales: {
          y: {
            ticks: { callback: v => compact(v), font: { size: 11 } },
            grid: { color: gridColor },
            border: { display: false }
          },
          x: { grid: { display: false }, ticks: { font: { size: 10 } }, border: { display: false } }
        }
      }
    });
  }

  // ── GASTOS POR CATEGORÍA — barras horizontales ─────────────────
  const byCat = d.byCat || {};
  const catEntries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  const mainCats = catEntries.slice(0,8);
  const catKeys   = mainCats.map(([k]) => k);
  const catValues = mainCats.map(([, v]) => v);
  const totalCat  = catValues.reduce((s,v) => s+v, 0);

  const donutWrap = $('chartDonut')?.parentElement;
  if (donutWrap) {
    const prevEmpty = donutWrap.querySelector('#chartDonutEmpty');
    if (prevEmpty) prevEmpty.remove();
  }
  const donutCanvas = $('chartDonut');

  if (!catKeys.length) {
    if (donutCanvas) donutCanvas.style.display = 'none';
    if (donutWrap) {
      const empty = document.createElement('div');
      empty.id = 'chartDonutEmpty';
      empty.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;gap:8px';
      empty.innerHTML = '<i class="fas fa-chart-pie" style="opacity:0.4"></i> Sin gastos en el período';
      donutWrap.appendChild(empty);
    }
  } else {
    if (donutCanvas) donutCanvas.style.display = '';
    safeChart('donut', 'chartDonut', {
      type: 'doughnut',
      data: {
        labels: catKeys,
        datasets: [{
          data: catValues,
          backgroundColor: PALETTE.slice(0, catKeys.length),
          borderWidth: 3,
          borderColor: borderBg,
          hoverBorderWidth: 2,
          hoverOffset: 12
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        animation: { animateRotate: true, duration: 700 },
        plugins: {
          legend: {
            position: 'right',
            labels: {
              usePointStyle: true, boxWidth: 8, padding: 10, font: { size: 11 },
              generateLabels: chart => {
                const ds = chart.data.datasets[0];
                return chart.data.labels.map((lbl, i) => ({
                  text: `${lbl} (${totalCat > 0 ? ((ds.data[i]/totalCat)*100).toFixed(0) : 0}%)`,
                  fillStyle: ds.backgroundColor[i],
                  strokeStyle: ds.backgroundColor[i],
                  pointStyle: 'circle',
                  index: i
                }));
              }
            }
          },
          tooltip: {
            ...Object.assign({}, _tooltipBase),
            callbacks: {
              label: ctx => {
                const pct = totalCat > 0 ? ((ctx.raw / totalCat) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${COP.format(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ── BARRAS CATEGORÍAS inline (vista Mes — al lado del donut) ─────
  const inlineEl = $('catBarsInline');
  if (inlineEl) {
    if (!catKeys.length) {
      inlineEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Sin gastos en el período</div>';
    } else {
      const maxV = catValues[0] || 1;
      inlineEl.innerHTML = catKeys.map((cat, i) => {
        const val = catValues[i];
        const pct = totalCat > 0 ? ((val / totalCat) * 100).toFixed(1) : 0;
        const barW = ((val / maxV) * 100).toFixed(1);
        return `<div style="margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
            <span style="font-weight:600;color:var(--text)">${esc(cat)}</span>
            <span class="mono" style="color:${PALETTE[i%PALETTE.length]};font-size:11px">${pct}%</span>
          </div>
          <div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">
            <div style="height:100%;width:${barW}%;background:${PALETTE[i%PALETTE.length]};border-radius:99px;transition:width .5s"></div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:1px">${COP.format(val)}</div>
        </div>`;
      }).join('');
    }
  }
  // chartCatBars sigue existiendo en el DOM hidden — lo dejamos sin renderizar

  // ── FLUJO DIARIO ───────────────────────────────────────────────
  const sd = d.series?.daily || {};
  const _dailyHasData = (sd.income||[]).some(v=>v>0) || (sd.expense||[]).some(v=>v>0);
  const hasDaily = (sd.labels||[]).length > 0 && _dailyHasData;
  // Mostrar estado vacío en el canvas de flujo diario si no hay datos
  const dailyWrap = $('chartDaily')?.parentElement;
  if (dailyWrap) {
    const prevDailyEmpty = dailyWrap.querySelector('#chartDailyEmpty');
    if (prevDailyEmpty) prevDailyEmpty.remove();
  }
  const dailyCanvas = $('chartDaily');
  if (!hasDaily && dailyCanvas) {
    dailyCanvas.style.display = 'none';
    if (dailyWrap) {
      const emptyEl = document.createElement('div');
      emptyEl.id = 'chartDailyEmpty';
      emptyEl.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;gap:8px';
      emptyEl.innerHTML = '<i class="fas fa-chart-bar" style="opacity:0.4"></i> Sin movimientos en el período';
      dailyWrap.appendChild(emptyEl);
    }
  } else if (dailyCanvas) {
    dailyCanvas.style.display = '';
  }
  if (hasDaily) {
    safeChart('daily', 'chartDaily', {
      type: 'bar',
      data: {
        labels: sd.labels,
        datasets: [
          {
            label: 'Ingresos', data: sd.income||[],
            backgroundColor: 'rgba(0,212,170,.65)',
            borderRadius: { topLeft:4, topRight:4 }, borderSkipped: 'bottom', order: 2
          },
          {
            label: 'Gastos', data: sd.expense||[],
            backgroundColor: 'rgba(255,77,109,.65)',
            borderRadius: { topLeft:4, topRight:4 }, borderSkipped: 'bottom', order: 2
          },
          {
            label: 'Neto', data: sd.net||[],
            type: 'line', borderColor: '#8b5cf6',
            backgroundColor: (ctx) => {
              if (!ctx.chart.chartArea) return 'rgba(139,92,246,.0)';
              return _grad(ctx.chart.ctx, 'rgba(139,92,246,.2)', 'rgba(139,92,246,.0)');
            },
            fill: true, tension: .4,
            pointRadius: (ctx) => (ctx.raw !== 0 ? 3 : 0),
            pointHoverRadius: 5,
            pointBackgroundColor: '#8b5cf6',
            pointBorderColor: borderBg, pointBorderWidth: 2,
            borderWidth: 2, yAxisID: 'y', order: 1
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 12, font: { size: 11 } } },
          tooltip: {
            ...Object.assign({}, _tooltipBase),
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw || 0)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 }, border: { display: false } },
          y: {
            ticks: { callback: v => compact(v), font: { size: 10 } },
            grid: { color: gridColor },
            border: { display: false }
          }
        }
      }
    });
  }

  // ── SALDO POR CUENTAS ──────────────────────────────────────────
  const accs = d.accounts || [];
  if (accs.length) {
    safeChart('cuentas', 'chartCuentas', {
      type: 'bar',
      data: {
        labels: accs.map(a => a.name),
        datasets: [
          {
            label: 'Saldo actual',
            data: accs.map(a => a.bal||0),
            backgroundColor: accs.map((_, i) => PALETTE[i % PALETTE.length] + 'bb'),
            borderColor: accs.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 1,
            borderRadius: 8, borderSkipped: false
          },
          {
            label: 'Variación mes',
            data: accs.map(a => a.deltaMes||0),
            backgroundColor: accs.map(a => (a.deltaMes||0) >= 0 ? 'rgba(0,212,170,.5)' : 'rgba(255,77,109,.5)'),
            borderRadius: 6, borderSkipped: false
          }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 10, font: { size: 11 } } },
          tooltip: {
            ...Object.assign({}, _tooltipBase),
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` }
          }
        },
        scales: {
          x: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } }, border: { display: false } }
        }
      }
    });
  }

  // ── INVERSIONES ────────────────────────────────────────────────
  const invT = d.invPorTipo || [];
  if (invT.length) safeChart('invTipo', 'chartInvTipo', {
    type: 'doughnut',
    data: { labels: invT.map(x=>x.tipo), datasets: [{ data: invT.map(x=>x.valor), backgroundColor: PALETTE, borderWidth: 3, borderColor: borderBg, hoverOffset: 10 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, padding: 10, font: { size: 11 } } },
        tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.label}: ${COP.format(ctx.raw||0)}` } }
      }
    }
  });

  const invB = d.invPorBroker || [];
  if (invB.length) safeChart('invBroker', 'chartInvBroker', {
    type: 'doughnut',
    data: { labels: invB.map(x=>x.broker), datasets: [{ data: invB.map(x=>x.valor), backgroundColor: PALETTE, borderWidth: 3, borderColor: borderBg, hoverOffset: 10 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, padding: 10, font: { size: 11 } } },
        tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.label}: ${COP.format(ctx.raw||0)}` } }
      }
    }
  });

  // ── PRESUPUESTO ────────────────────────────────────────────────
  const budget = d.budget || {};
  const bItems = (budget.items || []).filter(b => b.plan > 0);
  if (bItems.length) {
    safeChart('budget', 'chartBudget', {
      type: 'bar',
      data: {
        labels: bItems.map(b => b.cat),
        datasets: [
          { label: 'Presupuesto', data: bItems.map(b => b.plan), backgroundColor: 'rgba(59,130,246,.35)', borderRadius: 4, borderSkipped: false },
          {
            label: 'Real',
            data: bItems.map(b => b.spent),
            backgroundColor: bItems.map(b => b.spent > b.plan ? 'rgba(255,77,109,.75)' : 'rgba(0,212,170,.7)'),
            borderRadius: 4, borderSkipped: false
          }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
          tooltip: {
            ...Object.assign({}, _tooltipBase),
            callbacks: {
              label: ctx => {
                const b = bItems[ctx.dataIndex];
                if (!b) return ` ${COP.format(ctx.raw||0)}`;
                if (ctx.dataset.label === 'Real') {
                  const pct = b.plan > 0 ? ((b.spent/b.plan)*100).toFixed(0) : 0;
                  return ` Real: ${COP.format(b.spent)} (${pct}%)`;
                }
                return ` Presupuesto: ${COP.format(b.plan)}`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } }, border: { display: false } }
        }
      }
    });

    safeChart('budgetRadar', 'chartBudgetRadar', {
      type: 'radar',
      data: {
        labels: bItems.slice(0, 8).map(b => b.cat),
        datasets: [
          { label: 'Plan', data: bItems.slice(0,8).map(b=>b.plan), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.15)', pointBackgroundColor: '#3b82f6', borderWidth: 2, pointRadius: 3 },
          { label: 'Real', data: bItems.slice(0,8).map(b=>b.spent), borderColor: '#ff4d6d', backgroundColor: 'rgba(255,77,109,.12)', pointBackgroundColor: '#ff4d6d', borderWidth: 2, pointRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
          tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` } }
        },
        scales: {
          r: {
            angleLines: { color: 'rgba(255,255,255,0.06)' },
            grid: { color: 'rgba(255,255,255,0.06)' },
            pointLabels: { color: '#94a3b8', font: { size: 10 } },
            ticks: { display: false, backdropColor: 'transparent' }
          }
        }
      }
    });
  }

  const bm = budget.monthly || {};
  if ((bm.labels||[]).length) safeChart('budgetMonthly', 'chartBudgetMonthly', {
    type: 'bar',
    data: {
      labels: bm.labels,
      datasets: [
        { label: 'Plan', data: bm.plan||[], backgroundColor: 'rgba(59,130,246,.45)', borderRadius: 6, borderSkipped: false },
        { label: 'Real', data: bm.actual||[], backgroundColor: 'rgba(255,77,109,.65)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
        tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` } }
      },
      scales: {
        y: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } },
        x: { grid: { display: false }, border: { display: false } }
      }
    }
  });

  // ── SEMANA ─────────────────────────────────────────────────────
  const ws = d.summary?.weekSeries || {};
  if ((ws.labels||[]).length) safeChart('week', 'chartWeek', {
    type: 'bar',
    data: {
      labels: ws.labels,
      datasets: [
        { label: 'Ingresos', data: ws.income||[], backgroundColor: 'rgba(0,212,170,.6)', borderRadius: 5, borderSkipped: false, order: 2 },
        { label: 'Gastos',   data: ws.expense||[], backgroundColor: 'rgba(255,77,109,.6)', borderRadius: 5, borderSkipped: false, order: 2 },
        { label: 'Neto', data: ws.net||[], type: 'line', borderColor: '#8b5cf6', backgroundColor: 'transparent', tension: .4, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#8b5cf6', borderWidth: 2, order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 500 },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
        tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` } }
      },
      scales: {
        y: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } },
        x: { grid: { display: false }, border: { display: false } }
      }
    }
  });
}

function setTrend(mode) {
  _trendMode = mode;
  ['mix','savings'].forEach(m => {
    const btn = $('trendBtn-' + m);
    if (btn) btn.className = 'btn btn-' + (m === mode ? 'primary' : 'ghost') + ' btn-sm';
  });
  if (_data) buildCharts(_data);
}

function destroyAll() {
  Object.keys(_charts).forEach(k => { if (_charts[k]) { _charts[k].destroy(); delete _charts[k]; } });
}

// ═══════════════════════════════════════════════════════
// RENDER COMPONENTS
// ── Resumen del período ────────────────────────────────
function renderResumenMes(d) {
  const sub = $('resumenMesSub');
  const body = $('resumenMesBody');
  if (!body) return;

  const kpis = d.kpis || {};
  const mes = d.mes || $('filtroMes')?.value || '';
  const [y, mo] = String(mes).split('-').map(Number);
  const prettyMesStr = (y && mo)
    ? new Date(y, mo-1, 1).toLocaleDateString('es-CO', { month:'long', year:'numeric' })
    : mes;
  if (sub) sub.textContent = prettyMesStr ? prettyMesStr.replace(/^\w/, c => c.toUpperCase()) : '';

  const income  = kpis.income  || 0;
  const expense = kpis.expense || 0;
  const savings = kpis.savings || 0;
  const burn    = kpis.burnRate || 0;
  const mes_ = d.mes || $('filtroMes')?.value || '';
  const txnCount = kpis.txnCount != null ? kpis.txnCount
    : (d.historial||[]).filter(t => t.mes === mes_).length;
  const savingsRate = income > 0 ? ((savings/income)*100) : 0;

  const row = (label, value, colorStyle, extra) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;color:var(--text-muted)">${label}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="mono" style="font-weight:600;${colorStyle}">${value}</span>
        ${extra||''}
      </div>
    </div>`;

  const badge = (val, ok) => `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;background:${ok?'rgba(0,212,170,.12)':'rgba(255,77,109,.12)'};color:${ok?'var(--emerald)':'var(--red)'};">${val}</span>`;

  body.innerHTML = [
    row('Ingresos',     COP.format(income),  'color:var(--emerald)'),
    row('Gastos',       COP.format(expense), 'color:var(--red)'),
    row('Ahorro neto',  COP.format(savings), `color:${savings>=0?'var(--emerald)':'var(--red)'}`, badge((savingsRate>=0?'+':'')+savingsRate.toFixed(1)+'%', savings>=0)),
    row('Burn rate',    burn.toFixed(1)+'%', `color:${burn<70?'var(--emerald)':burn<90?'var(--gold)':'var(--red)'}`, badge(burn<70?'Saludable':burn<90?'Moderado':'Alto', burn<70)),
    row('Movimientos',  txnCount+' registros', 'color:var(--text)', ''),
    row('Capital total', COP.format(kpis.totalNeto||0), 'color:var(--text)', '')
  ].join('') + `
    <div style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px;color:var(--text-muted)">
        <span>Tasa de ahorro</span><span style="font-weight:600;color:${savings>=0?'var(--emerald)':'var(--red)'}">${savingsRate.toFixed(1)}%</span>
      </div>
      <div class="progress">
        <div class="progress-fill" style="width:${Math.max(0,Math.min(100,savingsRate)).toFixed(1)}%;background:${savings>=0?'var(--emerald)':'var(--red)'}"></div>
      </div>
    </div>`;

  // Actualizar subtítulo del donut con total gastos
  const donutSub = $('donutSubtitle');
  if (donutSub) donutSub.textContent = expense > 0 ? `Total: ${COP.format(expense)}` : '';
}

// ═══════════════════════════════════════════════════════
// KPI DELTAS — flechas vs mes anterior
// ═══════════════════════════════════════════════════════
function _renderKpiDeltas(d) {
  const sm   = d.series?.monthly || {};
  const lbls  = sm.labels  || [];
  const incs  = sm.income  || [];
  const exps  = sm.expense || [];
  const curMes = d.mes || $('filtroMes')?.value || '';
  const idx   = lbls.indexOf(curMes);
  if (idx <= 0) { ['kpi-delta-income','kpi-delta-expense','kpi-delta-savings'].forEach(id => { const el=$(id); if(el) el.innerHTML=''; }); return; }
  const prevInc = incs[idx-1] || 0;
  const prevExp = exps[idx-1] || 0;
  const curInc  = incs[idx]  || 0;
  const curExp  = exps[idx]  || 0;
  const curSav  = curInc - curExp;
  const prevSav = prevInc - prevExp;

  const delta = (cur, prev, inverse) => {
    if (!prev) return '';
    const pct = ((cur - prev) / Math.abs(prev) * 100);
    const good = inverse ? pct < 0 : pct > 0;
    const sign = pct >= 0 ? '+' : '';
    const arrow = pct > 0.5 ? '↑' : pct < -0.5 ? '↓' : '→';
    return `<span class="kpi-delta ${good ? 'kpi-delta-good' : 'kpi-delta-bad'}">${arrow} ${sign}${pct.toFixed(1)}%</span>`;
  };

  const di = $('kpi-delta-income');  if (di) di.innerHTML = delta(curInc, prevInc, false);
  const de = $('kpi-delta-expense'); if (de) de.innerHTML = delta(curExp, prevExp, true);
  const ds = $('kpi-delta-savings'); if (ds) ds.innerHTML = delta(curSav, prevSav, false);
}

// ═══════════════════════════════════════════════════════
// PATTERN INSIGHTS
// ═══════════════════════════════════════════════════════
function renderPatternInsights(d) {
  const el = $('patternInsights');
  if (!el) return;
  const curMes  = d.mes || $('filtroMes')?.value || '';
  const hist    = (d.historial || []).filter(t => t.mes === curMes && (t.type === 'expense' || t.type === 'investment'));
  if (!hist.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-lightbulb"></i><p>Sin datos de gasto para analizar</p></div>'; return; }

  // Gasto por día de la semana
  const byDow    = Array(7).fill(0);
  const countDow = Array(7).fill(0);
  const dowNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  hist.forEach(t => {
    const [dd, mm, yy] = String(t.fecha || '').split('/').map(Number);
    if (!yy) return;
    const dow = new Date(yy, mm-1, dd).getDay();
    byDow[dow]   += t.monto || 0;
    countDow[dow]++;
  });
  const maxDow    = byDow.indexOf(Math.max(...byDow));
  const avgDow    = byDow.map((v, i) => countDow[i] > 0 ? v / countDow[i] : 0);
  const peakAvgDow = avgDow.indexOf(Math.max(...avgDow));

  // Top merchant por monto y por frecuencia
  const byMerchant = {};
  const freqMerchant = {};
  hist.forEach(t => {
    const m = t.merchant || t.desc || 'Desconocido';
    byMerchant[m]   = (byMerchant[m]   || 0) + (t.monto || 0);
    freqMerchant[m] = (freqMerchant[m] || 0) + 1;
  });
  const topMerchantEntry = Object.entries(byMerchant).sort((a,b) => b[1]-a[1])[0];
  const topFreqEntry     = Object.entries(freqMerchant).sort((a,b) => b[1]-a[1])[0];

  // Mayor gasto individual
  const bigTxn = hist.reduce((a, t) => (t.monto||0) > (a.monto||0) ? t : a, hist[0]);

  // Días con gasto vs días en el mes
  const [y, mo] = String(curMes).split('-').map(Number);
  const daysInMonth   = y && mo ? new Date(y, mo, 0).getDate() : 30;
  const activeDays    = new Set(hist.map(t => t.fecha)).size;
  const totalExpMonth = hist.reduce((s, t) => s + (t.monto||0), 0);
  const avgPerActiveDay = totalExpMonth / (activeDays || 1);
  const avgPerCalDay    = totalExpMonth / (daysInMonth || 1);

  // Categoría más frecuente (en número de transacciones)
  const byCatCount = {};
  const byCatSum   = {};
  hist.forEach(t => {
    byCatCount[t.cat] = (byCatCount[t.cat] || 0) + 1;
    byCatSum[t.cat]   = (byCatSum[t.cat]   || 0) + (t.monto || 0);
  });
  const topCatFreq  = Object.entries(byCatCount).sort((a,b) => b[1]-a[1])[0];
  const topCatMonto = Object.entries(byCatSum).sort((a,b)   => b[1]-a[1])[0];

  // Comparación vs mes anterior en series.monthly
  const sm = d.series?.monthly || {};
  const lbls = sm.labels || [];
  const exps = sm.expense || [];
  const curIdx  = lbls.indexOf(curMes);
  let vsAnterior = '';
  if (curIdx > 0 && exps[curIdx-1] > 0) {
    const prevExp = exps[curIdx-1] || 0;
    const curExp  = d.kpis?.expense || 0;
    const diff    = curExp - prevExp;
    const pct     = Math.abs(prevExp) > 0 ? (diff / prevExp * 100) : 0;
    const dir     = diff > 0 ? '↑ más' : '↓ menos';
    const clrV    = diff > 0 ? 'var(--red)' : 'var(--emerald)';
    vsAnterior    = `<span style="color:${clrV};font-weight:700">${dir} ${Math.abs(pct).toFixed(0)}%</span> vs mes anterior`;
  }

  // Racha sin gastos grandes (> 50k)
  const bigThreshold = 50000;
  const sortedFechas = [...new Set(hist.filter(t=>(t.monto||0) >= bigThreshold).map(t=>t.fecha))].sort();
  const streakStart  = sortedFechas.length > 0 ? sortedFechas[sortedFechas.length-1] : null;

  // Ahorro diario necesario para meta activa más urgente
  let metaInsight = '';
  if (_metasData && _metasData.length) {
    const metaActiva = _metasData.filter(m => !m.completada && m.aporte_necesario_mes).sort((a,b) => (a.dias_restantes||9999)-(b.dias_restantes||9999))[0];
    if (metaActiva) {
      const diario = Math.ceil((metaActiva.aporte_necesario_mes || 0) / 30);
      metaInsight = `Para tu meta "${metaActiva.nombre.substring(0,20)}", ahorra ${COP.format(diario)}/día`;
    }
  }

  const insight = (icon, color, title, value, sub) =>
    `<div class="insight-card" style="border-left:3px solid ${color}">
      <div class="insight-icon" style="color:${color}"><i class="fas ${icon}"></i></div>
      <div>
        <div class="insight-title">${title}</div>
        <div class="insight-value mono" style="color:${color}">${value}</div>
        ${sub ? `<div class="insight-sub">${sub}</div>` : ''}
      </div>
    </div>`;

  el.innerHTML =
    insight('fa-calendar-day', 'var(--red)',    'Día más costoso',       dowNames[maxDow],       `Total ${COP.format(byDow[maxDow])} en el mes`) +
    insight('fa-clock',        'var(--gold)',   'Día promedio más caro', dowNames[peakAvgDow],   `Prom: ${COP.format(Math.round(avgDow[peakAvgDow]))}`) +
    (topMerchantEntry ? insight('fa-store',    'var(--purple)', 'Mayor comercio',        esc(topMerchantEntry[0].substring(0,22)), COP.format(topMerchantEntry[1])) : '') +
    (topFreqEntry && topFreqEntry[1] > 1 ? insight('fa-repeat',  'var(--blue)',   'Comercio más frecuente', esc(topFreqEntry[0].substring(0,22)), `${topFreqEntry[1]} veces`) : '') +
    insight('fa-bolt',         'var(--red)',    'Mayor gasto individual', COP.format(bigTxn?.monto||0), esc((bigTxn?.desc||bigTxn?.merchant||'').substring(0,28))) +
    insight('fa-calendar-check','var(--blue)',  'Días activos',          `${activeDays} de ${daysInMonth}`, `Prom diario: ${COP.format(Math.round(avgPerCalDay))}`) +
    (topCatFreq ? insight('fa-tags',    'var(--gold)',  'Categoría más usada',   esc(topCatFreq[0]),   `${topCatFreq[1]} transacciones · ${COP.format(byCatSum[topCatFreq[0]]||0)}`) : '') +
    (vsAnterior  ? insight('fa-chart-line','var(--purple)', 'Versus mes anterior', '', vsAnterior) : '') +
    (metaInsight ? insight('fa-bullseye-arrow','var(--emerald)', 'Sugerencia de ahorro', '', metaInsight) : '') +
    (streakStart ? insight('fa-fire-flame-curved','var(--gold)', 'Último gasto alto', streakStart, `> ${COP.format(bigThreshold)}`) : '');
}

// ═══════════════════════════════════════════════════════
// SPENDING HEATMAP CALENDAR
// ═══════════════════════════════════════════════════════
function renderSpendingHeatmap(d) {
  const el = $('spendingHeatmap');
  if (!el) return;
  const curMes = d.mes || $('filtroMes')?.value || '';
  const [y, mo] = String(curMes).split('-').map(Number);
  if (!y || !mo) { el.innerHTML = ''; return; }

  const hist = (d.historial || []).filter(t => t.mes === curMes && (t.type === 'expense' || t.type === 'investment'));
  const byDay = {};
  hist.forEach(t => {
    const [dd] = String(t.fecha || '').split('/').map(Number);
    if (dd) byDay[dd] = (byDay[dd] || 0) + (t.monto || 0);
  });

  const maxDay = Math.max(...Object.values(byDay), 1);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const firstDow = new Date(y, mo-1, 1).getDay();
  const dowHeaders = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  let html = `<div class="heatmap-grid">`;
  html += dowHeaders.map(h => `<div class="heatmap-header">${h}</div>`).join('');

  // empty cells before first day
  for (let i = 0; i < firstDow; i++) html += `<div class="heat-cell heat-cell-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const val = byDay[d] || 0;
    const intensity = val > 0 ? Math.ceil((val / maxDay) * 5) : 0;
    const today = new Date();
    const isToday = today.getFullYear() === y && today.getMonth()+1 === mo && today.getDate() === d;
    html += `<div class="heat-cell heat-${intensity}${isToday?' heat-today':''}" title="${d}/${mo}: ${val > 0 ? COP.format(val) : 'Sin gasto'}">
      <span class="heat-day">${d}</span>
      ${val > 0 ? `<span class="heat-amt">${compact(val)}</span>` : ''}
    </div>`;
  }
  html += `</div>`;

  // Legend
  html += `<div class="heatmap-legend">
    <span style="font-size:10px;color:var(--text-muted)">Menor</span>
    ${[0,1,2,3,4,5].map(i=>`<div class="heat-legend-cell heat-${i}"></div>`).join('')}
    <span style="font-size:10px;color:var(--text-muted)">Mayor gasto</span>
  </div>`;

  el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════
function renderTopGastos(items) {
  const el = $('topGastosList');
  if (!el) return;
  const maxVal = items[0]?.val || 1;
  el.innerHTML = items.length ? items.map((g, i) => `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px">
        <span style="font-weight:500">${esc(g.cat)}</span>
        <span class="mono" style="color:var(--text-muted)">${COP.format(g.val)}</span>
      </div>
      <div class="progress">
        <div class="progress-fill" style="width:${(g.val/maxVal*100).toFixed(1)}%;background:${['#ff4d6d','#f5a623','#8b5cf6','#3b82f6','#00d4aa'][i]||'#64748b'}"></div>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><i class="fas fa-chart-bar"></i><p>Sin gastos este mes</p></div>';
}

function renderRecentTxns(txns) {
  const el = $('recentTxns');
  if (!el) return;
  el.innerHTML = txns.map(t => txnRow(t, false)).join('') || emptyRow(6, 'Sin movimientos');
}

let _movSortCol = 'fecha';
let _movSortDir = 'desc';

function _populateMovFilters() {
  if (!_data) return;
  const hist = _data.historial || [];

  // Poblar meses disponibles
  const mesSel = $('filterMovMes');
  if (mesSel) {
    const meses = [...new Set(hist.map(t => t.mes).filter(Boolean))].sort().reverse();
    const prevMes = mesSel.value;
    const activeMes = _data.mes || $('filtroMes')?.value || '';
    mesSel.innerHTML = '<option value="">Todos los meses</option>' +
      meses.map(m => `<option value="${esc(m)}"${m === (prevMes||activeMes) ? ' selected' : ''}>${prettyMonth(m)}</option>`).join('');
  }

  // Poblar categorías disponibles
  const catSel = $('filterMovCat');
  if (catSel) {
    const cats = [...new Set(hist.map(t => t.cat).filter(Boolean))].sort();
    const prevCat = catSel.value;
    catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${esc(c)}"${c === prevCat ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }
}

function renderMovimientos() {
  if (!_data) return;
  _populateMovFilters();

  const q    = ($('searchMov')?.value || '').toLowerCase();
  const type = $('filterType')?.value || '';
  const mes  = $('filterMovMes')?.value || '';
  const cat  = $('filterMovCat')?.value || '';
  const hasFilter = q || type || mes || cat;
  const btnClear = $('btnClearMovFilters');
  if (btnClear) btnClear.style.display = hasFilter ? '' : 'none';

  let rows = (_data.historial || []).filter(t => {
    if (mes  && t.mes  !== mes)  return false;
    if (cat  && t.cat  !== cat)  return false;
    if (type && t.type !== type) return false;
    if (q && !`${t.fecha} ${t.cat} ${t.desc} ${t.cuenta}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // Sort
  rows = [...rows].sort((a, b) => {
    if (_movSortCol === 'monto') {
      return _movSortDir === 'asc' ? (a.monto||0) - (b.monto||0) : (b.monto||0) - (a.monto||0);
    }
    const aV = String(a[_movSortCol] || '');
    const bV = String(b[_movSortCol] || '');
    return _movSortDir === 'asc' ? aV.localeCompare(bV) : bV.localeCompare(aV);
  });

  // Stats bar
  const statsEl = $('movStatsBar');
  if (statsEl) {
    const inc = rows.filter(t => t.type === 'income').reduce((s, t) => s + (t.monto||0), 0);
    const exp = rows.filter(t => t.type === 'expense').reduce((s, t) => s + (t.monto||0), 0);
    const inv = rows.filter(t => t.type === 'investment').reduce((s, t) => s + (t.monto||0), 0);
    const net = inc - exp;
    statsEl.innerHTML = [
      { label: 'Ingresos', val: inc,  color: 'var(--emerald)', icon: 'fa-arrow-trend-up' },
      { label: 'Gastos',   val: exp,  color: 'var(--red)',     icon: 'fa-arrow-trend-down' },
      { label: 'Neto',     val: net,  color: net >= 0 ? 'var(--emerald)' : 'var(--red)', icon: 'fa-scale-balanced' },
      { label: 'Inversiones', val: inv, color: 'var(--purple)', icon: 'fa-chart-mixed' }
    ].map(s => `
      <div class="kpi-card" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <i class="fas ${s.icon}" style="color:${s.color};font-size:13px"></i>
          <span class="kpi-label" style="margin:0">${s.label}</span>
        </div>
        <div class="mono" style="font-size:16px;font-weight:700;color:${s.color}">${(net<0&&s.label==='Neto'?'-':'')}${COP.format(Math.abs(s.val))}</div>
      </div>
    `).join('');
  }

  // Table
  const el = $('allTxns');
  if (el) el.innerHTML = rows.map(t => txnRow(t, true)).join('') || emptyRow(7, 'Sin resultados para los filtros aplicados');

  // Footer
  const cnt = $('movCount');
  if (cnt) cnt.textContent = `${rows.length} de ${(_data.historial||[]).length} movimientos`;
  const sumLine = $('movSumLine');
  if (sumLine && rows.length) {
    const expRows = rows.filter(t => t.type === 'expense');
    const incRows = rows.filter(t => t.type === 'income');
    const parts = [];
    if (incRows.length) parts.push(`<span style="color:var(--emerald)">+${COP.format(incRows.reduce((s,t)=>s+(t.monto||0),0))}</span>`);
    if (expRows.length) parts.push(`<span style="color:var(--red)">-${COP.format(expRows.reduce((s,t)=>s+(t.monto||0),0))}</span>`);
    sumLine.innerHTML = parts.join(' · ');
  } else if (sumLine) sumLine.textContent = '';

  // Sort indicators
  document.querySelectorAll('.mov-th-sort').forEach(th => {
    const col = th.dataset.col;
    const icon = th.querySelector('i');
    if (icon) icon.className = col === _movSortCol
      ? (_movSortDir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down')
      : 'fas fa-sort';
  });
}

function clearMovFilters() {
  const ids = ['searchMov','filterType','filterMovMes','filterMovCat'];
  ids.forEach(id => { const el = $(id); if (el) el.value = ''; });
  renderMovimientos();
}

function sortMovTable(col) {
  if (_movSortCol === col) {
    _movSortDir = _movSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _movSortCol = col;
    _movSortDir = col === 'fecha' ? 'desc' : 'asc';
  }
  renderMovimientos();
}

function renderAccounts(accs) {
  const el = $('accountsList');
  if (!el) return;
  el.innerHTML = accs.map(a => `
    <div class="account-card">
      <div>
        <div class="account-name">${esc(a.name)}</div>
        <div class="account-type">${typeLabel(a.type)} · Mes ${a.deltaMes >= 0 ? '+' : ''}${COP.format(a.deltaMes || 0)}</div>
      </div>
      <div class="account-bal ${a.bal < 0 ? 'text-danger' : ''}" style="color:${a.bal >= 0 ? 'var(--emerald)' : 'var(--red)'}">
        ${COP.format(a.bal)}
      </div>
      <div style="grid-column:1 / -1;display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--text-muted);margin-top:6px">
        <span>Ingresos: ${COP.format(a.ingresosMes || 0)}</span>
        <span>Gastos: ${COP.format(a.gastosMes || 0)}</span>
        <span>Transferencias: ${COP.format(a.transferenciasMes || 0)}</span>
      </div>
    </div>
  `).join('') || '<div class="empty-state"><i class="fas fa-wallet"></i><p>Sin cuentas</p></div>';
}

function renderPresupuesto(budget) {
  const el = $('budgetDetail');
  const items = (budget.items || []).filter(b => b.plan > 0);
  if (!el) return;

  const meta = $('budgetMeta');
  const totalPlan = budget.totalPlan || 0;
  const totalReal = budget.totalReal || 0;
  const totalPct  = totalPlan > 0 ? Math.min((totalReal / totalPlan) * 100, 100) : 0;
  const totalOver = totalReal > totalPlan;
  if (meta) meta.innerHTML = `
    <span style="color:var(--text-muted)">Plan: ${COP.format(totalPlan)}</span>
    <span style="margin:0 6px;color:var(--border2)">·</span>
    <span style="color:${totalOver?'var(--red)':'var(--emerald)'}">Real: ${COP.format(totalReal)}</span>
    <span style="margin:0 6px;color:var(--border2)">·</span>
    <span style="color:${totalOver?'var(--red)':'var(--text-muted)'}">Disponible: ${COP.format(totalPlan - totalReal)}</span>`;

  // Calcular días del mes para proyección
  const curMes = _data?.mes || $('filtroMes')?.value || '';
  const [y, mo] = String(curMes).split('-').map(Number);
  const today = new Date();
  const daysInMonth = (y && mo) ? new Date(y, mo, 0).getDate() : 30;
  const dayOfMonth = (y && mo && today.getFullYear()===y && today.getMonth()+1===mo) ? today.getDate() : daysInMonth;
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth);
  const daysFrac = dayOfMonth / daysInMonth; // fracción del mes transcurrida

  if (!items.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-bullseye-arrow"></i><p>Sin presupuestos configurados.<br>Agrégalos en la hoja Budgets.</p></div>';
    return;
  }

  el.innerHTML = items.map(b => {
    const pct      = b.plan > 0 ? Math.min((b.spent / b.plan) * 100, 100) : 0;
    const over     = b.spent > b.plan;
    const clr      = over ? 'var(--red)' : pct > 80 ? 'var(--gold)' : 'var(--emerald)';
    const remaining = b.plan - b.spent;

    // Proyección: si el gasto sigue al ritmo actual, ¿llegará al límite?
    let proyTag = '';
    if (dayOfMonth > 0 && !over && daysFrac > 0.05) {
      const dailyRate   = b.spent / dayOfMonth;
      const projected   = dailyRate * daysInMonth;
      const projPct     = b.plan > 0 ? (projected / b.plan * 100) : 0;
      if (projected > b.plan) {
        const daysToLimit = b.spent > 0 ? Math.floor((b.plan - b.spent) / dailyRate) : null;
        proyTag = daysToLimit !== null && daysToLimit <= daysRemaining
          ? `<span style="font-size:10px;color:var(--red);font-weight:600">⚡ Excederá en ~${daysToLimit}d</span>`
          : `<span style="font-size:10px;color:var(--gold)">⚠ Proyección: ${projPct.toFixed(0)}%</span>`;
      } else if (projPct > 75) {
        proyTag = `<span style="font-size:10px;color:var(--gold)">Proyección: ${projPct.toFixed(0)}%</span>`;
      } else {
        proyTag = `<span style="font-size:10px;color:var(--emerald)">Proyección: ${projPct.toFixed(0)}%</span>`;
      }
    }

    return `
      <div style="margin-bottom:18px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px">
          <span style="font-weight:600">${esc(b.cat)}</span>
          <div style="display:flex;align-items:center;gap:8px">
            ${proyTag}
            <span class="mono" style="color:${clr};font-size:13px;font-weight:700">${pct.toFixed(0)}%${over?' ⚠️':''}</span>
          </div>
        </div>
        <div class="progress" style="height:10px">
          <div class="progress-fill" style="width:${pct.toFixed(1)}%;background:${clr};border-radius:5px;transition:width .6s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:11px;color:var(--text-muted)">
          <span>Gastado: <strong class="mono" style="color:${clr}">${COP.format(b.spent)}</strong></span>
          <span>Disponible: <strong class="mono" style="color:${over?'var(--red)':'var(--emerald)'}">${COP.format(Math.abs(remaining))}</strong></span>
          <span>Límite: <strong class="mono">${COP.format(b.plan)}</strong></span>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// BUDGET TEMPLATE EDITOR
// ═══════════════════════════════════════════════════════
function renderBudgetTemplateEditor(budget) {
  const el = $('budgetEditor');
  if (!el) return;
  const cats = (_data?.combos?.categorias || []).filter(c => !c.includes('↔'));
  const items = budget?.items || [];
  const rows = budget?.rows || [];
  const itemsMap = {};
  items.forEach(i => { itemsMap[i.cat] = i; });
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.id = 'budgetFormWrap';
  wrap.style.cssText = 'padding-top:8px;border-top:1px solid var(--border)';
  wrap.innerHTML = '<div style="font-weight:700;margin-bottom:2px">Presupuesto base (permanente)</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Se aplica a todos los meses. Para gastos puntuales usa "Eventualidad del mes" abajo.</div><div id="budgetFormFields" style="display:grid;gap:10px"></div><button class="btn btn-primary" style="width:100%;justify-content:center;padding:12px;margin-top:12px" onclick="saveBudgetsNew()"><i class="fas fa-check"></i> Guardar presupuesto base</button>';
  el.appendChild(wrap);
  const fieldsEl = wrap.querySelector('#budgetFormFields');
  cats.forEach(cat => {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;display:grid;grid-template-columns:minmax(120px,1fr) 120px 90px;align-items:center;gap:12px';
    const current = itemsMap[cat] || {};
    const historic = rows.find(r => r.cat === cat) || {};
    const val = current.plan || historic.plan || 0;
    const alertVal = current.alerta || historic.alerta || 80;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.dataset.cat = cat; inp.value = val;
    inp.className = 'form-input budgetInput mono';
    inp.style.cssText = 'text-align:right';
    inp.placeholder = '0'; inp.step = '1000'; inp.min = '0';
    const alert = document.createElement('input');
    alert.type = 'number'; alert.dataset.cat = cat; alert.value = alertVal;
    alert.className = 'form-input budgetAlert mono';
    alert.style.cssText = 'text-align:right';
    alert.placeholder = '80'; alert.step = '1'; alert.min = '1'; alert.max = '100';
    const lbl = document.createElement('span');
    lbl.innerHTML = `<div style="font-size:13.5px;font-weight:500">${esc(cat)}</div><div style="font-size:11px;color:var(--text-muted)">Real: ${COP.format(current.spent || 0)}</div>`;
    card.appendChild(lbl); card.appendChild(inp); card.appendChild(alert);
    fieldsEl.appendChild(card);
  });
}

function saveBudgetsNew() {
  const inputs = document.querySelectorAll('.budgetInput');
  const alerts = Array.from(document.querySelectorAll('.budgetAlert'));
  const month = $('filtroMes')?.value || new Date().toISOString().slice(0, 7);
  const items = [];
  inputs.forEach(inp => {
    let cat = inp.dataset.cat;
    const mont = parseFloat(inp.value) || 0;
    const alert = alerts.find(a => a.dataset.cat === cat);
    const alertVal = parseFloat(alert?.value) || 80;
    if (cat && mont > 0) {
      cat = cat.replace(/^[^\w\s]+\s*/, '').trim();
      items.push({ categoria: cat, limite: mont, alerta: alertVal, periodo: 'monthly' });
    }
  });
  if (!items.length) { toast('Destina al menos una categoria', 'error'); return; }
  google.script.run
    .withSuccessHandler(() => { toast('Presupuestos guardados. Ver avance en Dashboard', 'success'); refreshSection(); })
    .withFailureHandler(e => toast('Error: ' + (e.message || e), 'error'))
    .guardarPresupuestosLote(items);
}

function saveEventualidad() {
  const cat = $('eventCat')?.value;
  const limite = parseFloat($('eventLimite')?.value) || 0;
  const month = $('filtroMes')?.value || new Date().toISOString().slice(0, 7);
  if (!cat) { toast('Selecciona una categoría', 'error'); return; }
  if (limite <= 0) { toast('Ingresa un límite mayor a 0', 'error'); return; }
  google.script.run
    .withSuccessHandler(() => {
      toast(`Eventualidad "${cat}" guardada para ${month}`, 'success');
      if ($('eventLimite')) $('eventLimite').value = '';
      refreshSection();
    })
    .withFailureHandler(e => toast('Error: ' + (e.message || e), 'error'))
    .guardarPresupuestosLote([{ categoria: cat, limite, alerta: 80, periodo: month }]);
}

function loadEmailLogs() {
  const el = $('emailsList');
  if (el) el.innerHTML = '<div class="empty-state"><div class="loader-ring" style="width:28px;height:28px;border-width:2px"></div></div>';

  google.script.run
    .withSuccessHandler(logs => { _emailLogs = logs; renderEmails(); })
    .withFailureHandler(e  => toast('Error cargando emails: ' + e.message, 'error'))
    .getEmailLogs();
}

function filterEmails(status) {
  _emailFilter = status;
  ['All','Pend','Approved','Auto'].forEach(s => {
    const btn = $('emailFilter' + s);
    if (btn) btn.style.borderColor = '';
  });
  renderEmails();
}

function renderEmails() {
  const el = $('emailsList');
  if (!el) return;

  const filtered = _emailFilter === 'all'
    ? _emailLogs
    : _emailLogs.filter(e => e.status === _emailFilter);

  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No hay emails en esta categoría</p></div>';
    return;
  }

  el.innerHTML = filtered.map(e => {
    const statusBadge = {
      pendiente:      '<span class="badge badge-gold"><i class="fas fa-clock"></i> Pendiente</span>',
      auto_aprobado:  '<span class="badge badge-green"><i class="fas fa-robot"></i> Auto-aprobado</span>',
      aprobado:       '<span class="badge badge-green"><i class="fas fa-check"></i> Aprobado</span>',
      error:          '<span class="badge badge-red"><i class="fas fa-xmark"></i> Error</span>'
    }[e.status] || '<span class="badge badge-gray">—</span>';

    const confBar = e.confidence > 0 ? `
      <div class="conf-bar">
        <div style="width:60px;height:3px;background:var(--surface3);border-radius:99px;overflow:hidden">
          <div style="width:${(e.confidence*100).toFixed(0)}%;height:100%;background:${e.confidence>=0.88?'var(--emerald)':e.confidence>=0.6?'var(--gold)':'var(--red)'};border-radius:99px"></div>
        </div>
        <span style="font-size:11px;color:var(--text-muted)">${(e.confidence*100).toFixed(0)}%</span>
      </div>
    ` : '';

    const pending = e.status === 'pendiente' || e.status === 'pending';
    const approveBtn = pending ? `
      <button class="btn btn-success btn-sm" onclick="acceptEmailDirect(this,'${esc(e.id)}')">
        <i class="fas fa-zap"></i> Confirmar
      </button>
    ` : '';

    const editBtn = `
      <button class="btn btn-ghost btn-sm" onclick="openEmailEditModal('${esc(e.id)}')">
        <i class="fas fa-pen"></i> Editar
      </button>
    `;

    const deleteBtn = `
      <button class="btn btn-danger btn-sm" onclick="deleteEmail('${esc(e.id)}')">
        <i class="fas fa-trash"></i> Ocultar
      </button>
    `;

    const approveFullBtn = '';

    return `
      <div class="email-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1">
            <div class="email-subject">${esc(e.merchant || e.subject)}</div>
            <div class="email-meta">
              <span>${esc(e.from)}</span>
              <span>${esc(e.date)}</span>
              ${e.amount > 0 ? `<span class="email-amount">${COP.format(e.amount)}</span>` : ''}
              ${e.type ? `<span><i class="fas fa-shapes" style="font-size:9px"></i> ${esc(typeLabel(e.type))}</span>` : ''}
              ${e.category ? `<span><i class="fas fa-tag" style="font-size:9px"></i> ${esc(e.category)}</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${esc(e.snippet)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            ${statusBadge}
            ${confBar}
          </div>
        </div>
        <div class="email-actions">${approveBtn}${approveFullBtn}${editBtn}${deleteBtn}</div>
        ${e.notes ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)"><i class="fas fa-brain" style="font-size:10px"></i> ${esc(e.notes)}</div>` : ''}
        ${e.obs ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)"><i class="fas fa-note-sticky" style="font-size:10px"></i> ${esc(e.obs)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function buildBudgetTemplateText(items) {
  const rows = (items || []).length
    ? items.map(i => `${i.cat},${Math.round(i.plan || 0)},${Math.round(i.pct || 80)}`)
    : [
        'Alimentos,600000,85',
        'Transporte,300000,80',
        'Servicios,250000,80',
        'Salud,200000,85',
        'Entretenimiento,150000,80'
      ];
  return rows.join('\n');
}

function applyBudgetTemplate() {
  const raw = $('budgetTemplateInput')?.value || '';
  const items = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [categoria, limite, alerta] = line.split(',').map(v => String(v || '').trim());
    return { categoria, limite: Number(limite || 0), alerta: Number(alerta || 80) };
  }).filter(x => x.categoria && x.limite > 0);
  if (!items.length) { toast('Escribe al menos una fila válida de presupuesto', 'error'); return; }
  google.script.run
    .withSuccessHandler(() => { toast('Presupuestos guardados', 'success'); refreshSection(); })
    .withFailureHandler(e => toast('Error guardando presupuestos: ' + (e.message || e), 'error'))
    .guardarPresupuestosLote(items);
}

function recargarDatos() {
  const btn = $('refreshBtn');
  if (btn) { btn.disabled = true; btn.querySelector('i').className = 'fas fa-spinner fa-spin'; }
  toast('Recargando datos completos...', 'info');
  // Forzar cache miss para obtener datos frescos del servidor
  CacheService && CacheService.removeAll && CacheService.removeAll();
  const mesVal = $('filtroMes').value;
  $('loader').classList.remove('hidden');
  google.script.run
    .withSuccessHandler(d => {
      $('loader').classList.add('hidden');
      renderAll(d);
      if (btn) { btn.disabled = false; btn.querySelector('i').className = 'fas fa-rotate-right'; }
      toast('Datos actualizados', 'success');
    })
    .withFailureHandler(e => {
      $('loader').classList.add('hidden');
      if (btn) { btn.disabled = false; btn.querySelector('i').className = 'fas fa-rotate-right'; }
      toast('Error: ' + e.message, 'error');
    })
    .clearAndGetDataAPI(mesVal);
}

function syncEmails() {
  toast('Sincronizando Gmail...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      if (r.ok) {
        toast(`✓ ${r.added} emails nuevos · ${r.skipped} omitidos`, 'success');
        loadEmailLogs();
        refreshSection();
      } else {
        toast('Error: ' + r.error, 'error');
      }
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .syncGmailLabel('gastos');
}

function loadFromLibrary() {
  // Reservado para uso futuro
  toast('Función no implementada', 'info');
}

function deleteFromLibrary() {
  toast('Función no implementada', 'info');
}

// ═══════════════════════════════════════════════════════
// MODAL TRANSACCIÓN
// ═══════════════════════════════════════════════════════
function openModal() {
  $('txnDate').value = new Date().toISOString().slice(0,10);
  $('modalOverlay').classList.add('open');
}

function closeModal() {
  $('modalOverlay').classList.remove('open');
  $('txnForm').reset();
  $('txnDate').value = new Date().toISOString().slice(0,10);
  $('txnLogId').value = '';
  $('txnInvestment').value = 'false';
  $('assetGroup').style.display = 'none';
  selectTypeByValue('Egreso');
}

// Click fuera del modal lo cierra
[
  ['modalOverlay',   () => closeModal()],
  ['emailEditModal', () => closeEmailEditModal()],
  ['editTxnModal',   () => closeEditTxnModal()],
  ['editInvModal',   () => closeEditInvModal()],
  ['newInvModal',    () => closeNewInvModal()],
].forEach(([id, fn]) => {
  const el = $(id);
  if (el) el.addEventListener('click', e => { if (e.target === el) fn(); });
});
function selectType(tab) {
  document.querySelectorAll('.type-tab').forEach(t => t.className = 'type-tab');
  const t = tab.dataset.type;
  const isInvestment = t === 'Inversión';
  const activeClass = isInvestment ? 'transfer' : t === 'Egreso' ? 'expense' : t === 'Ingreso' ? 'income' : 'transfer';
  tab.className = `type-tab active-${activeClass}`;
  $('txnType').value = isInvestment ? 'Transferencia' : t;
  $('txnInvestment').value = isInvestment ? 'true' : 'false';
  $('destGroup').style.display = 'Transferencia' === $('txnType').value ? '' : 'none';
  $('assetGroup').style.display = isInvestment ? '' : 'none';
  $('lblCuenta').textContent = $('txnType').value === 'Transferencia' ? 'Cuenta origen' : 'Cuenta';
  if (isInvestment) {
    const option = Array.from($('selCat').options).find(o => o.value.toLowerCase().includes('inversion'));
    if (option) $('selCat').value = option.value;
  }
}

function selectTypeByValue(val) {
  const tab = document.querySelector(`.type-tab[data-type="${val}"]`);
  if (tab) selectType(tab);
}

function submitTxn(e) {
  e.preventDefault();
  const btn = $('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  const fd = Object.fromEntries(new FormData(e.target));
  fd.tipo = $('txnType').value;
  if (fd.inversion === 'true') {
    fd.activoInversion = String(fd.activoInversion || '').trim();
  }

  const logId = fd.logId;
  delete fd.logId;

  google.script.run
    .withSuccessHandler(r => {
      closeModal();
      toast('¡Transacción guardada!', 'success');
      if (logId) {
        // Mark email as approved
        google.script.run
          .withSuccessHandler(() => {
            loadEmailLogs();
          })
          .aprobarEmail(logId, fd.categoria, fd.cuenta);
      }
      refreshSection();
    })
    .withFailureHandler(err => {
      toast(err.message || 'Error guardando', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Guardar transacción';
    })
    .guardarTransaccion(fd);
}

// ═══════════════════════════════════════════════════════
// APROBAR EMAIL RÁPIDO (1 click directo)
// ═══════════════════════════════════════════════════════
function acceptEmailDirect(btn, logId) {
  const e = _emailLogs.find(x => String(x.id) === String(logId));
  if (!e) { toast('Email no encontrado', 'error'); return; }

  btn = btn?.closest('button') || btn;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aceptando...';

  toast('Registrando transacción automáticamente...', 'info');
  google.script.run
    .withSuccessHandler(result => {
      if (result.ok) {
        toast(`✓ Transacción creada: ${result.merchant} · ${COP.format(result.amount)}`, 'success');
        loadEmailLogs();
        refreshSection();
      } else {
        toast('Error: ' + (result.error || 'Unknown'), 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-zap"></i> Aceptar Rápido';
      }
    })
    .withFailureHandler(err => {
      toast('Error: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-zap"></i> Aceptar Rápido';
    })
    .acceptEmailQuick(logId);
}

// ═══════════════════════════════════════════════════════
// MODAL APROBAR EMAIL
// ═══════════════════════════════════════════════════════
function openApproveModal(logId, merchant, amount, currency) {
  const e = _emailLogs.find(x => String(x.id) === String(logId));
  if (!e) { toast('No se encontró el correo', 'error'); return; }

  // Pre-fill the main transaction modal
  $('txnType').value = 'Egreso';
  selectTypeByValue('Egreso');
  $('txnDate').value = e.date ? new Date(e.date).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  $('txnForm').querySelector('[name="descripcion"]').value = merchant || e.subject || '';
  $('txnForm').querySelector('[name="monto"]').value = amount || '';
  if (e.category) $('selCat').value = e.category;
  const defaultAccount = _data?.combos?.cuentas?.find(c => c.includes('Bancolombia')) || _data?.combos?.cuentas?.[0] || '';
  if (defaultAccount) $('selCuenta').value = defaultAccount;
  $('txnLogId').value = e.id;

  $('modalOverlay').classList.add('open');
}

function closeApproveModal() {
  closeModal(); // openApproveModal reutiliza el modal principal
}

function confirmApprove() {
  // Aprobación completa — se gestiona desde submitTxn con txnLogId
  closeModal();
}

// ═══════════════════════════════════════════════════════
// ELIMINAR TRANSACCIÓN
// ═══════════════════════════════════════════════════════
function deleteEmail(logId) {
  if (!confirm('¿Ocultar este correo de la bandeja?')) return;
  google.script.run
    .withSuccessHandler(() => {
      toast('Correo oculto', 'success');
      loadEmailLogs();
    })
    .withFailureHandler(e => toast('Error ocultando: ' + e.message, 'error'))
    .eliminarCorreoGasto(logId);
}

// ═══════════════════════════════════════════════════════
// PRESUPUESTO — Cargar Plantilla
// ═══════════════════════════════════════════════════════
function loadBudgetTemplate() {
  const input = $('budgetTemplateInput');
  if (!input) {
    toast('Abre la sección de presupuesto para editar la plantilla', 'info');
    navTo('presupuesto', null);
    return;
  }
  applyBudgetTemplate();
}

// ═══════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════
function exportCSV() {
  const mes = $('filtroMes').value;
  toast('Preparando CSV...', 'info');
  google.script.run
    .withSuccessHandler(csv => {
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `FinanzasAI_${mes}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast('CSV descargado', 'success');
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .exportCSV(mes);
}

// ═══════════════════════════════════════════════════════
// TOAST SYSTEM
// ═══════════════════════════════════════════════════════
function openEmailEditModal(logId) {
  const e = _emailLogs.find(x => String(x.id) === String(logId));
  if (!e) { toast('No se encontró el correo', 'error'); return; }
  
  const modal = document.getElementById('emailEditModal');
  document.getElementById('emailEditLogId').value = logId;
  document.getElementById('emailEditTitle').textContent = e.subject || 'Sin asunto';
  document.getElementById('emailEditFrom').textContent = e.from || 'Desconocido';
  document.getElementById('emailEditDate').textContent = e.date || '-';
  
  const catSel = document.getElementById('emailEditCat');
  catSel.value = e.category || 'Otros';
  document.getElementById('emailEditType').value = e.type || 'expense';
  document.getElementById('emailEditObs').value = e.obs || '';
  document.getElementById('emailEditNotes').value = e.notes || '';
  document.getElementById('emailEditBody').value = e.body || e.snippet || '';
  document.getElementById('emailEditAmount').value = e.amount || 0;
  document.getElementById('emailEditMerchant').value = e.merchant || e.subject || '';
  const accSel = document.getElementById('emailEditAccount');
  if (accSel) accSel.value = e.account || _data?.combos?.cuentas?.[0] || '';
  
  modal.classList.add('open');
}

function closeEmailEditModal() {
  document.getElementById('emailEditModal').classList.remove('open');
}

function saveEmailEdits() {
  const logId = document.getElementById('emailEditLogId').value;
  const amount = parseFloat(document.getElementById('emailEditAmount').value) || 0;
  const merchant = document.getElementById('emailEditMerchant').value;
  const category = document.getElementById('emailEditCat').value;
  const type = document.getElementById('emailEditType').value;
  const account = document.getElementById('emailEditAccount')?.value || '';
  const obs = document.getElementById('emailEditObs').value;
  const notes = document.getElementById('emailEditNotes').value;
  
  if (!merchant || !category) { toast('Completa monto, comercio y categoría', 'error'); return; }
  
  google.script.run
    .withSuccessHandler(() => {
      toast('Correo y movimiento actualizados', 'success');
      closeEmailEditModal();
      loadEmailLogs();
      refreshSection();
    })
    .withFailureHandler(err => toast('Error guardando: ' + (err.message || err), 'error'))
    .guardarCorreoEditado(logId, {
      monto: amount,
      comercio: merchant,
      categoria_usuario: category,
      tipo_ia: type,
      cuenta_sugerida: account,
      observacion: obs,
      notas_ia: notes,
      sincronizar_movimiento: true
    });
}

function openEditTxnModal(txnId) {
  const t = (_data?.historial || []).find(x => String(x.id) === String(txnId));
  if (!t) { toast('Movimiento no encontrado', 'error'); return; }
  
  const modal = document.getElementById('editTxnModal');
  document.getElementById('editTxnId').value = txnId;
  document.getElementById('editTxnFecha').value = toIsoDate(t.fecha);
  document.getElementById('editTxnDesc').value = t.desc || '';
  document.getElementById('editTxnCat').value = t.cat || 'Otros';
  document.getElementById('editTxnMonto').value = t.monto || 0;
  document.getElementById('editTxnCuenta').value = t.cuenta || '';
  document.getElementById('editTxnNotas').value = t.notas || '';
  
  modal.classList.add('open');
}

function closeEditTxnModal() {
  document.getElementById('editTxnModal').classList.remove('open');
}

function saveTxnEdits() {
  const txnId = document.getElementById('editTxnId').value;
  const fecha = document.getElementById('editTxnFecha').value;
  const desc = document.getElementById('editTxnDesc').value;
  const cat = document.getElementById('editTxnCat').value;
  const monto = parseFloat(document.getElementById('editTxnMonto').value) || 0;
  const cuenta = document.getElementById('editTxnCuenta').value;
  const notas = document.getElementById('editTxnNotas').value;
  
  if (!fecha || !desc || !cat || monto <= 0) { toast('Completa fecha, descripción, categoría y monto', 'error'); return; }
  
  google.script.run
    .withSuccessHandler(() => {
      toast('Movimiento actualizado', 'success');
      closeEditTxnModal();
      refreshSection();
    })
    .withFailureHandler(err => toast('Error actualizando: ' + (err.message || err), 'error'))
    .editarMovimiento(txnId, { fecha, descripcion: desc, categoria: cat, monto, cuenta, notas });
}

function openNewInvModal() {
  $('newInvForm').reset();
  $('newInvFecha').value = new Date().toISOString().slice(0, 10);
  $('newInvCuenta').value = 'Nu';
  $('newInvOperacion').value = 'Compra';
  $('newInvMonedaCompra').value = 'USD';
  $('newInvFuentePrecio').value = 'GOOGLEFINANCE';
  toggleNewInvPrecioManual();
  $('newInvModal').classList.add('open');
}

function closeNewInvModal() {
  $('newInvModal').classList.remove('open');
  $('newInvForm').reset();
}

function toggleNewInvPrecioManual() {
  const fuente = $('newInvFuentePrecio')?.value;
  const precioGroup = $('newInvPrecioActualGroup');
  if (precioGroup) {
    precioGroup.style.display = fuente === 'MANUAL' ? '' : 'none';
  }
}

function submitNewInv(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  const form = {
    fecha_compra: String($('newInvFecha').value || new Date().toISOString().slice(0, 10)),
    cuenta: String($('newInvCuenta').value || 'Nu'),
    broker: String($('newInvBroker').value || '').trim(),
    operacion: String($('newInvOperacion').value || 'Compra'),
    ticker: String($('newInvTicker').value || '').trim().toUpperCase(),
    activo: String($('newInvActivo').value || '').trim(),
    cantidad: parseFloat($('newInvCantidad').value) || 0,
    precio_compra: parseFloat($('newInvPrecioCompra').value) || 0,
    moneda_compra: String($('newInvMonedaCompra').value || 'USD'),
    trm_compra: parseFloat($('newInvTrmCompra').value) || 0,
    fuente_precio: String($('newInvFuentePrecio').value || 'MANUAL'),
    precio_actual: parseFloat($('newInvPrecioActual').value) || 0,
    notas: String($('newInvNotas').value || '').trim()
  };

  if (!form.activo) {
    toast('El nombre del activo es requerido', 'error');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    return;
  }

  if (!form.cantidad || form.cantidad <= 0) {
    toast('La cantidad debe ser mayor a 0', 'error');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    return;
  }

  if (!form.precio_compra || form.precio_compra <= 0) {
    toast('El precio de compra es requerido', 'error');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    return;
  }

  google.script.run
    .withSuccessHandler(r => {
      closeNewInvModal();
      toast('✅ Inversión agregada al portafolio', 'success');
      refreshSection();
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    })
    .withFailureHandler(err => {
      toast('Error: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    })
    .guardarInversionEs(form);
}

// ═══════════════════════════════════════════════════════
// EDITAR INVERSIÓN
// ═══════════════════════════════════════════════════════
function openEditInvModal(invId) {
  const item = (_data?.inversiones || []).find(x => String(x.inversion_id || x.id) === String(invId));
  if (!item) { toast('Inversión no encontrada', 'error'); return; }
  
  const modal = document.getElementById('editInvModal');
  document.getElementById('editInvId').value = item.inversion_id || invId;
  document.getElementById('editInvActivo').value = item.activo || '';
  document.getElementById('editInvSimbolo').value = item.ticker || '';
  document.getElementById('editInvTipo').value = item.operacion || 'Compra';
  document.getElementById('editInvBroker').value = item.broker || '';
  document.getElementById('editInvCantidad').value = item.cantidad || 0;
  document.getElementById('editInvCostoProm').value = item.precio_compra || 0;
  document.getElementById('editInvPrecio').value = item.precio_actual || 0;
  document.getElementById('editInvNotas').value = item.notas || '';
  
  modal.classList.add('open');
}

function closeEditInvModal() {
  document.getElementById('editInvModal').classList.remove('open');
}

function saveInvEdits() {
  const invId = document.getElementById('editInvId').value;
  const activo = document.getElementById('editInvActivo').value;
  const simbolo = document.getElementById('editInvSimbolo').value;
  const tipo = document.getElementById('editInvTipo').value;
  const broker = document.getElementById('editInvBroker').value;
  const cantidad = parseFloat(document.getElementById('editInvCantidad').value) || 0;
  const costo_promedio = parseFloat(document.getElementById('editInvCostoProm').value) || 0;
  const precio_actual = parseFloat(document.getElementById('editInvPrecio').value) || 0;
  const notas = document.getElementById('editInvNotas').value;
  
  if (!activo || cantidad <= 0) { toast('Completa activo y cantidad', 'error'); return; }

  google.script.run
    .withSuccessHandler(() => {
      toast('Inversión actualizada', 'success');
      closeEditInvModal();
      refreshSection();
    })
    .withFailureHandler(err => toast('Error actualizando inversión: ' + (err.message || err), 'error'))
    .guardarInversionEs({
      inversion_id: invId,
      activo,
      ticker: simbolo,
      operacion: tipo,
      broker,
      cantidad,
      precio_compra: costo_promedio,
      precio_actual,
      notas
    });
}

function editTxn(txnId) { openEditTxnModal(txnId); }
function editInvestment(invId) { openEditInvModal(invId); }

function deleteInvestment(invId) {
  if (!confirm('¿Eliminar esta inversión?')) return;
  google.script.run
    .withSuccessHandler(() => { toast('Inversión eliminada', 'success'); refreshSection(); })
    .withFailureHandler(err => toast('Error eliminando inversión: ' + (err.message || err), 'error'))
    .eliminarInversionEs(invId);
}

function txnRow(t, withDelete) {
  const isIncome     = t.type === 'income';
  const isTransfer   = t.type === 'transfer';
  const isInvestment = t.type === 'investment';
  const color = isIncome ? 'var(--emerald)' : isTransfer ? 'var(--blue)' : isInvestment ? '#8b5cf6' : 'var(--red)';
  const sign  = isIncome ? '+' : isTransfer ? '↔' : isInvestment ? '↗' : '-';
  const badgeClass = isIncome ? 'green' : isTransfer ? 'blue' : isInvestment ? 'blue' : 'gray';
  const sourceHtml = t.source === 'gmail'
    ? `<span class="badge badge-blue"><i class="fas fa-envelope" style="font-size:9px"></i> Gmail</span>`
    : `<span class="badge badge-gray">${esc(t.source || 'manual')}</span>`;
  const actions = withDelete
    ? `<div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-ghost btn-sm btn-icon" onclick="editTxn('${esc(t.id)}')" title="Editar"><i class="fas fa-pen" style="font-size:11px"></i></button><button class="btn btn-danger btn-sm btn-icon" onclick="deleteTxn('${esc(t.id)}')" title="Eliminar"><i class="fas fa-trash" style="font-size:11px"></i></button></div>`
    : '';
  return `<tr>
    <td class="mono" style="font-size:12px;color:var(--text-muted)">${esc(t.fecha)}</td>
    <td style="max-width:240px;font-weight:500">${esc(t.desc || t.cat)}<div style="margin-top:4px"><span class="badge badge-${badgeClass}">${esc(typeLabel(t.type))}</span></div></td>
    <td><span class="badge badge-gray">${esc(t.cat)}</span><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${esc(t.moneda || 'COP')}</div></td>
    <td class="mono" style="text-align:right;color:${color};font-weight:600">${sign}${COP.format(Math.abs(t.monto || 0))}</td>
    <td style="color:var(--text-muted);font-size:12px">${esc(t.cuenta || '')}${t.cuentaDestino ? `<div style="margin-top:4px">${esc(t.cuentaDestino)}</div>` : ''}</td>
    <td>${sourceHtml}${t.notas ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${esc(t.notas)}</div>` : ''}</td>
    ${withDelete ? `<td>${actions}</td>` : ''}
  </tr>`;
}

// Global state for investments
let _invData = [];
let _invSortCol = 'vr_mercado_actual_base';
let _invSortDir = 'desc';

function renderInversiones(invs, invPorTipo, invPorBroker) {
  _invData = invs || [];
  updateInvStats(invs);
  updateInvPerformance(invs);
  updateInvChartsStats(invPorTipo, invPorBroker);
  renderInvAllocBars(invs);
  renderInvRiskPanel(invs);
  renderInvTable(_invData);
  setTimeout(() => renderInvChart2026(invs, invPorTipo, invPorBroker), 100);
}

function renderInvAllocBars(invs) {
  const el = $('invAllocBars');
  if (!el) return;
  if (!invs || !invs.length) { el.innerHTML = '<div class="empty-state"><p>Sin posiciones</p></div>'; return; }
  const total = invs.reduce((s, i) => s + (i.vr_mercado_actual_base || 0), 0);
  const sorted = [...invs].sort((a, b) => (b.vr_mercado_actual_base || 0) - (a.vr_mercado_actual_base || 0));
  el.innerHTML = sorted.map((inv, i) => {
    const val  = inv.vr_mercado_actual_base || 0;
    const pct  = total > 0 ? (val / total * 100) : 0;
    const pygPct = inv.pyg_pct || 0;
    const col  = PALETTE[i % PALETTE.length];
    const pygCol = pygPct >= 0 ? 'var(--emerald)' : 'var(--red)';
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px">
        <span style="font-weight:600;display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></span>
          ${esc(inv.activo)}
          <span style="font-size:10px;color:var(--text-muted);font-weight:400">${esc(inv.broker||'')}</span>
        </span>
        <span style="display:flex;gap:10px;align-items:center">
          <span class="mono" style="font-size:11px;color:${pygCol};font-weight:700">${pygPct >= 0 ? '+' : ''}${pygPct.toFixed(1)}%</span>
          <span class="mono" style="font-size:11px;color:var(--text-muted)">${COP.format(val)}</span>
          <span style="font-size:11px;font-weight:700;min-width:36px;text-align:right">${pct.toFixed(1)}%</span>
        </span>
      </div>
      <div style="height:6px;background:var(--surface2);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${col};border-radius:99px;transition:width .5s"></div>
      </div>
    </div>`;
  }).join('');
}

function renderInvRiskPanel(invs) {
  const el = $('invRiskPanel');
  if (!el) return;
  if (!invs || !invs.length) { el.innerHTML = ''; return; }

  const total = invs.reduce((s, i) => s + (i.vr_mercado_actual_base || 0), 0);
  const weights = invs.map(i => total > 0 ? (i.vr_mercado_actual_base || 0) / total : 0);

  // Herfindahl-Hirschman Index (0 = diversified, 1 = concentrated)
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const diversScore = Math.round((1 - hhi) * 100);
  const topWeight = Math.max(...weights) * 100;
  const top3Weight = [...weights].sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0) * 100;

  const scoreCol = diversScore >= 70 ? 'var(--emerald)' : diversScore >= 40 ? 'var(--gold)' : 'var(--red)';
  const scoreLabel = diversScore >= 70 ? 'Bien diversificado' : diversScore >= 40 ? 'Moderado' : 'Concentrado';

  // Concentration warning
  const warn = topWeight > 50 ? `⚠ ${invs.find(i => (i.vr_mercado_actual_base||0)/total === Math.max(...weights))?.activo || ''} representa ${topWeight.toFixed(0)}% del portafolio` : '';

  const metric = (label, value, color, sub) =>
    `<div style="padding:10px 12px;background:var(--surface2);border-radius:var(--radius-sm)">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${label}</div>
      <div class="mono" style="font-size:16px;font-weight:700;color:${color||'var(--text)'}">${value}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${sub}</div>` : ''}
    </div>`;

  el.innerHTML =
    metric('Score diversificación', diversScore + '/100', scoreCol, scoreLabel) +
    metric('Posición más grande', topWeight.toFixed(1) + '%', topWeight > 50 ? 'var(--red)' : 'var(--gold)', 'del portafolio') +
    metric('Top 3 posiciones', top3Weight.toFixed(1) + '%', top3Weight > 70 ? 'var(--gold)' : 'var(--emerald)', 'concentración') +
    metric('Posiciones activas', invs.length, 'var(--blue)', invs.length < 5 ? 'Poca diversificación' : 'Diversificado') +
    (warn ? `<div style="padding:10px 12px;background:rgba(255,77,109,.08);border:1px solid rgba(255,77,109,.2);border-radius:var(--radius-sm);font-size:11px;color:var(--red)">${warn}</div>` : '');
}

function updateInvStats(invs) {
  if (!invs || !invs.length) {
    setText('invTotal', '$0');
    setText('invPositions', '0');
    setText('invTotalPnL', '$0');
    setText('invPnLPercent', '<span class="inv-pnl-pct">—</span>');
    setText('invBestReturn', '—');
    setText('invWinRate', '—');
    setText('invWinRateDetail', '');
    return;
  }
  
  const totalValor = invs.reduce((s, i) => s + (i.vr_mercado_actual_base || 0), 0);
  const totalPnL = invs.reduce((s, i) => s + (i.pyg_base || 0), 0);
  const totalCost = invs.reduce((s, i) => s + (i.vr_mercado_compra || 0), 0);
  const avgPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  
  // Win rate
  const winners = invs.filter(i => (i.pyg_base || 0) > 0).length;
  const losers = invs.filter(i => (i.pyg_base || 0) < 0).length;
  const total = winners + losers;
  const winRate = total > 0 ? (winners / total * 100).toFixed(0) : 0;
  
  // Best performer
  const best = [...invs].sort((a, b) => (b.pyg_pct || 0) - (a.pyg_pct || 0))[0];
  const bestPct = best?.pyg_pct || 0;
  
  setText('invTotal', COP.format(totalValor));
  setText('invPositions', invs.length);
  setText('invTotalPnL', (totalPnL >= 0 ? '+' : '') + COP.format(totalPnL));
  setText('invPnLPercent', `<span class="inv-pnl-pct" style="background:${totalPnL >= 0 ? 'rgba(0,212,170,0.12)' : 'rgba(255,77,109,0.12)'};color:${totalPnL >= 0 ? 'var(--emerald)' : 'var(--red)'}">${avgPct >= 0 ? '+' : ''}${avgPct.toFixed(2)}%</span>`);
  setText('invBestReturn', best ? `${esc(best.activo)} ${bestPct >= 0 ? '+' : ''}${bestPct.toFixed(2)}%` : '—');
  setText('invWinRate', `${winRate}%`);
  setText('invWinRateDetail', `${winners} ganadoras / ${losers} perdedoras`);
}

function updateInvPerformance(invs) {
  if (!invs || !invs.length) {
    setText('invPerfTotal', '$0');
    setText('invPerfCost', '$0');
    setText('invPerfPnL', '$0');
    setText('invPerfPct', '0%');
    return;
  }
  
  const totalValor = invs.reduce((s, i) => s + (i.vr_mercado_actual_base || 0), 0);
  const totalCost = invs.reduce((s, i) => s + (i.vr_mercado_compra || 0), 0);
  const totalPnL = totalValor - totalCost;
  const pct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  
  setText('invPerfTotal', COP.format(totalValor));
  setText('invPerfCost', COP.format(totalCost));
  setText('invPerfPnL', (totalPnL >= 0 ? '+' : '') + COP.format(totalPnL));
  setText('invPerfPct', (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%');
}

function updateInvChartsStats(invPorTipo, invPorBroker) {
  // Tipo legend
  const tipoLegend = $('invTipoLegend');
  if (tipoLegend && invPorTipo?.length) {
    tipoLegend.innerHTML = invPorTipo.slice(0, 4).map((t, i) => `
      <span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">
        <span style="width:8px;height:8px;border-radius:50%;background:${PALETTE[i]}"></span>
        ${esc(t.tipo)} (${COP.format(t.valor)})
      </span>
    `).join('');
  }
  
  // Broker legend
  const brokerLegend = $('invBrokerLegend');
  if (brokerLegend && invPorBroker?.length) {
    brokerLegend.innerHTML = invPorBroker.slice(0, 4).map((b, i) => `
      <span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">
        <span style="width:8px;height:8px;border-radius:50%;background:${PALETTE[i]}"></span>
        ${esc(b.broker)} (${COP.format(b.valor)})
      </span>
    `).join('');
  }
}

function renderInvTable(invs) {
  const el = $('invTableBody');
  if (!el) return;
  
  // Apply filters
  const search = ($('invSearch')?.value || '').toLowerCase();
  const filterTipo = ($('invFilterTipo')?.value || '').toLowerCase();
  
  let filtered = invs.filter(i => {
    if (search && !`${i.activo} ${i.ticker} ${i.broker} ${i.cuenta}`.toLowerCase().includes(search)) return false;
    if (filterTipo && !`${i.operacion}`.toLowerCase().includes(filterTipo)) return false;
    return true;
  });
  
  // Sort
  filtered.sort((a, b) => {
    let aVal = a[_invSortCol] || 0;
    let bVal = b[_invSortCol] || 0;
    if (typeof aVal === 'string') {
      return _invSortDir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    }
    if (_invSortDir === 'desc') [aVal, bVal] = [bVal, aVal];
    return aVal - bVal;
  });
  
  // Calculate total for percentages
  const totalValor = invs.reduce((s, i) => s + (i.vr_mercado_actual_base || 0), 0);
  
  if (!filtered.length) {
    el.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:48px;color:var(--text-muted)"><i class="fas fa-chart-simple" style="font-size:32px;opacity:0.3;display:block;margin-bottom:12px"></i>Sin posiciones encontradas</td></tr>';
    setText('invPositionsCount', `0 posiciones`);
    setText('invTotalValue', `Total: $0`);
    return;
  }
  
  el.innerHTML = filtered.map(i => {
    const pygBase = i.pyg_base || 0;
    const pygPct = i.pyg_pct || 0;
    const vrActual = i.vr_mercado_actual_base || 0;
    const pctPortfolio = totalValor > 0 ? (vrActual / totalValor * 100) : 0;
    const tipoClass = getInvTipoClass(i);
    const fuenteAuto = (i.fuente_precio || '').toUpperCase() === 'GOOGLEFINANCE';
    
    return `<tr>
      <td>
        <div class="inv-asset-cell">
          <span class="inv-asset-name">${esc(i.activo)}</span>
          <span class="inv-asset-symbol">${esc(i.ticker || '—')}</span>
        </div>
      </td>
      <td><span class="inv-badge ${tipoClass}">${esc(i.operacion || 'Compra')}</span></td>
      <td style="color:var(--text-muted)">${esc(i.broker || '—')}</td>
      <td class="inv-mono">${Number(i.cantidad || 0).toLocaleString('es-CO', {maximumFractionDigits: 4})}</td>
      <td class="inv-mono">${COP.format(i.precio_compra || 0)}</td>
      <td class="inv-mono" style="color:var(--text-muted);cursor:pointer" title="Click para actualizar precio manualmente" onclick="openPrecioManualModal('${esc(i.inversion_id)}','${esc(i.activo)}')">${COP.format(i.precio_actual || 0)} <i class="fas fa-pen" style="font-size:9px;opacity:0.4"></i></td>
      <td class="inv-mono" style="font-weight:600">${COP.format(vrActual)}</td>
      <td>
        <div class="inv-pnl-cell">
          <span class="inv-pnl-amount ${pygBase >= 0 ? 'inv-pnl-positive' : 'inv-pnl-negative'}">${pygBase >= 0 ? '+' : ''}${COP.format(pygBase)}</span>
        </div>
      </td>
      <td>
        <div class="inv-pnl-cell">
          <span class="inv-pnl-pct ${pygPct >= 0 ? 'inv-pnl-pct-pos' : 'inv-pnl-pct-neg'}">${pygPct >= 0 ? '+' : ''}${pygPct.toFixed(2)}%</span>
        </div>
      </td>
      <td class="inv-mono" style="color:var(--text-muted)">${pctPortfolio.toFixed(1)}%</td>
      <td style="min-width:80px">
        <div title="${pctPortfolio.toFixed(1)}% del portafolio" style="height:6px;background:var(--surface2);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100,pctPortfolio).toFixed(1)}%;background:${pygBase>=0?'var(--emerald)':'var(--red)'};border-radius:99px;transition:width .4s"></div>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${fuenteAuto?'<i class="fas fa-sync" style="font-size:8px"></i> Auto':'<i class="fas fa-hand" style="font-size:8px"></i> Manual'} · ${esc(i.moneda_actual||'USD')}</div>
      </td>
      <td>
        <div class="inv-actions-cell">
          <button class="btn btn-ghost" onclick="openPrecioManualModal('${esc(i.inversion_id)}','${esc(i.activo)}')" title="Actualizar precio">
            <i class="fas fa-dollar-sign" style="font-size:11px"></i>
          </button>
          <button class="btn btn-ghost" onclick="showInvNews('${esc(i.ticker || i.activo)}')" title="Noticias">
            <i class="fas fa-newspaper" style="font-size:11px"></i>
          </button>
          <button class="btn btn-ghost" onclick="editInvestment('${esc(i.inversion_id || i.activo)}')" title="Editar">
            <i class="fas fa-pen" style="font-size:11px"></i>
          </button>
          <button class="btn btn-danger" onclick="deleteInvestment('${esc(i.inversion_id || i.activo)}')" title="Eliminar">
            <i class="fas fa-trash" style="font-size:11px"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
  
  setText('invPositionsCount', `${filtered.length} de ${invs.length} posiciones`);
  setText('invTotalValue', `Total: ${COP.format(totalValor)}`);
}

function getInvTipoClass(inv) {
  const ticker = (inv.ticker || '').toUpperCase();
  const activo = (inv.activo || '').toLowerCase();
  
  if (ticker.includes('ETF')) return 'inv-badge-etf';
  if (ticker.includes('NASDAQ') || ticker.includes('NYSE')) return 'inv-badge-accion';
  if (activo.includes('crypto') || activo.includes('btc') || activo.includes('bitcoin')) return 'inv-badge-cripto';
  if (activo.includes('bono')) return 'inv-badge-bono';
  if (inv.operacion === 'Venta') return 'inv-badge-bono';
  return 'inv-badge-fondo';
}

function getTipoBadgeClass(tipo) {
  const map = {
    'etf': 'inv-badge-etf',
    'accion': 'inv-badge-accion',
    'acción': 'inv-badge-accion',
    'cripto': 'inv-badge-cripto',
    'criptomoneda': 'inv-badge-cripto',
    'fondo': 'inv-badge-fondo',
    'bono': 'inv-badge-bono'
  };
  return map[tipo?.toLowerCase()] || 'inv-badge-otro';
}

function filterInvTable() {
  renderInvTable(_invData);
}

function sortInvTable(col) {
  if (_invSortCol === col) {
    _invSortDir = _invSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _invSortCol = col;
    _invSortDir = 'desc';
  }
  renderInvTable(_invData);
  
  // Update sort icons
  document.querySelectorAll('.inv-th-sortable i').forEach(icon => {
    icon.className = 'fas fa-sort';
  });
  const activeHeader = document.querySelector(`.inv-th-sortable[onclick*="${col}"] i`);
  if (activeHeader) {
    activeHeader.className = _invSortDir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
  }
}

// ─── Precio auto-mode ────────────────────────────────
let _precioAutoMode = true;

function loadPrecioMode() {
  google.script.run
    .withSuccessHandler(r => {
      _precioAutoMode = r.auto !== false;
      _updatePrecioModeUI();
    })
    .withFailureHandler(() => {})
    .getPrecioAutoMode();
}

function _updatePrecioModeUI() {
  const icon  = $('precioModeIcon');
  const label = $('precioModeLabel');
  const sub   = $('invActionPrecioSub');
  if (_precioAutoMode) {
    if (icon)  { icon.className = 'fas fa-rotate'; icon.style.color = 'var(--emerald)'; }
    if (label) label.textContent = 'Auto';
    if (sub)   sub.textContent = 'Auto · Yahoo Finance';
  } else {
    if (icon)  { icon.className = 'fas fa-hand-point-up'; icon.style.color = 'var(--gold)'; }
    if (label) label.textContent = 'Manual';
    if (sub)   sub.textContent = 'Manual';
  }
}

function togglePrecioMode() {
  _precioAutoMode = !_precioAutoMode;
  _updatePrecioModeUI();
  google.script.run
    .withSuccessHandler(() => toast(_precioAutoMode ? '🔄 Precios en modo automático (diario)' : '✋ Precios en modo manual', 'info'))
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .setPrecioAutoMode(_precioAutoMode);
}

function refreshPricesInv() { refreshPricesInvManual(); }

function refreshPricesInvManual() {
  const btn = $('invActionPrecioIcon');
  if (btn) btn.className = 'fas fa-spinner fa-spin';
  toast('Actualizando precios desde Yahoo Finance...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      if (btn) btn.className = _precioAutoMode ? 'fas fa-rotate' : 'fas fa-hand-point-up';
      if (r.ok) {
        toast(`✅ Precios: ${r.actualizados} actualizados · ${r.manuales} manuales · ${r.errores} errores`, 'success');
        refreshSection();
      } else {
        toast('Error: ' + (r.error || 'Unknown'), 'error');
      }
    })
    .withFailureHandler(e => {
      if (btn) btn.className = 'fas fa-sync';
      toast('Error actualizando precios: ' + e.message, 'error');
    })
    .actualizarPreciosInversiones();
}

// ─── Precio manual por fila ────────────────────────────
function openPrecioManualModal(invId, activo) {
  $('precioManualInvId').value = invId;
  $('precioManualActivo').textContent = activo || invId;
  $('precioManualValor').value = '';
  $('precioManualModal').classList.add('open');
  setTimeout(() => $('precioManualValor').focus(), 100);
}

function closePrecioManualModal() {
  $('precioManualModal').classList.remove('open');
}

function submitPrecioManual() {
  const invId  = $('precioManualInvId').value;
  const precio = parseFloat($('precioManualValor').value) || 0;
  if (!invId || precio <= 0) { toast('Ingresa un precio válido', 'error'); return; }

  google.script.run
    .withSuccessHandler(r => {
      if (r.ok) {
        toast('Precio actualizado', 'success');
        closePrecioManualModal();
        refreshSection();
      } else {
        toast('Error: ' + (r.error || 'No encontrado'), 'error');
      }
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .actualizarPrecioManualInversion(invId, precio);
}

function exportInvReport() {
  if (!_invData?.length) {
    toast('No hay inversiones para exportar', 'error');
    return;
  }
  
  const headers = ['Activo', 'Simbolo', 'Tipo', 'Broker', 'Cantidad', 'Precio Actual', 'Costo Promedio', 'Valor Total', 'P&L', 'Retorno %', 'Moneda'];
  const rows = _invData.map(i => [
    i.activo, i.simbolo || '', i.tipo || '', i.broker || '',
    i.qty || 0, i.precio || 0, i.costo_promedio || 0, i.valor || 0,
    i.pnl || 0, i.retorno_pct || 0, i.moneda || 'COP'
  ]);
  
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Portfolio_Report_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Reporte exportado', 'success');
}

function showInvNews(simbolo) {
  const sym = simbolo || prompt('Ingresa el ticker o nombre del activo (ej: AAPL, VOO, Bancolombia):');
  if (!sym) return;
  toast(`Obteniendo noticias de ${sym}...`, 'info');
  google.script.run
    .withSuccessHandler(noticias => {
      if (!noticias || !noticias.length) { toast('No se encontraron noticias', 'info'); return; }
      const html = noticias.map(n => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:500">${esc(n.title)}</div>
          <div style="display:flex;gap:12px;margin-top:4px;font-size:11px;color:var(--text-muted)">
            <span>${esc(n.date || '')}</span>
            ${n.link && n.link !== '#' ? `<a href="${esc(n.link)}" target="_blank" style="color:var(--blue)">Ver nota →</a>` : ''}
          </div>
        </div>
      `).join('');
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">
          <div style="background:var(--surface);border-radius:var(--radius);max-width:520px;width:100%;max-height:80vh;overflow-y:auto;padding:20px">
            <div style="display:flex;justify-content:space-between;margin-bottom:14px">
              <div style="font-weight:700">Noticias · ${esc(sym)}</div>
              <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">✕</button>
            </div>
            ${html}
          </div>
        </div>`;
      document.body.appendChild(wrap);
    })
    .withFailureHandler(e => toast('Error noticias: ' + e.message, 'error'))
    .obtenerNoticiasInversion(sym);
}

// ═══════════════════════════════════════════════════════
// RECONCILIACIÓN DE SALDOS — CIERRE DE MES
// ═══════════════════════════════════════════════════════
function openReconcilModal() {
  $('reconcilResult').style.display = 'none';
  $('reconcilCuentasList').innerHTML = '<div class="empty-state" style="padding:20px"><div class="loader-ring" style="width:24px;height:24px;border-width:2px;margin:0 auto"></div></div>';
  $('reconcilModal').classList.add('open');
  // Set default month to current filtro
  const defaultMes = $('filtroMes')?.value || new Date().toISOString().slice(0, 7);
  const mesInput = $('reconcilMesInput');
  if (mesInput && !mesInput.value) mesInput.value = defaultMes;
  _loadReconcilCuentas();
}

function _loadReconcilCuentas() {
  const mes = $('reconcilMesInput')?.value || new Date().toISOString().slice(0, 7);
  $('reconcilCuentasList').innerHTML = '<div class="empty-state" style="padding:20px"><div class="loader-ring" style="width:24px;height:24px;border-width:2px;margin:0 auto"></div></div>';
  google.script.run
    .withSuccessHandler(r => {
      if (!r.ok) { toast('Error cargando cuentas', 'error'); return; }
      $('reconcilMesLabel').textContent = `Mes de cierre: ${r.mes}`;
      _renderReconcilCuentas(r.cuentas, r.mes);
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .obtenerSaldosParaReconciliar(mes);
}

function closeReconcilModal() {
  $('reconcilModal').classList.remove('open');
}

function _renderReconcilCuentas(cuentas, mes) {
  const el = $('reconcilCuentasList');
  if (!cuentas || !cuentas.length) {
    el.innerHTML = '<div class="empty-state"><p>Sin cuentas configuradas</p></div>';
    return;
  }
  el.innerHTML = cuentas.map(c => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center">
      <div>
        <div style="font-size:13px;font-weight:600">${esc(c.nombre)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(c.tipo)} · ${esc(c.moneda)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
          Calculado: <strong class="mono">${COP.format(c.saldo_calculado)}</strong>
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">Saldo real (extracto)</label>
        <input type="number"
          class="form-input mono reconcil-input"
          data-cuenta="${esc(c.nombre)}"
          data-mes="${esc(mes)}"
          placeholder="${c.saldo_calculado}"
          value=""
          step="1"
          style="text-align:right">
      </div>
    </div>
  `).join('');
}

function submitReconcilSaldos() {
  const inputs = document.querySelectorAll('.reconcil-input');
  const ajustes = [];
  inputs.forEach(inp => {
    const val = parseFloat(inp.value);
    if (!isNaN(val)) {
      ajustes.push({
        nombre:     inp.dataset.cuenta,
        saldo_real: val,
        mes:        inp.dataset.mes
      });
    }
  });

  if (!ajustes.length) {
    toast('Ingresa al menos un saldo real para ajustar', 'error');
    return;
  }

  const btn = $('reconcilSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aplicando ajustes…';

  google.script.run
    .withSuccessHandler(r => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-scale-balanced"></i> Aplicar ajustes de cierre';

      const resultEl = $('reconcilResult');
      if (r.total === 0) {
        resultEl.innerHTML = '<i class="fas fa-circle-check" style="color:var(--emerald)"></i> Los saldos ya estaban correctos, no se generaron ajustes.';
      } else {
        const lines = r.ajustes.map(aj => {
          const sign = aj.diferencia >= 0 ? '+' : '';
          return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
            <span>${esc(aj.cuenta)} <span style="font-size:10px;color:var(--text-muted)">(${esc(aj.tipo)})</span></span>
            <span class="mono" style="color:${aj.diferencia >= 0 ? 'var(--emerald)' : 'var(--red)'}">${sign}${COP.format(aj.diferencia)}</span>
          </div>`;
        }).join('');
        resultEl.innerHTML = `
          <div style="font-weight:700;margin-bottom:8px;color:var(--emerald)"><i class="fas fa-circle-check"></i> ${r.total} ajuste(s) generado(s)</div>
          ${lines}
          <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Los ajustes aparecen en Movimientos como "Ajuste cierre ${r.mes}"</div>`;
      }
      resultEl.style.display = 'block';
      refreshSection();
    })
    .withFailureHandler(e => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-scale-balanced"></i> Aplicar ajustes de cierre';
      toast('Error al reconciliar: ' + (e.message || e), 'error');
    })
    .reconciliarSaldosMes(ajustes);
}

function toast(msg, type = 'info') {
  const icons = { success:'fa-check-circle', error:'fa-circle-xmark', info:'fa-circle-info' };
  const wrap  = $('toastWrap');
  const el    = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type]||icons.info}" style="color:${type==='success'?'var(--emerald)':type==='error'?'var(--red)':'var(--blue)'}"></i> ${esc(msg)}`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(20px)'; el.style.transition='.3s'; setTimeout(()=>el.remove(),300); }, 3500);
}

// ═══════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════
function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

function deleteTxn(txnId) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  google.script.run
    .withSuccessHandler(() => {
      toast('Movimiento eliminado', 'success');
      refreshSection();
    })
    .withFailureHandler(e => toast('Error eliminando: ' + (e.message || e), 'error'))
    .eliminarTransaccion(txnId);
}

function toIsoDate(displayDate) {
  if (!displayDate) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) return displayDate;
  const m = String(displayDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function fillSelect(id, arr) {
  const s = $(id);
  if (!s) return;
  s.innerHTML = '<option value="">— Seleccionar —</option>' +
    arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

function compact(v) {
  const n = Number(v||0);
  if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0)+'K';
  return n.toFixed(0);
}

function typeLabel(t) {
  return { expense:'Gasto', income:'Ingreso', transfer:'Transferencia', cash:'Efectivo', savings:'Ahorros', digital:'Digital', credit:'Crédito', investment:'Inversión' }[t] || t;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:var(--text-muted)">${msg}</td></tr>`;
}

// ═══════════════════════════════════════════════════════
// PERIOD VIEWS — semana / mes / año / comparar
// ═══════════════════════════════════════════════════════
let _periodView = 'mes';

function setPeriodView(view, btn) {
  _periodView = view;
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Map view name → element id
  const idMap = { mes: 'viewMes', semana: 'viewSemana', año: 'viewAño', comparar: 'viewComparar' };
  Object.entries(idMap).forEach(([v, id]) => {
    const el = $(id);
    if (el) el.style.display = (v === view) ? '' : 'none';
  });

  if (!_data) return;
  if (view === 'semana')   renderWeekView(_data);
  if (view === 'año')      renderYearView(_data);
  if (view === 'comparar') renderCompareView(_data);
}

function shiftMonth(delta) {
  const cur = $('filtroMes').value || new Date().toISOString().slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  $('filtroMes').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  refreshData(); // mes diferente = carga completa
}

function goToday() {
  $('filtroMes').value = new Date().toISOString().slice(0, 7);
  refreshData(); // volver al mes actual = carga completa
}

// ── Vista Semana ──────────────────────────────────────
function renderWeekView(d) {
  const s = d.summary?.week || {};
  setText('kpi-week-income',  COP.format(s.income  || 0));
  setText('kpi-week-expense', COP.format(s.expense || 0));
  const net = (s.income || 0) - (s.expense || 0);
  const netEl = $('kpi-week-net');
  if (netEl) { netEl.textContent = COP.format(net); netEl.style.color = net >= 0 ? 'var(--emerald)' : 'var(--red)'; }

  // Últimas txns de la semana
  const now = Date.now();
  const since = now - 7 * 86400000;
  const weekTxns = (d.historial || []).filter(t => {
    const [dd, mm, yy] = String(t.fecha || '').split('/').map(Number);
    const ts = yy && mm && dd ? new Date(yy, mm - 1, dd).getTime() : 0;
    return ts >= since;
  });
  const el = $('weekTxnList');
  if (el) {
    if (!weekTxns.length) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-week"></i><p>Sin movimientos esta semana</p></div>';
    } else {
      el.innerHTML = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th style="text-align:right">Monto</th><th>Cuenta</th></tr></thead><tbody>' +
        weekTxns.map(t => txnRow(t, false)).join('') + '</tbody></table></div>';
    }
  }
}

// ── Vista Año ─────────────────────────────────────────
function renderYearView(d) {
  const sm = d.series?.monthly || {};
  const labels   = sm.labels   || [];
  const incomes  = sm.income   || [];
  const expenses = sm.expense  || [];
  const savings  = sm.savings  || [];

  // Totales del año = suma de todos los meses en la serie (no solo el mes filtrado)
  const curMes = d.mes || $('filtroMes')?.value || '';
  const [curY] = String(curMes).split('-').map(Number);
  // Filtrar solo los meses del año seleccionado para los KPIs anuales
  const yearLabels = labels.filter(l => l.startsWith(String(curY)));
  const yearIdx    = labels.map((l, i) => l.startsWith(String(curY)) ? i : -1).filter(i => i >= 0);
  const totalIncome  = yearIdx.reduce((s, i) => s + (incomes[i]  || 0), 0) || incomes.reduce((s,v)=>s+(v||0),0);
  const totalExpense = yearIdx.reduce((s, i) => s + (expenses[i] || 0), 0) || expenses.reduce((s,v)=>s+(v||0),0);
  const totalSavings = totalIncome - totalExpense;
  const savingsRate  = totalIncome > 0 ? (totalSavings / totalIncome * 100) : 0;

  setText('kpi-year-income',  COP.format(totalIncome));
  setText('kpi-year-expense', COP.format(totalExpense));
  setText('kpi-year-savings', COP.format(totalSavings));
  const rateEl = $('kpi-year-rate');
  if (rateEl) { rateEl.textContent = savingsRate.toFixed(1) + '%'; rateEl.style.color = totalSavings >= 0 ? 'var(--emerald)' : 'var(--red)'; }

  // Tabla mes a mes
  const bodyEl = $('yearMonthBody');
  if (bodyEl && labels.length) {
    const maxExp = Math.max(...expenses.filter(v => v > 0), 1);
    bodyEl.innerHTML = labels.map((lbl, i) => {
      const inc = incomes[i]  || 0;
      const exp = expenses[i] || 0;
      const sav = inc - exp;
      const rate = inc > 0 ? (sav / inc * 100) : 0;
      const pct  = Math.min(100, (exp / maxExp) * 100).toFixed(1);
      const isActive = lbl === curMes;
      return `<tr style="${isActive ? 'background:rgba(59,130,246,.08)' : ''}">
        <td style="font-weight:${isActive?'700':'400'};white-space:nowrap">${prettyMonth(lbl)}${isActive?'<span style="font-size:10px;color:var(--blue);margin-left:6px">●</span>':''}</td>
        <td class="mono" style="text-align:right;color:var(--emerald)">${inc>0?COP.format(inc):'—'}</td>
        <td class="mono" style="text-align:right;color:var(--red)">${exp>0?COP.format(exp):'—'}</td>
        <td class="mono" style="text-align:right;color:${sav>=0?'var(--emerald)':'var(--red)'};font-weight:600">${inc||exp?COP.format(sav):'—'}</td>
        <td class="mono" style="text-align:right;font-size:12px;color:${rate>=0?'var(--emerald)':'var(--red)'}">${inc>0?rate.toFixed(1)+'%':'—'}</td>
        <td style="min-width:100px">
          ${exp>0?`<div style="background:var(--border);border-radius:99px;height:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${exp>inc?'var(--red)':'var(--blue)'};border-radius:99px;transition:width .4s"></div></div>`:''}
        </td>
      </tr>`;
    }).join('');
  }

  const isDark = !document.body.classList.contains('light-theme');
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const borderBg  = isDark ? '#0f1520' : '#ffffff';

  // Gráfica anual barras + línea de ahorro
  safeChart('chartYearBreakdown', 'chartYearBreakdown', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: incomes,  backgroundColor: 'rgba(0,212,170,.65)',  borderRadius: 5, borderSkipped: false, order: 2 },
        { label: 'Gastos',   data: expenses, backgroundColor: 'rgba(255,77,109,.65)', borderRadius: 5, borderSkipped: false, order: 2 },
        {
          label: 'Ahorro', data: savings, type: 'line',
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)',
          fill: true, tension: .45, pointRadius: 4, pointHoverRadius: 6,
          pointBackgroundColor: '#3b82f6', pointBorderColor: borderBg, pointBorderWidth: 2,
          borderWidth: 2, order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 600 },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
        tooltip: {
          ...Object.assign({}, _tooltipBase),
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } }, border: { display: false } },
        y: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } }
      }
    }
  });

  // Barras horizontales por categoría — acumular todo el año desde historial
  const byCatYear = {};
  (d.historial || []).forEach(t => {
    if (t.type !== 'expense' && t.type !== 'investment') return;
    const lbl = t.mes || '';
    if (curY && lbl && !lbl.startsWith(String(curY))) return;
    byCatYear[t.cat] = (byCatYear[t.cat] || 0) + (t.monto || 0);
  });
  const catEntries = Object.entries(byCatYear).sort((a, b) => b[1] - a[1]);
  const totalCatYear = catEntries.reduce((s, [,v]) => s+v, 0);

  safeChart('chartYearCats', 'chartYearCats', {
    type: 'bar',
    data: {
      labels: catEntries.slice(0,10).map(([k]) => k),
      datasets: [{
        label: 'Gasto acumulado',
        data: catEntries.slice(0,10).map(([,v]) => v),
        backgroundColor: catEntries.slice(0,10).map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
        borderColor: catEntries.slice(0,10).map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 1, borderRadius: 6, borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...Object.assign({}, _tooltipBase),
          callbacks: {
            label: ctx => {
              const pct = totalCatYear > 0 ? ((ctx.raw / totalCatYear) * 100).toFixed(1) : 0;
              return ` ${COP.format(ctx.raw)} · ${pct}% del total`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridColor }, border: { display: false } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } }, border: { display: false } }
      }
    }
  });

  // Top gastos año
  const el = $('topGastosYear');
  if (el) {
    const maxVal = catEntries[0]?.[1] || 1;
    el.innerHTML = catEntries.slice(0, 8).map(([c, v], i) => `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
          <span style="font-weight:500">${esc(c)}</span>
          <span class="mono" style="color:${PALETTE[i%PALETTE.length]};font-size:12px">${COP.format(v)}</span>
        </div>
        <div class="progress">
          <div class="progress-fill" style="width:${(v/maxVal*100).toFixed(1)}%;background:${PALETTE[i%PALETTE.length]}"></div>
        </div>
      </div>
    `).join('') || '<div class="empty-state"><p>Sin datos</p></div>';
  }

  // ── Ranking de meses ───────────────────────────────
  const rankEl = $('yearMonthRanking');
  if (rankEl && yearIdx.length >= 2) {
    // Build per-month stats for the year
    const monthStats = yearIdx.map(i => ({
      label:    labels[i],
      inc:      incomes[i]  || 0,
      exp:      expenses[i] || 0,
      sav:      (incomes[i] || 0) - (expenses[i] || 0),
      rate:     (incomes[i] || 0) > 0 ? ((incomes[i] - expenses[i]) / incomes[i] * 100) : null
    })).filter(m => m.inc > 0 || m.exp > 0);

    if (monthStats.length >= 2) {
      const byRate   = [...monthStats].filter(m => m.rate !== null).sort((a, b) => b.rate - a.rate);
      const byExp    = [...monthStats].sort((a, b) => b.exp - a.exp);
      const bySav    = [...monthStats].sort((a, b) => b.sav - a.sav);
      const avgExp   = monthStats.reduce((s, m) => s + m.exp, 0) / monthStats.length;

      // Month-over-month deltas for the most recent months
      const recentStats = monthStats.slice(-3);
      const trendCards = recentStats.length >= 2
        ? recentStats.slice(1).map((m, i) => {
            const prev = recentStats[i];
            const delta = prev.exp > 0 ? ((m.exp - prev.exp) / prev.exp * 100) : 0;
            const sign  = delta >= 0 ? '↑' : '↓';
            const col   = delta > 0 ? 'var(--red)' : 'var(--emerald)';
            return `<div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:12px;padding:14px 16px">
              <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Variación ${prettyMonth(m.label)}</div>
              <div style="font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;color:${col}">${sign} ${Math.abs(delta).toFixed(1)}%</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px">vs ${prettyMonth(prev.label)} · Gastos: ${COP.format(m.exp)}</div>
            </div>`;
          }).join('')
        : '';

      const rankCard = (emoji, label, sub, value, detail, color) => `
        <div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:12px;padding:14px 16px">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${emoji} ${esc(label)}</div>
          <div style="font-size:16px;font-weight:700;color:${color}">${esc(sub)}</div>
          <div style="font-size:13px;font-variant-numeric:tabular-nums;color:var(--text);margin-top:2px">${value}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${detail}</div>
        </div>`;

      const bestSavRate  = byRate[0];
      const worstSavRate = byRate[byRate.length - 1];
      const mostExpMonth = byExp[0];
      const bestSavAbs   = bySav[0];
      const worstSavAbs  = bySav[bySav.length - 1];

      const aboveAvg = monthStats.filter(m => m.exp > avgExp).length;
      const belowAvg = monthStats.length - aboveAvg;

      rankEl.innerHTML = [
        rankCard('🏆', 'Mejor tasa de ahorro', prettyMonth(bestSavRate?.label || ''), bestSavRate ? bestSavRate.rate.toFixed(1) + '%' : '—', bestSavRate ? `Ahorró ${COP.format(bestSavRate.sav)}` : '', 'var(--emerald)'),
        rankCard('📉', 'Peor tasa de ahorro',  prettyMonth(worstSavRate?.label || ''), worstSavRate ? worstSavRate.rate.toFixed(1) + '%' : '—', worstSavRate ? `Balance: ${COP.format(worstSavRate.sav)}` : '', worstSavRate && worstSavRate.rate < 0 ? 'var(--red)' : 'var(--yellow,#f5a623)'),
        rankCard('💸', 'Mes más gastador',     prettyMonth(mostExpMonth?.label || ''), mostExpMonth ? COP.format(mostExpMonth.exp) : '—', mostExpMonth ? `${((mostExpMonth.exp / avgExp - 1) * 100).toFixed(0)}% sobre el promedio mensual` : '', 'var(--red)'),
        rankCard('💰', 'Mayor ahorro absoluto', prettyMonth(bestSavAbs?.label || ''), bestSavAbs ? COP.format(bestSavAbs.sav) : '—', bestSavAbs ? `Tasa: ${bestSavAbs.rate !== null ? bestSavAbs.rate.toFixed(1) + '%' : '—'}` : '', 'var(--blue)'),
        rankCard('📊', 'Patrón del año', `${aboveAvg} meses sobre promedio`, `Gasto medio: ${COP.format(Math.round(avgExp))}`, `${belowAvg} ${belowAvg === 1 ? 'mes' : 'meses'} dentro del rango ideal`, 'var(--text)'),
        trendCards
      ].join('');
    } else {
      rankEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Necesitas al menos 2 meses con datos para ver el ranking.</div>';
    }
  }

  // ── Year: Category time-series ─────────────────────
  _renderCatSeriesChart(d, curY, gridColor, borderBg);
}

function _renderCatSeriesChart(d, curY, gridColor, borderBg) {
  const canvas = $('chartCatSeries');
  if (!canvas) return;
  const hist = d.historial || [];
  const sm   = d.series?.monthly || {};
  const allLabels = sm.labels || [];

  // Months belonging to the selected year, sorted
  const yearLabels = allLabels.filter(l => l.startsWith(String(curY))).sort();
  if (!yearLabels.length) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';

  // Build a per-cat, per-month expense map from historial
  const catMonthMap = {};
  hist.forEach(t => {
    if (t.type !== 'expense' && t.type !== 'investment') return;
    if (!yearLabels.includes(t.mes)) return;
    if (!catMonthMap[t.cat]) catMonthMap[t.cat] = {};
    catMonthMap[t.cat][t.mes] = (catMonthMap[t.cat][t.mes] || 0) + (t.monto || 0);
  });

  // Sort categories by total spend descending, take top 8
  const catTotals = Object.entries(catMonthMap)
    .map(([cat, months]) => ({ cat, total: Object.values(months).reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  if (!catTotals.length) { canvas.style.display = 'none'; return; }

  const datasets = catTotals.map(({ cat }, i) => ({
    label: cat,
    data: yearLabels.map(lbl => catMonthMap[cat]?.[lbl] || 0),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length] + '18',
    fill: false,
    tension: .4,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBackgroundColor: PALETTE[i % PALETTE.length],
    pointBorderColor: borderBg,
    pointBorderWidth: 2,
    borderWidth: 2
  }));

  // Legend chips
  const legendEl = $('catSeriesLegend');
  if (legendEl) {
    legendEl.innerHTML = catTotals.map(({ cat }, i) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);cursor:pointer"
             onclick="_toggleCatSeries(${i})" id="catLegendChip${i}">
        <span style="width:10px;height:3px;border-radius:99px;background:${PALETTE[i%PALETTE.length]};display:inline-block"></span>
        ${esc(cat)}
      </span>`
    ).join('');
  }

  safeChart('catSeries', 'chartCatSeries', {
    type: 'line',
    data: { labels: yearLabels.map(l => prettyMonth(l)), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...Object.assign({}, _tooltipBase),
          callbacks: {
            title: items => items[0]?.label || '',
            label: ctx => {
              const val = ctx.raw || 0;
              return val > 0 ? ` ${ctx.dataset.label}: ${COP.format(val)}` : null;
            }
          },
          filter: item => (item.raw || 0) > 0
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } }, border: { display: false } },
        y: {
          ticks: { callback: v => compact(v), font: { size: 10 } },
          grid: { color: gridColor },
          border: { display: false },
          beginAtZero: true
        }
      }
    }
  });
}

function _toggleCatSeries(idx) {
  const chart = _charts['catSeries'];
  if (!chart) return;
  const meta = chart.getDatasetMeta(idx);
  meta.hidden = !meta.hidden;
  chart.update();
  const chip = $('catLegendChip' + idx);
  if (chip) chip.style.opacity = meta.hidden ? '0.35' : '1';
}

// ── Vista Comparar ────────────────────────────────────
function renderCompareView(d) {
  const sm = d.series?.monthly || {};
  const labels  = sm.labels  || [];
  const incomes  = sm.income  || [];
  const expenses = sm.expense || [];

  // Populate selects with available months
  const selA = $('compareSelA');
  const selB = $('compareSelB');
  if (selA && selB && labels.length) {
    const curSelA = selA.value;
    const curSelB = selB.value;
    const opts = labels.map(l => `<option value="${esc(l)}">${prettyMonth(l)}</option>`).join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    // Default: A = current filtro, B = previous month
    const curMes = d.mes || $('filtroMes').value || '';
    const idxDefault = labels.indexOf(curMes);
    selA.value = curSelA && labels.includes(curSelA) ? curSelA : (labels[idxDefault] || labels[labels.length - 1] || '');
    selB.value = curSelB && labels.includes(curSelB) ? curSelB : (labels[idxDefault > 0 ? idxDefault - 1 : Math.max(0, labels.length - 2)] || '');
  }

  _renderCompareData(d);
}

function prettyMonth(m) {
  const [y, mo] = String(m || '').split('-').map(Number);
  if (!y || !mo) return m;
  return new Date(y, mo - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
}

function _renderCompareData(d) {
  if (!d) d = _data;
  if (!d) return;
  const sm = d.series?.monthly || {};
  const labels  = sm.labels  || [];
  const incomes  = sm.income  || [];
  const expenses = sm.expense || [];

  const selA = $('compareSelA');
  const selB = $('compareSelB');
  const mesA = selA?.value || '';
  const mesB = selB?.value || '';
  const idxA = labels.indexOf(mesA);
  const idxB = labels.indexOf(mesB);

  const dataA = idxA >= 0 ? { income: incomes[idxA] || 0, expense: expenses[idxA] || 0, label: labels[idxA] } : null;
  const dataB = idxB >= 0 ? { income: incomes[idxB] || 0, expense: expenses[idxB] || 0, label: labels[idxB] } : null;

  setText('compareMonthA', dataA ? prettyMonth(dataA.label) : (mesA || 'Mes A'));
  setText('compareMonthB', dataB ? prettyMonth(dataB.label) : (mesB || 'Mes B'));

  const renderCompareData = (elId, data, prevData) => {
    const el = $(elId);
    if (!el || !data) { if (el) el.innerHTML = '<div class="empty-state"><p>Sin datos para este periodo</p></div>'; return; }
    const savRate = data.income > 0 ? ((data.income - data.expense) / data.income * 100).toFixed(1) : '0.0';
    const delta = (field) => {
      if (!prevData) return '';
      const diff = data[field] - prevData[field];
      const pct = prevData[field] > 0 ? (diff / prevData[field] * 100).toFixed(1) : '—';
      const cls = diff === 0 ? 'delta-flat' : (field === 'expense' ? (diff > 0 ? 'delta-down' : 'delta-up') : (diff > 0 ? 'delta-up' : 'delta-down'));
      const sign = diff >= 0 ? '+' : '';
      return `<span class="compare-delta ${cls}">${sign}${pct}%</span>`;
    };
    el.innerHTML = `
      <div class="compare-stat"><span>Ingresos</span><div style="display:flex;align-items:center;gap:8px"><span class="mono" style="color:var(--emerald);font-weight:600">${COP.format(data.income)}</span>${delta('income')}</div></div>
      <div class="compare-stat"><span>Gastos</span><div style="display:flex;align-items:center;gap:8px"><span class="mono" style="color:var(--red);font-weight:600">${COP.format(data.expense)}</span>${delta('expense')}</div></div>
      <div class="compare-stat"><span>Ahorro neto</span><span class="mono" style="font-weight:600;color:${(data.income-data.expense)>=0?'var(--emerald)':'var(--red)'}">${COP.format(data.income - data.expense)}</span></div>
      <div class="compare-stat"><span>Tasa de ahorro</span><span class="mono" style="font-weight:600">${savRate}%</span></div>
    `;
  };

  renderCompareData('compareDataA', dataA, dataB);
  renderCompareData('compareDataB', dataB, null);

  // Barras agrupadas A vs B
  if (dataA || dataB) {
    const isDark = !document.body.classList.contains('light-theme');
    const gridC = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const labA = dataA ? prettyMonth(dataA.label) : (mesA || 'Mes A');
    const labB = dataB ? prettyMonth(dataB.label) : (mesB || 'Mes B');
    safeChart('chartCompareBar', 'chartCompareBar', {
      type: 'bar',
      data: {
        labels: ['Ingresos', 'Gastos', 'Ahorro neto'],
        datasets: [
          {
            label: labA,
            data: [dataA?.income||0, dataA?.expense||0, (dataA?.income||0)-(dataA?.expense||0)],
            backgroundColor: ['rgba(0,212,170,.7)','rgba(255,77,109,.7)','rgba(59,130,246,.7)'],
            borderColor:     ['#00d4aa','#ff4d6d','#3b82f6'],
            borderWidth: 1, borderRadius: 6, borderSkipped: false
          },
          {
            label: labB,
            data: [dataB?.income||0, dataB?.expense||0, (dataB?.income||0)-(dataB?.expense||0)],
            backgroundColor: ['rgba(0,212,170,.3)','rgba(255,77,109,.3)','rgba(59,130,246,.3)'],
            borderColor:     ['#00d4aa','#ff4d6d','#3b82f6'],
            borderWidth: 1, borderRadius: 6, borderSkipped: false, borderDash: [4,2]
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 500 },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
          tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: gridC }, border: { display: false } }
        }
      }
    });
  }

  // Tendencia 12 meses
  safeChart('chartTrendCompare', 'chartTrendCompare', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ingresos', data: incomes, borderColor: '#00d4aa',
          backgroundColor: 'rgba(0,212,170,.08)', fill: true,
          tension: .45, pointRadius: 3, pointHoverRadius: 5,
          pointBackgroundColor: '#00d4aa', borderWidth: 2
        },
        {
          label: 'Gastos', data: expenses, borderColor: '#ff4d6d',
          backgroundColor: 'rgba(255,77,109,.08)', fill: true,
          tension: .45, pointRadius: 3, pointHoverRadius: 5,
          pointBackgroundColor: '#ff4d6d', borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 500 },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
        tooltip: { ...Object.assign({}, _tooltipBase), callbacks: { label: ctx => ` ${ctx.dataset.label}: ${COP.format(ctx.raw||0)}` } }
      },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { ticks: { callback: v => compact(v), font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }
        }
      }
  });
}

// ═══════════════════════════════════════════════════════
// GEMINI API KEY — UI
// ═══════════════════════════════════════════════════════
function loadGeminiKeyStatus() {
  google.script.run
    .withSuccessHandler(r => {
      const el = $('geminiKeyStatus');
      if (!el) return;
      if (r.configured) {
        el.innerHTML = `<span style="color:var(--emerald)"><i class="fas fa-circle-check"></i> API key configurada: <code style="font-family:monospace;font-size:11px">${esc(r.masked)}</code></span>`;
      } else {
        el.innerHTML = `<span style="color:var(--gold)"><i class="fas fa-triangle-exclamation"></i> API key no configurada. La clasificación IA y el chatbot no funcionarán.</span>`;
      }
    })
    .withFailureHandler(() => {})
    .getGeminiKeyStatus();
}

function guardarGeminiKeyUI() {
  const key = ($('cfgGeminiKey')?.value || '').trim();
  if (!key) { toast('Ingresa una API key válida', 'error'); return; }
  google.script.run
    .withSuccessHandler(() => {
      toast('API key guardada correctamente', 'success');
      $('cfgGeminiKey').value = '';
      loadGeminiKeyStatus();
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .guardarGeminiApiKey(key);
}

function probarClaveIAUI() {
  const key = ($('cfgGeminiKey')?.value || '').trim();
  const run = () => {
    toast('Probando la clave...', 'info');
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.ok) toast('✅ La IA respondió correctamente: ' + (r.reply || 'OK'), 'success');
        else toast('❌ La IA no respondió (HTTP ' + (r ? r.code : '?') + '). Revisa la clave.', 'error');
      })
      .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
      .probarClaveIA();
  };
  // Si hay una clave escrita sin guardar, guardarla primero para probarla.
  if (key) {
    google.script.run
      .withSuccessHandler(() => { $('cfgGeminiKey').value = ''; loadGeminiKeyStatus(); run(); })
      .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
      .guardarGeminiApiKey(key);
  } else {
    run();
  }
}

function toggleGeminiKeyVisibility() {
  const inp = $('cfgGeminiKey');
  const icon = $('geminiKeyEye');
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    if (icon) icon.className = 'fas fa-eye-slash';
  } else {
    inp.type = 'password';
    if (icon) icon.className = 'fas fa-eye';
  }
}

// ═══════════════════════════════════════════════════════
// CHATBOT — UI
// ═══════════════════════════════════════════════════════
let _chatOpen = false;

function toggleChatbot() {
  _chatOpen = !_chatOpen;
  const panel = $('chatbotPanel');
  const icon  = $('chatbotBtnIcon');
  if (panel) panel.style.display = _chatOpen ? 'flex' : 'none';
  if (icon)  icon.className = _chatOpen ? 'fas fa-xmark' : 'fas fa-comments';
  if (_chatOpen) setTimeout(() => { const i = $('chatInput'); if (i) i.focus(); }, 150);
}

function sendChatMessage() {
  sendChatMessageIA();
}

function appendChatMsg(text, role) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role;
  // Render basic markdown: **bold**, *italic*, newlines
  el.innerHTML = esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  $('chatMessages').appendChild(el);
  scrollChatBottom();
}

function scrollChatBottom() {
  const el = $('chatMessages');
  if (el) el.scrollTop = el.scrollHeight;
}

// ═══════════════════════════════════════════════════════
// TECLADO — Ctrl+K / Cmd+K abre nueva transacción
// ═══════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openModal();
  }
  if (e.key === 'Escape') {
    closeModal();
    closeEmailEditModal();
    closeEditTxnModal();
    closeEditInvModal();
    closeNewInvModal();
  }
});

// ═══════════════════════════════════════════════════════
// PÁGINA CONFIGURACIÓN
// ═══════════════════════════════════════════════════════
let _cfgData = null;

function loadConfigPage() {
  google.script.run
    .withSuccessHandler(d => { _cfgData = d; renderConfigPage(d); })
    .withFailureHandler(e => toast('Error cargando configuración: ' + e.message, 'error'))
    .getConfigData();
  loadGeminiKeyStatus();
}

function renderConfigPage(d) {
  // Cuentas
  const cfgCuentasList = $('cfgCuentasList');
  if (cfgCuentasList) {
    cfgCuentasList.innerHTML = (d.cuentas || []).map(c => `
      <div class="account-card" style="cursor:pointer" onclick="loadCuentaForm('${esc(c.nombre)}','${esc(c.tipo)}','${esc(c.institucion||'')}',${c.saldo||0})">
        <div>
          <div class="account-name">${esc(c.nombre)}</div>
          <div class="account-type">${esc(c.tipo)} · ${esc(c.moneda)}</div>
        </div>
        <div style="font-family:'DM Mono';font-size:14px;color:${c.activa ? 'var(--emerald)' : 'var(--text-muted)'}">${COP.format(c.saldo)}</div>
      </div>
    `).join('') || '<div class="empty-state"><i class="fas fa-wallet"></i><p>Sin cuentas</p></div>';
  }

  // Categorías
  const cfgCatList = $('cfgCatList');
  if (cfgCatList) {
    cfgCatList.innerHTML = (d.categorias || []).map(c => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${c.icono || '•'}</span>
          <div>
            <div style="font-size:13px;font-weight:500">${esc(c.nombre)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(c.grupo)}</div>
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="eliminarCategoriaUI('${esc(c.id)}')" title="Eliminar">
          <i class="fas fa-trash" style="font-size:11px"></i>
        </button>
      </div>
    `).join('') || '<div class="empty-state"><i class="fas fa-tags"></i><p>Sin categorías</p></div>';
  }

  // Settings
  const s = d.settings || {};
  setInputVal('cfgSalario',     s.salario_mensual     || 0);
  setInputVal('cfgMonedaBase',  s.moneda_base          || 'COP');
  setInputVal('cfgGmailLabel',  s.etiqueta_gmail       || 'gastos');
  setInputVal('cfgUmbral',      s.umbral_auto_aprobacion || 0.88);
  setInputVal('cfgProveedorIA', s.proveedor_ia         || 'gemini');
}

function setInputVal(id, val) {
  const el = $(id);
  if (!el) return;
  el.value = val;
}

function loadCuentaForm(nombre, tipo, inst, saldo) {
  setInputVal('cfgCuentaNombre', nombre);
  setInputVal('cfgCuentaTipo',   tipo);
  setInputVal('cfgCuentaInst',   inst);
  setInputVal('cfgCuentaSaldo',  saldo);
}

function guardarCuentaUI() {
  const nombre = ($('cfgCuentaNombre')?.value || '').trim();
  if (!nombre) { toast('Nombre de cuenta requerido', 'error'); return; }
  const form = {
    nombre,
    tipo:       $('cfgCuentaTipo')?.value || 'efectivo',
    institucion:$('cfgCuentaInst')?.value || '',
    moneda:     'COP',
    saldo:      parseFloat($('cfgCuentaSaldo')?.value) || 0,
    activa:     true
  };
  toast('Guardando cuenta...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      toast(r.action === 'created' ? 'Cuenta creada' : 'Cuenta actualizada', 'success');
      loadConfigPage();
      refreshSection();
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .guardarCuenta(form);
}

function guardarCategoriaUI() {
  const nombre = ($('cfgCatNombre')?.value || '').trim();
  if (!nombre) { toast('Nombre de categoría requerido', 'error'); return; }
  const form = {
    nombre,
    grupo:    $('cfgCatGrupo')?.value    || 'gasto',
    icono:    $('cfgCatIcono')?.value    || '',
    keywords: $('cfgCatKeywords')?.value || '',
    color:    '#64748b'
  };
  google.script.run
    .withSuccessHandler(() => {
      toast('Categoría guardada', 'success');
      $('cfgCatNombre').value = '';
      $('cfgCatIcono').value  = '';
      $('cfgCatKeywords').value = '';
      loadConfigPage();
      refreshSection();
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .guardarCategoria(form);
}

function eliminarCategoriaUI(catId) {
  if (!confirm('¿Eliminar esta categoría? No se podrá deshacer.')) return;
  google.script.run
    .withSuccessHandler(() => { toast('Categoría eliminada', 'success'); loadConfigPage(); refreshSection(); })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .eliminarCategoria(catId);
}

function guardarConfigUI() {
  const items = [
    ['salario_mensual',           $('cfgSalario')?.value     || '0'],
    ['moneda_base',               $('cfgMonedaBase')?.value  || 'COP'],
    ['etiqueta_gmail',            $('cfgGmailLabel')?.value  || 'gastos'],
    ['umbral_auto_aprobacion',    $('cfgUmbral')?.value      || '0.88'],
    ['proveedor_ia',              $('cfgProveedorIA')?.value || 'gemini']
  ];
  let pending = items.length;
  let errors  = 0;
  items.forEach(([clave, valor]) => {
    google.script.run
      .withSuccessHandler(() => {
        pending--;
        if (pending === 0) {
          if (errors === 0) toast('Ajustes guardados correctamente', 'success');
          else toast(`Ajustes guardados con ${errors} error(es)`, 'error');
          refreshSection();
        }
      })
      .withFailureHandler(() => { errors++; pending--; })
      .guardarConfiguracion(clave, valor);
  });
}

function recalcularSaldosUI() {
  toast('Recalculando saldos...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      if (r.ok) { toast('Saldos recalculados', 'success'); refreshSection(); }
      else toast('Error: ' + r.error, 'error');
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .recalcularSaldos();
}

function actualizarFXUI() {
  toast('Actualizando tipos de cambio...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      if (r.ok) toast(`FX actualizado: ${r.updated} pares`, 'success');
      else toast('Error actualizando FX', 'error');
    })
    .withFailureHandler(e => toast('Error FX: ' + e.message, 'error'))
    .actualizarFX();
}

// ═══════════════════════════════════════════════════════
// CHAT IA AVANZADO — Con contexto financiero completo
// ═══════════════════════════════════════════════════════
let _chatHistorial = [];

function sendChatMessageIA() {
  const input = $('chatInputIA') || $('chatInput');
  const msg = (input?.value || '').trim();
  if (!msg) return;
  input.value = '';

  _chatHistorial.push({ role: 'user', content: msg });
  appendChatMsgIA(msg, 'user');

  const typingId = 'typing_' + Date.now();
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-msg typing';
  typingEl.id = typingId;
  typingEl.innerHTML = '<div class="chat-typing-dots"><span></span><span></span><span></span></div>';
  const chatBox = $('chatMessagesIA') || $('chatMessages');
  if (chatBox) { chatBox.appendChild(typingEl); chatBox.scrollTop = chatBox.scrollHeight; }

  google.script.run
    .withSuccessHandler(r => {
      const typing = $(typingId);
      if (typing) typing.remove();
      const respuesta = r.respuesta || r.reply || 'Sin respuesta';
      _chatHistorial.push({ role: 'assistant', content: respuesta });
      appendChatMsgIA(respuesta, 'bot');

      // Si la IA detectó una acción de registro
      if (r.accion && r.accion.accion === 'registrar') {
        mostrarSugerenciaRegistro(r.accion);
      }
    })
    .withFailureHandler(err => {
      const typing = $(typingId);
      if (typing) typing.remove();
      appendChatMsgIA('Error conectando con la IA. Verifica tu API Key de OpenRouter en Ajustes.', 'bot');
    })
    .chatFinancieroUI(msg, _chatHistorial.slice(-8));
}

function appendChatMsgIA(text, role) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role;
  el.innerHTML = esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  const chatBox = $('chatMessagesIA') || $('chatMessages');
  if (chatBox) { chatBox.appendChild(el); chatBox.scrollTop = chatBox.scrollHeight; }
}

function mostrarSugerenciaRegistro(accion) {
  const banner = document.createElement('div');
  banner.style.cssText = 'background:rgba(0,212,170,.1);border:1px solid rgba(0,212,170,.3);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:12px;display:flex;align-items:center;gap:10px;justify-content:space-between';
  banner.innerHTML = `
    <div>
      <div style="font-weight:600;color:var(--emerald)">Detecté un gasto — ¿Lo registro?</div>
      <div style="color:var(--text-muted);margin-top:2px">${esc(accion.descripcion || '')} · ${COP.format(accion.monto || 0)} · ${esc(accion.categoria || '')}</div>
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-success btn-sm" onclick="registrarDesdeIA(${JSON.stringify(accion).replace(/"/g,'&quot;')},this)"><i class="fas fa-check"></i> Sí</button>
      <button class="btn btn-ghost btn-sm" onclick="this.closest('div[style]').remove()">No</button>
    </div>`;
  const chatBox = $('chatMessagesIA') || $('chatMessages');
  if (chatBox) { chatBox.appendChild(banner); chatBox.scrollTop = chatBox.scrollHeight; }
}

function registrarDesdeIA(accion, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  google.script.run
    .withSuccessHandler(r => {
      if (r.ok) {
        toast('Transacción registrada desde IA', 'success');
        btn && btn.closest('div[style]').remove();
        refreshSection();
      }
    })
    .withFailureHandler(e => toast('Error registrando: ' + e.message, 'error'))
    .guardarTransaccion({
      tipo: accion.tipo || 'Egreso',
      fecha: new Date().toISOString().slice(0,10),
      monto: accion.monto || 0,
      categoria: accion.categoria || 'Otros',
      cuenta: (_data?.combos?.cuentas || ['Bancolombia Ahorro'])[0],
      descripcion: accion.descripcion || 'Desde IA',
      source: 'chat_ia'
    });
}

function clearChatIA() {
  _chatHistorial = [];
  const chatBox = $('chatMessagesIA') || $('chatMessages');
  if (chatBox) chatBox.innerHTML = '<div class="chat-msg bot">Hola, soy tu asesor financiero IA. Puedo ayudarte a categorizar gastos, registrar movimientos, darte consejos de ahorro para Colombia, o analizar tus finanzas. ¿En qué te ayudo?</div>';
}

// ═══════════════════════════════════════════════════════
// TRUCOS IA — Panel de consejos financieros
// ═══════════════════════════════════════════════════════
function loadTrucosIA() {
  const el = $('trucosIAContent');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><div class="loader-ring" style="width:28px;height:28px;border-width:2px"></div><p>Generando consejos personalizados...</p></div>';

  google.script.run
    .withSuccessHandler(trucos => {
      if (!trucos || !trucos.length) {
        el.innerHTML = '<div class="empty-state"><p>No se pudieron cargar los consejos</p></div>';
        return;
      }
      el.innerHTML = trucos.map(t => `
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:22px">${t.emoji || '💡'}</span>
            <div style="font-weight:700;font-size:14px">${esc(t.titulo)}</div>
          </div>
          <div style="font-size:13px;color:var(--text-muted);line-height:1.6">${esc(t.consejo)}</div>
        </div>
      `).join('');
    })
    .withFailureHandler(e => {
      el.innerHTML = '<div class="empty-state"><p>Error: ' + esc(e.message) + '</p></div>';
    })
    .getTrucosFinancierosUI();
}

// ═══════════════════════════════════════════════════════
// PDF EXTRACTO BANCARIO — Conciliación v4
// ═══════════════════════════════════════════════════════
// ── Queue de archivos PDF ────────────────────────────────────────────────
let _pdfQueue = []; // [{file, name, status:'pending'|'processing'|'done'|'error', msg}]

function concilAbrirUpload() {
  const card = $('concilUploadCard');
  if (card) { card.style.display = 'block'; card.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
}
function concilCerrarUpload() {
  const card = $('concilUploadCard');
  if (card) card.style.display = 'none';
  _pdfQueue = [];
  const fi = $('pdfFile');
  if (fi) fi.value = '';
  const lbl = $('pdfFileLabel');
  if (lbl) { lbl.textContent = 'Arrastra uno o varios PDFs'; lbl.style.color = ''; }
  const q = $('pdfQueue');
  if (q) q.style.display = 'none';
}

function concilOnFileSelect(files) {
  if (!files || !files.length) return;
  const nuevos = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
  nuevos.forEach(f => _pdfQueue.push({ file: f, name: f.name, status: 'pending', msg: '' }));
  _renderPdfQueue();
}

function concilOnFileDrop(e) {
  const files = e.dataTransfer.files;
  concilOnFileSelect(files);
}

function _renderPdfQueue() {
  const wrap = $('pdfQueue');
  const list = $('pdfQueueList');
  if (!wrap || !list) return;
  if (_pdfQueue.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const lbl = $('pdfFileLabel');
  if (lbl) { lbl.textContent = _pdfQueue.length === 1 ? '1 archivo seleccionado' : `${_pdfQueue.length} archivos`; lbl.style.color = 'var(--emerald)'; }

  const iconFor = s => s === 'done' ? '✓' : s === 'error' ? '✗' : s === 'processing' ? '⏳' : '📄';
  const clrFor  = s => s === 'done' ? 'var(--emerald)' : s === 'error' ? 'var(--red)' : s === 'processing' ? 'var(--gold)' : 'var(--text-muted)';

  list.innerHTML = _pdfQueue.map((item, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid var(--border);font-size:11px">
      <span style="color:${clrFor(item.status)};flex-shrink:0">${iconFor(item.status)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">${esc(item.name)}</span>
      <span style="color:${clrFor(item.status)};font-size:10px">${esc(item.msg)}</span>
      ${item.status === 'pending' ? `<button onclick="_pdfQueueRemove(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;font-size:12px">✕</button>` : ''}
    </div>
  `).join('');
}

function _pdfQueueRemove(i) {
  _pdfQueue.splice(i, 1);
  _renderPdfQueue();
}

async function procesarPDFCola() {
  if (_pdfQueue.length === 0) { toast('Selecciona al menos un PDF', 'error'); return; }
  const cuenta = $('pdfCuenta')?.value || '';
  const btn = $('pdfProcessBtn');

  const pendientes = _pdfQueue.filter(item => item.status === 'pending');
  if (pendientes.length === 0) { toast('Todos los archivos ya fueron procesados', 'info'); return; }

  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Procesando 0/${pendientes.length}...`; }

  let procesados = 0;
  let ultimoResultado = null;

  for (const item of pendientes) {
    item.status = 'processing';
    item.msg = '';
    _renderPdfQueue();
    if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Procesando ${procesados}/${pendientes.length}...`;

    try {
      const base64 = await _leerArchivoBase64(item.file);
      const r = await _procesarPDFPromise(base64, cuenta);
      if (!r || (!r.ok && !r.cuadrado)) {
        item.status = 'error';
        item.msg = r?.error || 'Error';
      } else {
        item.status = 'done';
        item.msg = `${r.total_movimientos || 0} mov`;
        ultimoResultado = r;
      }
    } catch(err) {
      item.status = 'error';
      item.msg = err.message || 'Error';
    }
    procesados++;
    _renderPdfQueue();
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Leer y conciliar'; }
  loadHistorialExtractos();

  if (ultimoResultado) {
    concilCerrarUpload();
    _concilMostrarResultado(ultimoResultado);
  } else {
    toast('No se pudo procesar ningún archivo', 'error');
  }
}

function _leerArchivoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _procesarPDFPromise(base64, cuenta) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      .procesarPDFUI({ pdfBase64: base64, cuenta });
  });
}

// Compatibilidad con código anterior
function procesarPDF() { procesarPDFCola(); }
function abrirPanelPDF() { concilAbrirUpload(); }
function cerrarPanelPDF() { concilCerrarUpload(); }

// ── Estado global ────────────────────────────────────────────────────────
let _concilResult = null;
let _concilReview = [];

const BANCO_LABELS = { nu:'Nu Bank', nequi:'Nequi', bancolombia:'Bancolombia', davivienda:'Davivienda', bbva:'BBVA', avvillas:'AV Villas', bogota:'Banco de Bogotá', scotiabank:'Scotiabank', generico:'Genérico', desconocido:'Desconocido' };
const BANCO_COLOR  = { nu:'#8b5cf6', nequi:'#8b5cf6', bancolombia:'#f5a623', davivienda:'#ff4d6d', bbva:'#3b82f6', avvillas:'#00d4aa', bogota:'#3b82f6', scotiabank:'#ff4d6d', generico:'#64748b', desconocido:'#64748b' };

function _inferirBanco(bancoDetectado, cuenta) {
  if (bancoDetectado && bancoDetectado !== 'desconocido' && bancoDetectado !== '') return bancoDetectado;
  const c = (cuenta || '').toLowerCase();
  if (/nequi/.test(c)) return 'nequi';
  if (/nu\b|nubank/.test(c)) return 'nu';
  if (/bancolombia/.test(c)) return 'bancolombia';
  if (/davivienda/.test(c)) return 'davivienda';
  if (/bbva/.test(c)) return 'bbva';
  if (/av.?villas/.test(c)) return 'avvillas';
  if (/bogot/.test(c)) return 'bogota';
  if (/scotiabank/.test(c)) return 'scotiabank';
  return 'desconocido';
}

function _labelHistorialItem(h) {
  // Intenta construir un label legible cuando banco y cuenta están vacíos
  const banco = _inferirBanco(h.banco_detectado, h.cuenta);
  if (banco !== 'desconocido') return { banco, label: BANCO_LABELS[banco] || banco, cuenta: h.cuenta || '—' };
  // Fallback: usar el statement_id para extraer fecha (ej: "PDF_20260315_103045")
  const m = (h.statement_id || '').match(/(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const label = `Extracto ${meses[parseInt(m[2])-1]} ${m[1]}`;
    return { banco: 'desconocido', label, cuenta: h.cuenta || h.notas || '—' };
  }
  return { banco: 'desconocido', label: 'Extracto', cuenta: h.cuenta || '—' };
}

// ── Muestra el resultado de un extracto en el panel derecho ──────────────
function _concilMostrarResultado(r) {
  _concilResult = r;
  const review = r.review || [];
  _concilReview = review.map((item, i) => ({
    idx: item.idx != null ? item.idx : i,
    estado: item.estado,
    fecha: item.fecha,
    descripcion: item.descripcion,
    monto: item.monto,
    categoria: item.categoria || '',
    movimiento_id: item.movimiento_id || '',
    tipo: item.tipo || 'expense',
    match_fecha: item.match_fecha || '',
    match_descripcion: item.match_descripcion || '',
    match_monto: item.match_monto || 0,
    match_categoria: item.match_categoria || '',
    decision: item.decision || null  // preservar decisiones ya tomadas
  }));

  const placeholder = $('concilPlaceholder');
  const container   = $('concilReviewContainer');
  if (placeholder) placeholder.style.display = 'none';
  if (container)   container.style.display   = 'block';
  _renderConcilPanel();
}

// ── Panel derecho completo ───────────────────────────────────────────────
function _renderConcilPanel() {
  const container = $('concilReviewContainer');
  if (!container || !_concilResult) return;

  const r           = _concilResult;
  const total       = r.total_movimientos || _concilReview.length;
  const exactos     = r.exactos    || 0;
  const aprox       = r.aproximados|| 0;
  const faltantes   = r.faltantes  || 0;
  const bancoKey    = _inferirBanco(r.banco_detectado, r.cuenta);
  const bancoLabel  = BANCO_LABELS[bancoKey] || bancoKey;
  const bancoColor  = BANCO_COLOR[bancoKey]  || '#64748b';

  const cats    = _data?.combos?.categoriasRaw || [];
  const cuentas = _data?.combos?.cuentas       || [];

  const pendAprox = _concilReview.filter(it => it.estado === 'aproximado' && it.decision === null);
  const pendFalt  = _concilReview.filter(it => it.estado === 'faltante'   && it.decision === null);
  const cuadrados = _concilReview.filter(it => it.estado === 'cuadrado');
  const resueltos = _concilReview.filter(it => it.decision !== null);
  const resCnt    = cuadrados.length + resueltos.length;
  const progPct   = Math.round(resCnt / Math.max(1, total) * 100);
  const todoConcil = pendAprox.length === 0 && pendFalt.length === 0;

  // ─ Header del panel ───────────────────────────────────────────────────
  let html = `
    <div class="card" style="padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:${bancoColor}22;border:1px solid ${bancoColor}44;display:flex;align-items:center;justify-content:center;font-size:16px">
            <i class="fas fa-building-columns" style="color:${bancoColor}"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:700">${esc(bancoLabel)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(r.cuenta || '')}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:18px;font-weight:800;color:var(--text)">${total}</div>
            <div style="font-size:10px;color:var(--text-muted)">total</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:18px;font-weight:800;color:var(--blue)">${exactos}</div>
            <div style="font-size:10px;color:var(--text-muted)">exactos</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:18px;font-weight:800;color:var(--gold)">${aprox}</div>
            <div style="font-size:10px;color:var(--text-muted)">aprox.</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:18px;font-weight:800;color:var(--red)">${faltantes}</div>
            <div style="font-size:10px;color:var(--text-muted)">faltantes</div>
          </div>
        </div>
      </div>
      <!-- barra de progreso -->
      <div style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px">
          <span id="concil-res-txt">${resCnt} de ${total} resueltos</span>
          <span id="concil-prog-txt" style="font-weight:600;color:${todoConcil?'var(--emerald)':'var(--text)'}">${progPct}%</span>
        </div>
        <div style="height:4px;background:var(--surface3);border-radius:4px;overflow:hidden">
          <div id="concil-prog-bar" style="height:100%;width:${progPct}%;background:${todoConcil?'var(--emerald)':'var(--blue)'};transition:width .4s"></div>
        </div>
      </div>
    </div>`;

  // ─ Estado completo ────────────────────────────────────────────────────
  if (todoConcil) {
    html += `
      <div class="card" style="padding:28px;text-align:center">
        <i class="fas fa-circle-check" style="font-size:36px;color:var(--emerald);display:block;margin-bottom:12px"></i>
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">¡Todo conciliado!</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
          ${cuadrados.length} exactos · ${resueltos.filter(i=>i.decision==='match').length} confirmados · ${resueltos.filter(i=>i.decision==='registrar').length} guardados · ${resueltos.filter(i=>i.decision==='skip').length} ignorados
        </div>
        <button class="btn btn-primary" onclick="refreshSection()"><i class="fas fa-rotate-right"></i> Actualizar</button>
      </div>`;
    _checkConcilCompleto();
    container.innerHTML = html;
    return;
  }

  // ─ Tabla unificada de revisión ────────────────────────────────────────
  html += `<div class="card" style="padding:0;overflow:hidden">`;

  // Toolbar
  if (pendAprox.length > 0) {
    html += `
      <div id="concil-sec-aprox" style="padding:10px 14px;background:rgba(245,166,35,.06);border-bottom:1px solid rgba(245,166,35,.15);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="font-size:12px;font-weight:600;color:var(--gold)">
          <i class="fas fa-circle-question"></i> <span id="concil-cnt-aprox">${pendAprox.length}</span> coincidencias aproximadas <span style="font-weight:400;opacity:.7">— ±3 días y ±5% de monto</span>
        </div>
        <button class="btn btn-ghost btn-sm" style="color:var(--gold);border-color:rgba(245,166,35,.4);font-size:11px" onclick="_concilConfirmarTodosAprox()">
          <i class="fas fa-check-double"></i> Confirmar todos
        </button>
      </div>`;
  }

  // Filas de aproximados
  pendAprox.forEach(item => {
    const diffF = item.match_fecha && item.match_fecha !== item.fecha
      ? ` <span style="opacity:.6;font-size:10px">(hoja: ${esc(item.match_fecha)})</span>` : '';
    const diffM = item.match_monto && item.match_monto !== item.monto
      ? `<div style="font-size:10px;color:var(--text-muted)">En hoja: ${COP.format(item.match_monto)}</div>` : '';
    const matchD = item.match_descripcion
      ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">"${esc(item.match_descripcion.slice(0,50))}"</div>` : '';

    html += `
      <div id="concil-row-${item.idx}" style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);transition:background .15s" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
        <div>
          <div style="font-size:13px;font-weight:600">${esc(item.descripcion)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(item.fecha)}${diffF}${matchD}</div>
          ${diffM}
        </div>
        <div class="mono" style="font-size:14px;font-weight:700;color:var(--gold);white-space:nowrap">${COP.format(item.monto)}</div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-primary btn-sm" onclick="_concilItemDecision(${item.idx},'match')" title="Confirmar: es el mismo movimiento">
            <i class="fas fa-check"></i> Sí
          </button>
          <button class="btn btn-ghost btn-sm" style="padding:5px 8px" onclick="_concilItemDecision(${item.idx},'no_match')" title="No coincide — mover a faltantes">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
      </div>`;
  });

  // Separador faltantes con acciones masivas por patrón
  if (pendFalt.length > 0) {
    // Detectar grupos de descripción repetida (≥2 ocurrencias)
    const descCount = {};
    pendFalt.forEach(it => {
      const key = it.descripcion.slice(0, 40);
      descCount[key] = (descCount[key] || 0) + 1;
    });
    const gruposRepetidos = Object.entries(descCount).filter(([,cnt]) => cnt >= 2).slice(0, 4);

    // Detectar si hay transfers pendientes para importar en batch
    const transfersPend = pendFalt.filter(it => it.tipo === 'transfer').length;
    const gravamenPend  = pendFalt.filter(it => /gravamen/i.test(it.descripcion)).length;

    let batchBtns = '';
    if (transfersPend > 1)
      batchBtns += `<button class="btn btn-ghost btn-sm" style="color:var(--blue);border-color:rgba(59,130,246,.4);font-size:11px" onclick="_concilImportarPorTipo('transfer')"><i class="fas fa-arrow-right-arrow-left"></i> Importar ${transfersPend} transfers</button>`;
    if (gravamenPend > 1)
      batchBtns += `<button class="btn btn-ghost btn-sm" style="color:var(--text-muted);border-color:var(--border);font-size:11px" onclick="_concilIgnorarPorPatron('gravamen')"><i class="fas fa-ban"></i> Ignorar ${gravamenPend} gravámenes</button>`;
    gruposRepetidos.forEach(([desc, cnt]) => {
      const label = desc.length > 22 ? desc.slice(0, 22) + '…' : desc;
      batchBtns += `<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="_concilIgnorarPorPatron(${JSON.stringify(desc.slice(0,30))})"><i class="fas fa-ban"></i> Ignorar "${label}" (${cnt})</button>`;
    });

    html += `
      <div id="concil-sec-falt" style="padding:10px 14px;background:rgba(255,77,109,.06);border-top:${pendAprox.length?'1px solid rgba(255,77,109,.15)':'none'};border-bottom:1px solid rgba(255,77,109,.15)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="font-size:12px;font-weight:600;color:var(--red)">
            <i class="fas fa-triangle-exclamation"></i> <span id="concil-cnt-falt">${pendFalt.length}</span> no están en tus registros
          </div>
          <button class="btn btn-ghost btn-sm" style="color:var(--red);border-color:rgba(255,77,109,.4);font-size:11px" onclick="_concilIgnorarTodosFaltantes()">
            <i class="fas fa-ban"></i> Ignorar todos
          </button>
        </div>
        ${batchBtns ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${batchBtns}</div>` : ''}
      </div>`;
  }

  // Filas de faltantes — compactas con formulario inline desplegable
  pendFalt.forEach(item => {
    const defTipo = item.tipo === 'income' ? 'Ingreso' : item.tipo === 'transfer' ? 'Transferencia' : 'Egreso';
    const tipoOpts = ['Egreso','Ingreso','Transferencia'].map(t =>
      `<option value="${t}"${t===defTipo?' selected':''}>${t}</option>`).join('');
    const catOptsItem = cats.map(c =>
      `<option value="${esc(c.name)}"${c.name===item.categoria?' selected':''}>${esc((c.icon||'')+' '+c.name)}</option>`).join('');
    const cuentaOpts = cuentas.map(c =>
      `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    html += `
      <div id="concil-row-${item.idx}" style="border-bottom:1px solid var(--border)">
        <!-- fila resumen -->
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 14px;cursor:pointer;transition:background .15s"
          onclick="concilToggleForm(${item.idx})"
          onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(item.descripcion)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(item.fecha)}</div>
          </div>
          <div class="mono" style="font-size:14px;font-weight:700;color:var(--red);white-space:nowrap">${COP.format(item.monto)}</div>
          <div style="display:flex;gap:5px;flex-shrink:0" onclick="event.stopPropagation()">
            <button class="btn btn-primary btn-sm" onclick="concilToggleForm(${item.idx})" id="cBtnAbrir-${item.idx}" title="Registrar este movimiento">
              <i class="fas fa-plus"></i> Registrar
            </button>
            <button class="btn btn-ghost btn-sm" style="padding:5px 8px" onclick="_concilItemDecision(${item.idx},'skip')" title="Ignorar">
              <i class="fas fa-ban"></i>
            </button>
          </div>
        </div>
        <!-- formulario desplegable -->
        <div id="cForm-${item.idx}" style="display:none;padding:0 14px 12px;background:rgba(255,77,109,.03)">
          <div style="display:grid;grid-template-columns:repeat(3,1fr) auto;gap:8px;align-items:end">
            <div>
              <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">Tipo</label>
              <select id="cTipo-${item.idx}" class="form-select" style="font-size:12px;padding:6px 8px">${tipoOpts}</select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">Cuenta</label>
              <select id="cCuenta-${item.idx}" class="form-select" style="font-size:12px;padding:6px 8px">${cuentaOpts}</select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">Categoría</label>
              <select id="cCat-${item.idx}" class="form-select" style="font-size:12px;padding:6px 8px">${catOptsItem}</select>
            </div>
            <button id="cBtn-${item.idx}" class="btn btn-primary btn-sm" style="height:34px;white-space:nowrap" onclick="_concilItemDecision(${item.idx},'registrar')">
              <i class="fas fa-check"></i> Guardar
            </button>
          </div>
          <div style="margin-top:6px">
            <input type="text" id="cDesc-${item.idx}" class="form-input" style="font-size:12px;padding:6px 8px" value="${esc(item.descripcion)}" placeholder="Descripción">
          </div>
        </div>
      </div>`;
  });

  // Resueltos colapsables
  const yaResueltos = [...cuadrados, ...resueltos];
  if (yaResueltos.length > 0) {
    const RLBL = { cuadrado:'Exacto', match:'Confirmado', registrar:'Guardado', skip:'Ignorado' };
    const RCLR = { cuadrado:'var(--blue)', match:'var(--emerald)', registrar:'var(--emerald)', skip:'var(--text-dim)' };
    html += `
      <details style="border-top:1px solid var(--border)">
        <summary style="padding:10px 14px;font-size:11px;color:var(--text-muted);cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;user-select:none">
          <i class="fas fa-chevron-right" style="font-size:9px"></i>
          ${yaResueltos.length} ya resueltos
        </summary>
        <div>`;
    yaResueltos.forEach(item => {
      const lbl = RLBL[item.decision || item.estado] || item.estado;
      const clr = RCLR[item.decision || item.estado] || 'var(--text-muted)';
      html += `
          <div style="display:grid;grid-template-columns:80px 1fr auto auto;gap:8px;align-items:center;padding:7px 14px;border-top:1px solid var(--border);opacity:.65;font-size:12px">
            <span style="font-weight:600;color:${clr}">${lbl}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.descripcion)}</span>
            <span class="mono" style="color:var(--text-muted)">${COP.format(item.monto)}</span>
            <span style="color:var(--text-muted)">${esc(item.fecha)}</span>
          </div>`;
    });
    html += `</div></details>`;
  }

  html += `</div>`; // .card

  container.innerHTML = html;

  // Animar chevron details
  container.querySelectorAll('details').forEach(d => {
    d.addEventListener('toggle', () => {
      const ic = d.querySelector('summary i');
      if (ic) ic.style.transform = d.open ? 'rotate(90deg)' : '';
    });
  });
}

// Abrir / cerrar formulario de faltante inline
function concilToggleForm(idx) {
  const form    = $(`cForm-${idx}`);
  const btnAbrir = $(`cBtnAbrir-${idx}`);
  if (!form) return;
  const abierto = form.style.display !== 'none';
  form.style.display = abierto ? 'none' : 'block';
  if (btnAbrir) btnAbrir.innerHTML = abierto
    ? '<i class="fas fa-plus"></i> Registrar'
    : '<i class="fas fa-chevron-up"></i> Cerrar';
}

// ── Quitar fila del DOM sin re-renderizar todo el panel ─────────────────
function _concilRemoveRow(idx) {
  const row = $(`concil-row-${idx}`);
  if (!row) return;
  row.style.transition = 'opacity .2s, max-height .25s';
  row.style.overflow = 'hidden';
  row.style.opacity = '0';
  row.style.maxHeight = row.offsetHeight + 'px';
  setTimeout(() => { row.style.maxHeight = '0'; row.style.padding = '0'; }, 20);
  setTimeout(() => { row.remove(); _concilActualizarContadores(); _checkConcilCompleto(); }, 260);
}

// Actualizar solo los contadores del header sin re-renderizar todo
function _concilActualizarContadores() {
  const pendAprox = _concilReview.filter(it => it.estado === 'aproximado' && it.decision === null).length;
  const pendFalt  = _concilReview.filter(it => it.estado === 'faltante'   && it.decision === null).length;
  const total     = _concilResult?.total_movimientos || _concilReview.length;
  const resCnt    = _concilReview.filter(it => it.estado === 'cuadrado' || it.decision !== null).length;
  const progPct   = Math.round(resCnt / Math.max(1, total) * 100);
  const todoConcil = pendAprox === 0 && pendFalt === 0;

  // Actualizar badges de conteo si existen en el DOM
  const elAprox = $('concil-cnt-aprox'); if (elAprox) elAprox.textContent = pendAprox;
  const elFalt  = $('concil-cnt-falt');  if (elFalt)  elFalt.textContent  = pendFalt;
  const elProg  = $('concil-prog-bar');
  if (elProg) {
    elProg.style.width = progPct + '%';
    elProg.style.background = todoConcil ? 'var(--emerald)' : 'var(--blue)';
  }
  const elProgTxt = $('concil-prog-txt'); if (elProgTxt) elProgTxt.textContent = progPct + '%';
  const elResTxt  = $('concil-res-txt');  if (elResTxt)  elResTxt.textContent  = resCnt + ' de ' + total + ' resueltos';

  // Ocultar sección de aprox si ya no hay pendientes
  const secAprox = $('concil-sec-aprox'); if (secAprox) secAprox.style.display = pendAprox === 0 ? 'none' : '';
  const secFalt  = $('concil-sec-falt');  if (secFalt)  secFalt.style.display  = pendFalt  === 0 ? 'none' : '';

  if (todoConcil) _renderConcilPanel(); // render final limpio con estado completo
}

// Confirmar todos los aproximados — UNA sola llamada batch al servidor
function _concilConfirmarTodosAprox() {
  const stmtId = _concilResult?.statement_id || '';
  const items = _concilReview.filter(it => it.estado === 'aproximado' && it.decision === null);
  items.forEach(it => { it.decision = 'match'; });
  _concilPersistirReview();
  // Una sola llamada con todos los IDs
  const movIds = items.map(it => it.movimiento_id).filter(Boolean);
  if (movIds.length && stmtId) {
    google.script.run.marcarMovimientosBatchUI(movIds, stmtId, 'conciliado');
  }
  _renderConcilPanel();
  _checkConcilCompleto();
}

// Ignorar todos los faltantes
function _concilIgnorarTodosFaltantes() {
  _concilReview.filter(it => it.estado === 'faltante' && it.decision === null).forEach(it => { it.decision = 'skip'; });
  _concilPersistirReview();
  _renderConcilPanel();
  _checkConcilCompleto();
}

// Ignorar todos los faltantes que coincidan con un patrón de descripción
function _concilIgnorarPorPatron(patron) {
  const re = new RegExp(patron, 'i');
  let cnt = 0;
  _concilReview.filter(it => it.estado === 'faltante' && it.decision === null && re.test(it.descripcion))
    .forEach(it => { it.decision = 'skip'; cnt++; });
  if (cnt) { toast(cnt + ' movimientos ignorados', 'success'); _concilPersistirReview(); _renderConcilPanel(); _checkConcilCompleto(); }
}

// Importar en batch todos los faltantes de un tipo dado (ej: todos los 'transfer')
function _concilImportarPorTipo(tipo) {
  const stmtId = _concilResult?.statement_id || '';
  const cuenta  = _data?.combos?.cuentas?.[0] || '';
  const items = _concilReview.filter(it => it.estado === 'faltante' && it.decision === null && it.tipo === tipo);
  if (!items.length) return;

  const tipoLabel = tipo === 'income' ? 'Ingreso' : tipo === 'transfer' ? 'Transferencia' : 'Egreso';
  const catDefault = tipo === 'transfer' ? 'Transferencia' : tipo === 'income' ? 'Otros' : 'Otros';

  const txns = items.map(it => ({
    _idx: it.idx,
    tipo: tipoLabel,
    fecha: it.fecha, monto: it.monto, categoria: catDefault,
    cuenta, descripcion: it.descripcion,
    statementId: stmtId, estadoConciliacion: 'importado_desde_extracto',
    fuente: 'conciliacion_pdf', notas: 'Importado en batch desde extracto PDF'
  }));

  toast('Importando ' + txns.length + ' movimientos...', 'info');
  google.script.run
    .withSuccessHandler(res => {
      if (res && res.ok) {
        res.resultados.forEach(r => {
          const it = _concilReview.find(x => x.idx === r.idx);
          if (it) { it.decision = r.ok ? 'registrar' : 'skip'; it.movimiento_id = r.id || ''; }
        });
        toast(txns.length + ' movimientos importados ✓', 'success');
        _concilPersistirReview(); _renderConcilPanel(); _checkConcilCompleto();
      }
    })
    .withFailureHandler(err => toast('Error batch: ' + (err.message || err), 'error'))
    .guardarTransaccionesBatchUI(txns);
}

// Decisión por índice — actualiza solo la fila, sin re-render completo
function _concilItemDecision(idx, action) {
  const item = _concilReview.find(it => it.idx === idx);
  if (!item) return;
  const stmtId = _concilResult?.statement_id || '';

  if (action === 'match') {
    item.decision = 'match';
    if (item.movimiento_id && stmtId)
      google.script.run.marcarMovimientoConciliadoUI(item.movimiento_id, stmtId, 'conciliado');
    _concilPersistirReview();
    _concilRemoveRow(idx); return;
  }
  if (action === 'skip') {
    item.decision = 'skip';
    _concilPersistirReview();
    _concilRemoveRow(idx); return;
  }
  if (action === 'no_match') {
    item.estado = 'faltante';
    item.decision = null;
    _concilPersistirReview();
    _renderConcilPanel(); return;
  }
  if (action === 'registrar') {
    const tipo   = $(`cTipo-${idx}`)?.value   || 'Egreso';
    const cuenta = $(`cCuenta-${idx}`)?.value || '';
    const cat    = $(`cCat-${idx}`)?.value    || 'Otros';
    const desc   = $(`cDesc-${idx}`)?.value   || item.descripcion;
    if (!cuenta) { toast('Selecciona una cuenta', 'error'); return; }

    const btn = $(`cBtn-${idx}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    google.script.run
      .withSuccessHandler(res => {
        if (res && res.ok) {
          item.decision = 'registrar';
          item.movimiento_id = res.id || '';
          if (res.id && stmtId)
            google.script.run.marcarMovimientoConciliadoUI(res.id, stmtId, 'importado_desde_extracto');
          toast('Guardado ✓', 'success');
          _concilPersistirReview();
          _concilRemoveRow(idx); _checkConcilCompleto();
        } else {
          toast('Error: ' + (res?.error || 'desconocido'), 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Guardar'; }
        }
      })
      .withFailureHandler(err => {
        toast('Error: ' + (err.message || err), 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Guardar'; }
      })
      .guardarTransaccion({
        tipo, fecha: item.fecha, monto: item.monto, categoria: cat,
        cuenta, descripcion: desc, statementId: stmtId,
        estadoConciliacion: 'importado_desde_extracto',
        fuente: 'conciliacion_pdf', notas: 'Importado desde extracto PDF'
      });
  }
}

// Persiste el estado actual del review en la hoja para evitar duplicados al reabrir
let _persistTimer = null;
function _concilPersistirReview() {
  if (!_concilResult?.statement_id) return;
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    const reviewData = _concilReview.map(it => ({
      idx: it.idx, estado: it.estado, fecha: it.fecha,
      descripcion: it.descripcion, monto: it.monto,
      movimiento_id: it.movimiento_id || '', decision: it.decision,
      match_fecha: it.match_fecha || '', match_descripcion: it.match_descripcion || '',
      match_monto: it.match_monto || 0, match_categoria: it.match_categoria || '',
      tipo: it.tipo || '', categoria: it.categoria || ''
    }));
    google.script.run
      .actualizarReviewExtractoUI(_concilResult.statement_id, JSON.stringify(reviewData));
  }, 800); // debounce 800ms para no llamar en cada click rápido
}

function _checkConcilCompleto() {
  const pendientes = _concilReview.filter(it => it.estado !== 'cuadrado' && it.decision === null);
  if (pendientes.length === 0 && _concilResult?.statement_id) {
    _concilReview.filter(it => it.estado === 'cuadrado' && it.movimiento_id).forEach(it => {
      google.script.run.marcarMovimientoConciliadoUI(it.movimiento_id, _concilResult.statement_id, 'cuadrado');
    });
    google.script.run.actualizarEstadoHistorialUI(_concilResult.statement_id, 'conciliado');
    setTimeout(() => loadHistorialExtractos(), 800);
  }
}

// ── Historial lateral (lista de extractos procesados, agrupado por mes) ──
function loadHistorialExtractos() {
  const el = $('historialExtractosContent');
  if (!el) return;
  el.innerHTML = `<div style="padding:20px;text-align:center"><div class="loader-ring" style="width:20px;height:20px;border-width:2px;margin:0 auto"></div></div>`;

  google.script.run
    .withSuccessHandler(lista => {
      console.log('[historial] datos recibidos:', JSON.stringify(lista && lista.slice(0,3)));
      if (!lista || lista.length === 0) {
        el.innerHTML = `<div style="padding:32px 16px;text-align:center">
          <i class="fas fa-file-invoice" style="font-size:28px;opacity:.2;display:block;margin-bottom:8px"></i>
          <div style="font-size:12px;color:var(--text-muted)">Sin extractos procesados</div>
          <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="concilAbrirUpload()"><i class="fas fa-plus"></i> Subir primero</button>
        </div>`;
        return;
      }

      const BANCO_COLOR_MAP = { nu:'#8b5cf6', nequi:'#8b5cf6', bancolombia:'#f5a623', davivienda:'#ff4d6d', bbva:'#3b82f6', avvillas:'#00d4aa', bogota:'#3b82f6', scotiabank:'#ff4d6d', generico:'#64748b', desconocido:'#64748b' };
      const ESTADO_DOT   = { conciliado:'var(--emerald)', pendiente_revision:'var(--gold)', error:'var(--red)' };
      const ESTADO_LABEL = { conciliado:'Conciliado', pendiente_revision:'En revisión', error:'Error' };
      const MES_NOMBRES  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

      // Agrupar por mes/año de fecha_procesado
      const grupos = {};
      lista.forEach((h, i) => {
        h._idx = i;
        const fecha = h.fecha_procesado ? h.fecha_procesado.slice(0,7) : '0000-00'; // 'yyyy-MM'
        if (!grupos[fecha]) grupos[fecha] = [];
        grupos[fecha].push(h);
      });
      const mesKeys = Object.keys(grupos).sort((a,b) => b.localeCompare(a)); // más reciente primero

      let html = '';
      mesKeys.forEach(mesKey => {
        const [anio, mes] = mesKey.split('-');
        const mesLabel = mes && parseInt(mes) ? `${MES_NOMBRES[parseInt(mes)-1]} ${anio}` : 'Sin fecha';
        const itemsDeMes = grupos[mesKey];

        html += `<div style="padding:6px 14px 4px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;background:var(--surface);border-bottom:1px solid var(--border)">${esc(mesLabel)}</div>`;

        itemsDeMes.forEach(h => {
          const i      = h._idx;
          const { banco, label: bLabel, cuenta: cuentaLabel } = _labelHistorialItem(h);
          const bColor = BANCO_COLOR_MAP[banco] || '#64748b';
          const dotClr = ESTADO_DOT[h.estado_final]  || 'var(--text-muted)';
          const stLabel= ESTADO_LABEL[h.estado_final] || h.estado_final;
          const hasPend= (h.aproximados||0)+(h.faltantes||0) > 0 && h.estado_final !== 'conciliado';
          const isActive = _concilResult && _concilResult.statement_id === h.statement_id;

          const stmtIdEsc = esc(h.statement_id);
          html += `
            <div class="concil-hist-row${isActive?' concil-hist-active':''}"
              data-idx="${i}"
              style="position:relative;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s;${isActive?'background:var(--surface2);border-left:3px solid var(--blue);padding-left:11px;':'border-left:3px solid transparent;'}">
              <div onclick="concilCargarHistorialItem(${i})" style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                <div style="width:8px;height:8px;border-radius:50%;background:${bColor};flex-shrink:0"></div>
                <div style="font-size:12px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(bLabel)}</div>
                <div style="width:7px;height:7px;border-radius:50%;background:${dotClr};flex-shrink:0" title="${esc(stLabel)}"></div>
              </div>
              <div onclick="concilCargarHistorialItem(${i})" style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px;padding-left:16px">${esc(cuentaLabel)}</div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding-left:16px">
                <div onclick="concilCargarHistorialItem(${i})" style="font-size:10px;color:var(--text-dim);flex:1">${esc((h.fecha_procesado||'').slice(0,10))}</div>
                <div style="display:flex;gap:5px;align-items:center">
                  <span style="font-size:10px;color:var(--blue)">${h.total_movimientos||0} mov</span>
                  ${hasPend ? `<span style="font-size:10px;padding:1px 5px;border-radius:20px;background:rgba(245,166,35,.15);color:var(--gold)">${(h.aproximados||0)+(h.faltantes||0)} pend</span>` : ''}
                  ${h.estado_final==='conciliado' ? `<i class="fas fa-check" style="font-size:10px;color:var(--emerald)"></i>` : ''}
                  <button class="hist-del-btn" onclick="event.stopPropagation();concilEliminarHistorial('${stmtIdEsc}')"
                    style="display:none;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0 2px;font-size:11px;opacity:.6;line-height:1" title="Eliminar">✕</button>
                </div>
              </div>
            </div>`;
        });
      });

      el.innerHTML = html;
      el._lista = lista;

      el.querySelectorAll('.concil-hist-row').forEach(row => {
        const delBtn = row.querySelector('.hist-del-btn');
        row.addEventListener('mouseenter', () => {
          if (!row.classList.contains('concil-hist-active')) row.style.background = 'var(--surface2)';
          if (delBtn) delBtn.style.display = 'inline';
        });
        row.addEventListener('mouseleave', () => {
          if (!row.classList.contains('concil-hist-active')) row.style.background = '';
          if (delBtn) delBtn.style.display = 'none';
        });
      });
    })
    .withFailureHandler(err => {
      console.error('[historial] error:', err);
      if (el) el.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--red)">Error: ${esc(err?.message || String(err))}</div>`;
    })
    .getHistorialExtractosUI(80);
}

// Limpiar duplicados del historial (mismo banco + total_movimientos + día)
function concilLimpiarDuplicados() {
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  google.script.run
    .withSuccessHandler(r => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-broom"></i>'; }
      if (r && r.ok) {
        toast(r.eliminados > 0 ? `${r.eliminados} duplicados eliminados` : 'Sin duplicados', r.eliminados > 0 ? 'success' : 'info');
        loadHistorialExtractos();
      }
    })
    .withFailureHandler(err => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-broom"></i>'; }
      toast('Error: ' + (err?.message || err), 'error');
    })
    .limpiarDuplicadosHistorialUI();
}

// Eliminar un extracto del historial
function concilEliminarHistorial(stmtId) {
  if (!stmtId) return;
  if (!confirm('¿Eliminar este extracto del historial? No se eliminan los movimientos ya registrados.')) return;
  google.script.run
    .withSuccessHandler(r => {
      if (r && r.ok) { toast('Eliminado', 'success'); loadHistorialExtractos(); }
      else toast('No se pudo eliminar', 'error');
    })
    .withFailureHandler(err => toast('Error: ' + (err.message || err), 'error'))
    .eliminarHistorialExtractoUI(stmtId);
}

// Cargar un extracto del historial al panel derecho (re-abre para revisión)
function concilCargarHistorialItem(idx) {
  const el = $('historialExtractosContent');
  if (!el || !el._lista) return;
  const h = el._lista[idx];
  if (!h) return;

  // Marcar activo en la lista
  el.querySelectorAll('.concil-hist-row').forEach(r => {
    r.classList.remove('concil-hist-active');
    r.style.background = '';
    r.style.borderLeft = '3px solid transparent';
    r.style.paddingLeft = '';
  });
  const activeRow = el.querySelector(`[data-idx="${idx}"]`);
  if (activeRow) {
    activeRow.classList.add('concil-hist-active');
    activeRow.style.background = 'var(--surface2)';
    activeRow.style.borderLeft = '3px solid var(--blue)';
    activeRow.style.paddingLeft = '11px';
  }

  // Si ya hay revisión activa con este mismo statement, re-render
  if (_concilResult && _concilResult.statement_id === h.statement_id && _concilReview.length > 0) {
    const placeholder = $('concilPlaceholder');
    const container   = $('concilReviewContainer');
    if (placeholder) placeholder.style.display = 'none';
    if (container)   container.style.display   = 'block';
    _renderConcilPanel();
    return;
  }

  // Si está conciliado — mostrar resumen estático
  if (h.estado_final === 'conciliado') {
    const placeholder = $('concilPlaceholder');
    const container   = $('concilReviewContainer');
    if (placeholder) placeholder.style.display = 'none';
    if (container) {
      container.style.display = 'block';
      const bKey = _inferirBanco(h.banco_detectado, h.cuenta);
      container.innerHTML = `
        <div class="card" style="padding:20px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <i class="fas fa-circle-check" style="font-size:20px;color:var(--emerald)"></i>
            <div>
              <div style="font-size:14px;font-weight:700">${esc(BANCO_LABELS[bKey]||bKey)} — ${esc(h.cuenta)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${esc((h.fecha_procesado||'').slice(0,10))} · Conciliado</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;text-align:center">
            <div><div style="font-size:20px;font-weight:800">${h.total_movimientos||0}</div><div style="font-size:11px;color:var(--text-muted)">Total</div></div>
            <div><div style="font-size:20px;font-weight:800;color:var(--blue)">${h.exactos||0}</div><div style="font-size:11px;color:var(--text-muted)">Exactos</div></div>
            <div><div style="font-size:20px;font-weight:800;color:var(--emerald)">${h.importados||0}</div><div style="font-size:11px;color:var(--text-muted)">Importados</div></div>
            <div><div style="font-size:20px;font-weight:800;color:var(--gold)">${h.aproximados||0}</div><div style="font-size:11px;color:var(--text-muted)">Aprox.</div></div>
          </div>
        </div>`;
    }
    return;
  }

  // Si está pendiente o error — intentar cargar el review guardado primero
  const placeholder = $('concilPlaceholder');
  const container   = $('concilReviewContainer');
  if (placeholder) placeholder.style.display = 'none';
  if (container) {
    container.style.display = 'block';
    const bKey = _inferirBanco(h.banco_detectado, h.cuenta);
    // Mostrar spinner mientras buscamos el review guardado
    container.innerHTML = `<div class="card" style="padding:32px;text-align:center">
      <div class="loader-ring" style="width:24px;height:24px;border-width:2px;margin:0 auto 12px"></div>
      <div style="font-size:12px;color:var(--text-muted)">Cargando revisión...</div>
    </div>`;

    google.script.run
      .withSuccessHandler(r => {
        if (r && (r.ok || r.review)) {
          // Tenemos el review guardado — cargarlo directamente
          _concilMostrarResultado(r);
        } else {
          // No hay review guardado — mostrar opción de re-subir
          const dotColor = h.estado_final === 'error' ? 'var(--red)' : 'var(--gold)';
          const dotLabel = h.estado_final === 'error' ? 'Error al procesar' : 'Pendiente de revisión';
          container.innerHTML = `
            <div class="card" style="padding:24px;text-align:center">
              <i class="fas fa-${h.estado_final==='error'?'circle-xmark':'clock'}" style="font-size:32px;color:${dotColor};display:block;margin-bottom:12px"></i>
              <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(BANCO_LABELS[bKey]||bKey)} — ${esc(h.cuenta)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${dotLabel} · ${esc((h.fecha_procesado||'').slice(0,10))}</div>
              <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px;line-height:1.6">
                Este extracto fue procesado antes de que se guardara la revisión.<br>
                Sube el PDF de nuevo para continuar — los movimientos ya registrados no se duplicarán.
              </p>
              <button class="btn btn-primary" onclick="concilAbrirUpload()">
                <i class="fas fa-upload"></i> Subir PDF de nuevo
              </button>
            </div>`;
        }
      })
      .withFailureHandler(() => {
        container.innerHTML = `<div class="card" style="padding:24px;text-align:center">
          <div style="font-size:13px;color:var(--text-muted)">No se pudo cargar la revisión.</div>
          <button class="btn btn-primary" style="margin-top:16px" onclick="concilAbrirUpload()">
            <i class="fas fa-upload"></i> Subir PDF de nuevo
          </button>
        </div>`;
      })
      .cargarReviewExtractoUI(h.statement_id);
  }
}

// ═══════════════════════════════════════════════════════
// ALERTAS INTELIGENTES — Panel en tiempo real
// ═══════════════════════════════════════════════════════
function loadAlertasPanel() {
  const el = $('alertasContent');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><div class="loader-ring" style="width:24px;height:24px;border-width:2px"></div></div>';

  google.script.run
    .withSuccessHandler(alertas => {
      renderAlertasPanel(alertas);
    })
    .withFailureHandler(e => {
      if (el) el.innerHTML = '<div class="empty-state"><p>Error cargando alertas</p></div>';
    })
    .getAlertasActivasUI();
}

function renderAlertasPanel(alertas) {
  const el = $('alertasContent');
  if (!el) return;
  if (!alertas || !alertas.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-shield-check" style="color:var(--emerald)"></i><p>Sin alertas activas</p></div>';
    return;
  }

  const nivelesIcon = {
    critica: { icon: 'fa-circle-xmark', color: 'var(--red)', bg: 'rgba(255,77,109,.08)', border: 'rgba(255,77,109,.25)' },
    advertencia: { icon: 'fa-triangle-exclamation', color: 'var(--gold)', bg: 'rgba(245,166,35,.08)', border: 'rgba(245,166,35,.25)' },
    info: { icon: 'fa-circle-info', color: 'var(--blue)', bg: 'rgba(59,130,246,.08)', border: 'rgba(59,130,246,.25)' },
    exito: { icon: 'fa-circle-check', color: 'var(--emerald)', bg: 'rgba(0,212,170,.08)', border: 'rgba(0,212,170,.25)' }
  };

  el.innerHTML = alertas.map(a => {
    const cfg = nivelesIcon[a.nivel] || nivelesIcon.info;
    return `
      <div style="border:1px solid ${cfg.border};background:${cfg.bg};border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <i class="fas ${cfg.icon}" style="color:${cfg.color};font-size:16px;margin-top:2px;flex-shrink:0"></i>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px">${esc(a.titulo || '')}</div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.5">${esc(a.mensaje || '')}</div>
            ${a.accion ? `<div style="margin-top:8px;font-size:11px;padding:5px 8px;background:rgba(255,255,255,.05);border-radius:5px;color:var(--text)"><i class="fas fa-arrow-right" style="font-size:9px;margin-right:4px"></i>${esc(a.accion)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// CATEGORIZACIÓN IA MASIVA
// ═══════════════════════════════════════════════════════
function categorizarConIA() {
  toast('Categorizando movimientos sin categoría...', 'info');
  google.script.run
    .withSuccessHandler(r => {
      if (r.ok) {
        if (r.categorizados === 0) {
          toast(r.mensaje || 'Todos los movimientos ya tienen categoría', 'info');
        } else {
          toast(`IA categorizó ${r.categorizados} de ${r.total} movimientos`, 'success');
          refreshSection();
        }
      } else {
        toast('Error: ' + (r.error || 'No se pudo categorizar'), 'error');
      }
    })
    .withFailureHandler(e => toast('Error: ' + e.message, 'error'))
    .categorizarMovimientosUI();
}

// ═══════════════════════════════════════════════════════
// PROYECCIÓN FIN DE MES
// ═══════════════════════════════════════════════════════
function loadProyeccion() {
  const el = $('proyeccionContent');
  if (!el) return;

  google.script.run
    .withSuccessHandler(p => {
      if (!p) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sin datos para proyección</p>'; return; }
      const positivo = p.proyeccionAhorro >= 0;
      el.innerHTML = `
        <div style="display:grid;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--surface2);border-radius:8px">
            <span style="font-size:12px;color:var(--text-muted)">Promedio diario</span>
            <span class="mono" style="font-size:14px;font-weight:700;color:var(--red)">${COP.format(p.promedioDiario)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--surface2);border-radius:8px">
            <span style="font-size:12px;color:var(--text-muted)">Proyección gastos fin mes</span>
            <span class="mono" style="font-size:14px;font-weight:700;color:var(--red)">${COP.format(p.proyeccionGastos)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--surface2);border-radius:8px">
            <span style="font-size:12px;color:var(--text-muted)">Ahorro proyectado</span>
            <span class="mono" style="font-size:14px;font-weight:700;color:${positivo?'var(--emerald)':'var(--red)'}">${COP.format(p.proyeccionAhorro)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:${positivo?'rgba(0,212,170,.08)':'rgba(255,77,109,.08)'};border:1px solid ${positivo?'rgba(0,212,170,.2)':'rgba(255,77,109,.2)'};border-radius:8px">
            <span style="font-size:12px;font-weight:600">Tendencia del mes</span>
            <span style="font-size:13px;font-weight:700;color:${positivo?'var(--emerald)':'var(--red)'}">${positivo?'Positiva':'Negativa'} · ${p.diasRestantes} días restantes</span>
          </div>
        </div>`;
    })
    .withFailureHandler(() => {
      if (el) el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Error cargando proyección</p>';
    })
    .proyectarSaldoUI();
}


// ═══════════════════════════════════════════════════════
// AUTO-CARGAR ALERTAS AL INICIO
// ═══════════════════════════════════════════════════════
const _origRefreshData = refreshData;
const refreshDataEnhanced = function(mes) {
  _origRefreshData(mes);
  // Cargar alertas y proyección en paralelo (con delay para no bloquear)
  setTimeout(() => {
    loadAlertasPanel();
    loadProyeccion();
  }, 1200);
};

// Reemplazar al cargar
window.addEventListener('load', () => {
  setTimeout(() => {
    loadAlertasPanel();
    loadProyeccion();
    // Mostrar mensaje de bienvenida en chat si está disponible
    const chatBox = $('chatMessagesIA') || $('chatMessages');
    if (chatBox && !chatBox.children.length) {
      clearChatIA();
    }
  }, 2000);
});

// ═══════════════════════════════════════════════════════
// PANEL INVERSIONES MEJORADO — Gráficos avanzados 2026
// ═══════════════════════════════════════════════════════
function renderInvChart2026(inversiones, porTipo, porBroker) {
  ['invPerf', 'invPerfConcil', 'invWaterfall', 'invAlloc'].forEach(k => {
    if (_charts[k]) { _charts[k].destroy(); delete _charts[k]; }
  });

  if (!inversiones || !inversiones.length) return;

  const sorted = [...inversiones].sort((a,b) => (b.pyg_pct||0) - (a.pyg_pct||0));
  const chartCfg = canvasId => ({
    type: 'bar',
    data: {
      labels: sorted.map(i => (i.activo || i.ticker || '').slice(0,12)),
      datasets: [{
        label: 'Retorno %',
        data: sorted.map(i => parseFloat(i.pyg_pct || i.retorno_pct || 0)),
        backgroundColor: sorted.map(i => (i.pyg_pct || 0) >= 0 ? 'rgba(0,212,170,.7)' : 'rgba(255,77,109,.7)'),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toFixed(2)}%` } },
        datalabels: {
          display: true,
          formatter: v => v.toFixed(1) + '%',
          color: '#e2e8f0',
          font: { size: 11, weight: 600 },
          anchor: 'end', align: 'right'
        }
      },
      scales: {
        x: { ticks: { callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { display: false } }
      }
    }
  });

  // Main investment page chart
  const perfCanvas = $('chartInvPerf');
  if (perfCanvas) _charts.invPerf = new Chart(perfCanvas, chartCfg('chartInvPerf'));

  // Conciliation page chart (separate canvas to avoid duplicate ID conflicts)
  const perfConcil = $('chartInvPerfConcil');
  if (perfConcil) _charts.invPerfConcil = new Chart(perfConcil, chartCfg('chartInvPerfConcil'));
}


// ─── AI Portfolio Analysis ─────────────────────────────
async function loadInvAnalisisIA() {
  const el = $('invAnalisisIA');
  if (!el) return;
  if (!_invData || !_invData.length) {
    el.innerHTML = '<div style="color:var(--text-muted);padding:16px 0">Sin posiciones para analizar.</div>';
    return;
  }
  el.innerHTML = '<div style="text-align:center;padding:20px 0"><i class="fas fa-spinner fa-spin" style="color:var(--purple)"></i> Analizando portafolio con IA...</div>';

  const totalVal   = _invData.reduce((s,i) => s + (parseFloat(i.vr_mercado_actual_base) || 0), 0);
  const totalCost  = _invData.reduce((s,i) => s + (parseFloat(i.valor_inversion_base) || 0), 0);
  const totalPnL   = totalVal - totalCost;
  const pnlPct     = totalCost > 0 ? (totalPnL / totalCost * 100).toFixed(2) : 0;
  const winners    = _invData.filter(i => (parseFloat(i.pyg_pct) || 0) > 0);
  const losers     = _invData.filter(i => (parseFloat(i.pyg_pct) || 0) < 0);
  const topAsset   = [..._invData].sort((a,b) => (parseFloat(b.pyg_pct)||0) - (parseFloat(a.pyg_pct)||0))[0];
  const worstAsset = [..._invData].sort((a,b) => (parseFloat(a.pyg_pct)||0) - (parseFloat(b.pyg_pct)||0))[0];

  const resumen = _invData.map(i =>
    `${i.activo||i.ticker}: P&L ${parseFloat(i.pyg_pct||0).toFixed(1)}%, VR ${fmt(parseFloat(i.vr_mercado_actual_base)||0)}`
  ).join('\n');

  const pregunta = `Soy un inversionista colombiano. Analiza mi portafolio y dame 3-4 insights concretos y accionables:

Portafolio total: ${fmt(totalVal)} COP (${pnlPct}% P&L)
Ganadoras: ${winners.length} activos | Perdedoras: ${losers.length} activos
Mejor: ${topAsset ? topAsset.activo + ' +' + parseFloat(topAsset.pyg_pct||0).toFixed(1) + '%' : 'N/A'}
Peor: ${worstAsset ? worstAsset.activo + ' ' + parseFloat(worstAsset.pyg_pct||0).toFixed(1) + '%' : 'N/A'}

Posiciones:
${resumen}

Dame análisis breve en español, bullet points con emojis, máximo 200 palabras. Incluye: concentración de riesgo, diversificación, qué revisar. Contexto colombiano (CDT, TRM, mercado local).`;

  try {
    const resp = await new Promise((res, rej) =>
      google.script.run
        .withSuccessHandler(res)
        .withFailureHandler(rej)
        .chatFinancieroUI(pregunta, [])
    );
    const txt = (resp && resp.respuesta) ? resp.respuesta : (typeof resp === 'string' ? resp : 'Sin respuesta.');
    el.innerHTML = txt.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red)">Error al analizar. Verifica la API key en Configuracion.</span>';
  }
}

// ═══════════════════════════════════════════════════════
// METAS DE AHORRO
// ═══════════════════════════════════════════════════════
let _metasData = [];

async function loadMetas() {
  const _mcEl = $('metasContent');
  if (_mcEl) _mcEl.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando metas...</p></div>';
  try {
    const metas = await new Promise((res,rej) =>
      google.script.run.withSuccessHandler(res).withFailureHandler(rej).getMetasUI()
    );
    _metasData = metas || [];
    renderMetas(_metasData);
    renderMetaKpis(_metasData);
    renderDashMetas(_metasData);
    // Badge en nav
    const badge = $('metasBadge');
    if (badge) {
      const enProceso = _metasData.filter(m => !m.completada).length;
      badge.textContent = enProceso;
      badge.style.display = enProceso ? 'inline' : 'none';
    }
  } catch(e) {
    const _mcErr = $('metasContent'); if (_mcErr) _mcErr.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle" style="color:var(--red)"></i><p>Error al cargar metas.</p></div>';
  }
}

function renderMetaKpis(metas) {
  const el = $('metaKpis');
  if (!el) return;
  const totalObj   = metas.reduce((s,m) => s + m.monto_objetivo, 0);
  const totalAct   = metas.reduce((s,m) => s + m.monto_actual, 0);
  const completadas = metas.filter(m => m.completada).length;
  el.innerHTML = `
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Metas activas</div>
      <div style="font-size:26px;font-weight:900;color:var(--blue)">${metas.length}</div>
    </div>
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Total ahorrado</div>
      <div style="font-size:22px;font-weight:900;color:var(--emerald)">${fmt(totalAct)}</div>
      <div style="font-size:11px;color:var(--text-muted)">de ${fmt(totalObj)}</div>
    </div>
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Completadas</div>
      <div style="font-size:26px;font-weight:900;color:var(--gold)">${completadas}</div>
    </div>`;
}

function renderDashMetas(metas) {
  const panel = $('dashMetasPanel');
  const el    = $('dashMetasContent');
  if (!panel || !el) return;

  const activas = metas.filter(m => !m.completada).slice(0, 6);
  if (!activas.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  el.innerHTML = activas.map(m => {
    const pct   = Math.min(100, m.progreso_pct || 0);
    const r     = 36;
    const circ  = 2 * Math.PI * r;
    const dash  = ((pct / 100) * circ).toFixed(2);
    const gap   = (circ - dash).toFixed(2);
    const urgent = m.dias_restantes !== null && m.dias_restantes < 30;
    const accentColor = m.completada ? 'var(--emerald)' : urgent ? 'var(--red)' : 'var(--blue)';
    const urgentTag = urgent
      ? `<span style="font-size:10px;color:var(--red);font-weight:600">${m.dias_restantes}d</span>`
      : m.eta_meses !== null
        ? `<span style="font-size:10px;color:var(--muted)">~${m.eta_meses}m</span>`
        : '';

    return `<div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:14px;cursor:pointer" onclick="navigate('metas')">
      <div style="position:relative;flex-shrink:0;width:80px;height:80px">
        <svg width="80" height="80" viewBox="0 0 80 80" style="transform:rotate(-90deg)">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--border)" stroke-width="7"/>
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="${accentColor}" stroke-width="7"
            stroke-dasharray="${dash} ${gap}" stroke-linecap="round"
            style="transition:stroke-dasharray .6s ease"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column">
          <span style="font-size:14px;font-weight:800;line-height:1">${pct.toFixed(0)}%</span>
        </div>
      </div>
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.nombre)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${fmt(m.monto_actual)} / ${fmt(m.monto_objetivo)}</div>
        <div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between">
          ${m.aporte_necesario_mes ? `<span style="font-size:10px;color:var(--text)">${fmt(m.aporte_necesario_mes)}/mes</span>` : '<span></span>'}
          ${urgentTag}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderMetas(metas) {
  const el = $('metasContent');
  if (!el) return;
  if (!metas.length) {
    el.innerHTML = `<div class="empty-state">
      <i class="fas fa-bullseye-arrow"></i>
      <p>No tienes metas aún. Crea tu primera meta de ahorro.</p>
      <button class="btn btn-primary btn-sm" onclick="openNuevaMeta()"><i class="fas fa-plus"></i> Nueva Meta</button>
    </div>`;
    return;
  }
  el.innerHTML = metas.map(m => {
    const pct      = m.progreso_pct || 0;
    const colorClass = pct >= 80 ? 'alta' : pct >= 40 ? '' : 'baja';
    const estadoBadge = m.completada
      ? '<span class="meta-badge" style="background:rgba(0,212,170,.15);color:var(--emerald)">✓ Completada</span>'
      : m.dias_restantes !== null && m.dias_restantes < 30
        ? `<span class="meta-badge" style="background:rgba(255,77,109,.15);color:var(--red)">⚠ ${m.dias_restantes}d</span>`
        : `<span class="meta-badge" style="background:rgba(59,130,246,.12);color:var(--blue)">En progreso</span>`;

    return `
    <div class="meta-card ${m.completada ? 'completada' : ''}">
      <div class="meta-header">
        <div>
          <div class="meta-title">${m.nombre}</div>
          ${m.descripcion ? `<div class="meta-desc">${m.descripcion}</div>` : ''}
        </div>
        ${estadoBadge}
      </div>
      <div class="meta-progress-wrap">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
          <span style="font-weight:700;color:var(--emerald)">${fmt(m.monto_actual)}</span>
          <span style="color:var(--text-muted)">${pct.toFixed(0)}% de ${fmt(m.monto_objetivo)}</span>
        </div>
        <div class="meta-progress-bar">
          <div class="meta-progress-fill ${colorClass}" style="width:${Math.min(100,pct)}%"></div>
        </div>
      </div>
      <div class="meta-stats">
        <div>
          <div class="meta-stat-label">Faltante</div>
          <div class="meta-stat-val" style="color:var(--red)">${fmt(m.faltante)}</div>
        </div>
        <div>
          <div class="meta-stat-label">ETA</div>
          <div class="meta-stat-val">${m.eta_meses !== null ? m.eta_meses + ' meses' : '—'}</div>
        </div>
        <div>
          <div class="meta-stat-label">Cuota necesaria</div>
          <div class="meta-stat-val">${m.aporte_necesario_mes ? fmt(m.aporte_necesario_mes) + '/mes' : '—'}</div>
        </div>
        <div>
          <div class="meta-stat-label">Fecha objetivo</div>
          <div class="meta-stat-val">${m.fecha_objetivo || '—'}</div>
        </div>
      </div>
      <div class="meta-actions">
        <button class="btn btn-ghost btn-sm" onclick="openAportarMeta('${m.meta_id}','${encodeURIComponent(m.nombre)}')">
          <i class="fas fa-plus"></i> Aportar
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openEditarMeta('${m.meta_id}')">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="confirmarEliminarMeta('${m.meta_id}','${encodeURIComponent(m.nombre)}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

function openNuevaMeta() {
  _openFeatModal('modal-meta', `
    <h3><i class="fas fa-bullseye-arrow" style="color:var(--emerald);margin-right:8px"></i>Nueva Meta de Ahorro</h3>
    <div class="form-group"><label class="form-label">Nombre *</label>
      <input id="fm-nombre" class="form-input" placeholder="Ej: Fondo de emergencia"></div>
    <div class="form-group"><label class="form-label">Descripcion</label>
      <input id="fm-desc" class="form-input" placeholder="Opcional"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Monto objetivo (COP) *</label>
        <input id="fm-objetivo" class="form-input" type="number" placeholder="5000000"></div>
      <div class="form-group"><label class="form-label">Ya tengo ahorrado</label>
        <input id="fm-actual" class="form-input" type="number" placeholder="0"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fecha inicio</label>
        <input id="fm-inicio" class="form-input" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="form-group"><label class="form-label">Fecha objetivo</label>
        <input id="fm-fin" class="form-input" type="date"></div>
    </div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-meta')">Cancelar</button>
      <button class="btn btn-primary" onclick="_guardarMetaForm()"><i class="fas fa-save"></i> Guardar</button>
    </div>`);
}

function openAportarMeta(meta_id, nombre) {
  nombre = decodeURIComponent(nombre);
  _openFeatModal('modal-aporte', `
    <h3><i class="fas fa-piggy-bank" style="color:var(--emerald);margin-right:8px"></i>Aportar a: ${nombre}</h3>
    <div class="form-group"><label class="form-label">Monto a aportar (COP)</label>
      <input id="fa-monto" class="form-input" type="number" placeholder="100000" autofocus></div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-aporte')">Cancelar</button>
      <button class="btn btn-primary" onclick="_doAportarMeta('${meta_id}')"><i class="fas fa-plus"></i> Aportar</button>
    </div>`);
}

function openEditarMeta(meta_id) {
  const m = _metasData.find(x => x.meta_id === meta_id);
  if (!m) return;
  _openFeatModal('modal-meta', `
    <h3><i class="fas fa-edit" style="color:var(--blue);margin-right:8px"></i>Editar Meta</h3>
    <input type="hidden" id="fm-id" value="${meta_id}">
    <div class="form-group"><label class="form-label">Nombre</label>
      <input id="fm-nombre" class="form-input" value="${m.nombre}"></div>
    <div class="form-group"><label class="form-label">Descripcion</label>
      <input id="fm-desc" class="form-input" value="${m.descripcion || ''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Monto objetivo</label>
        <input id="fm-objetivo" class="form-input" type="number" value="${m.monto_objetivo}"></div>
      <div class="form-group"><label class="form-label">Monto actual</label>
        <input id="fm-actual" class="form-input" type="number" value="${m.monto_actual}"></div>
    </div>
    <div class="form-group"><label class="form-label">Fecha objetivo</label>
      <input id="fm-fin" class="form-input" type="date" value="${m.fecha_objetivo || ''}"></div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-meta')">Cancelar</button>
      <button class="btn btn-primary" onclick="_guardarMetaForm()"><i class="fas fa-save"></i> Actualizar</button>
    </div>`);
}

async function _guardarMetaForm() {
  const data = {
    meta_id:        $('fm-id')      ? $('fm-id').value      : undefined,
    nombre:         $('fm-nombre').value.trim(),
    descripcion:    $('fm-desc')    ? $('fm-desc').value.trim()    : '',
    monto_objetivo: parseFloat($('fm-objetivo').value) || 0,
    monto_actual:   parseFloat($('fm-actual') ? $('fm-actual').value : 0) || 0,
    fecha_inicio:   $('fm-inicio')  ? $('fm-inicio').value  : '',
    fecha_objetivo: $('fm-fin')     ? $('fm-fin').value     : ''
  };
  if (!data.nombre || !data.monto_objetivo) { toast('Nombre y monto son obligatorios', 'error'); return; }
  _closeFeatModal('modal-meta');
  toast('Guardando meta...', 'info');
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).guardarMetaUI(data));
    toast('Meta guardada', 'success');
    loadMetas();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function _doAportarMeta(meta_id) {
  const monto = parseFloat($('fa-monto').value) || 0;
  if (!monto) { toast('Ingresa un monto', 'error'); return; }
  _closeFeatModal('modal-aporte');
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).aportarMetaUI(meta_id, monto));
    toast('Aporte registrado', 'success');
    loadMetas();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function confirmarEliminarMeta(meta_id, nombre) {
  nombre = decodeURIComponent(nombre);
  if (!confirm(`¿Eliminar la meta "${nombre}"?`)) return;
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).eliminarMetaUI(meta_id));
    toast('Meta eliminada', 'success');
    loadMetas();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// GASTOS RECURRENTES
// ═══════════════════════════════════════════════════════
let _recsData = [];

async function loadRecurrentes() {
  const _rcEl = $('recContent');
  if (_rcEl) _rcEl.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
  try {
    const recs = await new Promise((res,rej) =>
      google.script.run.withSuccessHandler(res).withFailureHandler(rej).getRecurrentesUI()
    );
    _recsData = recs || [];
    renderRecurrentes(_recsData);
    renderRecResumen(_recsData);
    // Badge
    const badge   = $('recBadge');
    const pending = _recsData.filter(r => r.estado === 'vencido' || r.estado === 'proximo').length;
    if (badge) { badge.textContent = pending; badge.style.display = pending ? 'inline' : 'none'; }
  } catch(e) {
    const _rcErr = $('recContent'); if (_rcErr) _rcErr.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle" style="color:var(--red)"></i><p>Error al cargar.</p></div>';
  }
}

function renderRecResumen(recs) {
  const el = $('recResumen');
  if (!el) return;
  const totalMes   = recs.reduce((s,r) => s + r.monto, 0);
  const pendientes = recs.filter(r => r.estado !== 'pagado').length;
  const pagados    = recs.filter(r => r.estado === 'pagado').length;
  const vencidos   = recs.filter(r => r.estado === 'vencido').length;
  el.innerHTML = [
    ['Total/mes', fmt(totalMes), 'var(--text)', 'var(--blue)'],
    ['Pendientes', pendientes, 'var(--text-muted)', 'var(--text)'],
    ['Pagados',    pagados,    'var(--text-muted)', 'var(--emerald)'],
    ['Vencidos',   vencidos,   'var(--text-muted)', 'var(--red)']
  ].map(([l,v,lc,vc]) => `
    <div class="card" style="padding:14px;text-align:center">
      <div style="font-size:10px;color:${lc};text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${l}</div>
      <div style="font-size:22px;font-weight:900;color:${vc}">${v}</div>
    </div>`).join('');
}

function renderRecurrentes(recs) {
  const el = $('recContent');
  if (!el) return;
  if (!recs.length) {
    el.innerHTML = `<div class="empty-state">
      <i class="fas fa-rotate"></i>
      <p>No tienes gastos recurrentes. Agrega Netflix, arriendo, gym...</p>
      <button class="btn btn-primary btn-sm" onclick="openNuevoRecurrente()"><i class="fas fa-plus"></i> Nuevo</button>
    </div>`;
    return;
  }

  const estadoInfo = {
    pagado:   { color:'var(--emerald)', bg:'rgba(0,212,170,.1)',  icon:'fa-check-circle',   label:'Pagado' },
    proximo:  { color:'var(--gold)',    bg:'rgba(245,166,35,.1)', icon:'fa-exclamation',     label:'Próximo' },
    vencido:  { color:'var(--red)',     bg:'rgba(255,77,109,.1)', icon:'fa-exclamation-triangle', label:'Vencido' },
    pendiente:{ color:'var(--text-muted)',bg:'rgba(255,255,255,.04)', icon:'fa-clock',      label:'Pendiente' }
  };
  const tipoIcon = { gasto:'fa-arrow-up', ingreso:'fa-arrow-down', servicio:'fa-rotate' };

  el.innerHTML = recs.map(r => {
    const ei = estadoInfo[r.estado] || estadoInfo.pendiente;
    const iconColor = r.tipo === 'ingreso' ? 'var(--emerald)' : 'var(--red)';
    return `
    <div class="rec-card ${r.estado}">
      <div class="rec-icon" style="background:${ei.bg}">
        <i class="fas ${tipoIcon[r.tipo]||'fa-rotate'}" style="color:${iconColor}"></i>
      </div>
      <div class="rec-info">
        <div class="rec-name">${r.nombre}</div>
        <div class="rec-meta">
          Día ${r.dia_del_mes} de cada mes · ${r.categoria}
          ${r.ultima_vez ? ' · Último: ' + r.ultima_vez : ''}
        </div>
      </div>
      <div style="text-align:right;margin-right:8px">
        <div class="rec-monto" style="color:${iconColor}">${r.tipo==='ingreso'?'+':'-'}${fmt(r.monto)}</div>
        <div class="rec-estado" style="color:${ei.color};background:${ei.bg}">
          <i class="fas ${ei.icon}"></i> ${ei.label}
        </div>
      </div>
      <div class="rec-actions">
        ${r.estado !== 'pagado' ? '<button class="btn btn-primary btn-sm" onclick="doMarcarPagado(\'' + r.rec_id + '\',\'' + encodeURIComponent(r.nombre) + '\')"><i class="fas fa-check"></i></button>' : ''}
        <button class="btn btn-ghost btn-sm" onclick="openEditarRecurrente('${r.rec_id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="confirmarEliminarRec('${r.rec_id}','${encodeURIComponent(r.nombre)}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

function openNuevoRecurrente() {
  _openFeatModal('modal-rec', `
    <h3><i class="fas fa-rotate" style="color:var(--blue);margin-right:8px"></i>Nuevo Gasto Recurrente</h3>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nombre *</label>
        <input id="rr-nombre" class="form-input" placeholder="Netflix, Arriendo..."></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select id="rr-tipo" class="form-select"><option value="gasto">Gasto</option><option value="ingreso">Ingreso</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Monto (COP)</label>
        <input id="rr-monto" class="form-input" type="number" placeholder="21900"></div>
      <div class="form-group"><label class="form-label">Día del mes</label>
        <input id="rr-dia" class="form-input" type="number" min="1" max="31" value="1"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Categoría</label>
        <input id="rr-cat" class="form-input" placeholder="Servicios, Hogar..."></div>
      <div class="form-group"><label class="form-label">Días de alerta antes</label>
        <input id="rr-alerta" class="form-input" type="number" value="2"></div>
    </div>
    <div class="form-group"><label class="form-label">Notas</label>
      <input id="rr-notas" class="form-input" placeholder="Opcional"></div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-rec')">Cancelar</button>
      <button class="btn btn-primary" onclick="_guardarRecForm()"><i class="fas fa-save"></i> Guardar</button>
    </div>`);
}

function openEditarRecurrente(rec_id) {
  const r = _recsData.find(x => x.rec_id === rec_id);
  if (!r) return;
  _openFeatModal('modal-rec', `
    <h3><i class="fas fa-edit" style="color:var(--blue);margin-right:8px"></i>Editar Recurrente</h3>
    <input type="hidden" id="rr-id" value="${rec_id}">
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nombre</label>
        <input id="rr-nombre" class="form-input" value="${r.nombre}"></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select id="rr-tipo" class="form-select">
          <option value="gasto" ${r.tipo==='gasto'?'selected':''}>Gasto</option>
          <option value="ingreso" ${r.tipo==='ingreso'?'selected':''}>Ingreso</option>
        </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Monto</label>
        <input id="rr-monto" class="form-input" type="number" value="${r.monto}"></div>
      <div class="form-group"><label class="form-label">Día del mes</label>
        <input id="rr-dia" class="form-input" type="number" value="${r.dia_del_mes}"></div>
    </div>
    <div class="form-group"><label class="form-label">Categoría</label>
      <input id="rr-cat" class="form-input" value="${r.categoria}"></div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-rec')">Cancelar</button>
      <button class="btn btn-primary" onclick="_guardarRecForm()"><i class="fas fa-save"></i> Actualizar</button>
    </div>`);
}

async function _guardarRecForm() {
  const data = {
    rec_id:            $('rr-id') ? $('rr-id').value : undefined,
    nombre:            $('rr-nombre').value.trim(),
    monto:             parseFloat($('rr-monto').value) || 0,
    tipo:              $('rr-tipo').value,
    categoria:         $('rr-cat').value.trim() || 'Otros',
    dia_del_mes:       parseInt($('rr-dia').value) || 1,
    alerta_dias_antes: parseInt($('rr-alerta') ? $('rr-alerta').value : 2) || 2,
    notas:             $('rr-notas') ? $('rr-notas').value.trim() : ''
  };
  if (!data.nombre) { toast('El nombre es obligatorio', 'error'); return; }
  _closeFeatModal('modal-rec');
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).guardarRecurrenteUI(data));
    toast('Recurrente guardado', 'success');
    loadRecurrentes();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function doMarcarPagado(rec_id, nombre) {
  nombre = decodeURIComponent(nombre);
  toast(`Marcando "${nombre}" como pagado...`, 'info');
  try {
    const res = await new Promise((resolve,rej) =>
      google.script.run.withSuccessHandler(resolve).withFailureHandler(rej).marcarPagadoUI(rec_id, true)
    );
    toast(`"${nombre}" marcado como pagado${res.mov_id ? ' y movimiento creado' : ''}`, 'success');
    loadRecurrentes();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function confirmarEliminarRec(rec_id, nombre) {
  nombre = decodeURIComponent(nombre);
  if (!confirm(`¿Eliminar "${nombre}" de recurrentes?`)) return;
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).eliminarRecurrenteUI(rec_id));
    toast('Eliminado', 'success');
    loadRecurrentes();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// DEUDAS Y CUOTAS
// ═══════════════════════════════════════════════════════
let _deudasData = [];

async function loadDeudas() {
  const _dcEl = $('deudasContent');
  if (_dcEl) _dcEl.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
  try {
    const deudas = await new Promise((res,rej) =>
      google.script.run.withSuccessHandler(res).withFailureHandler(rej).getDeudasUI()
    );
    _deudasData = deudas || [];
    renderDeudas(_deudasData);
    renderDeudaKpis(_deudasData);
    const badge   = $('deuBadge');
    const urgentes = _deudasData.filter(d => d.urgencia !== 'normal').length;
    if (badge) { badge.textContent = urgentes; badge.style.display = urgentes ? 'inline' : 'none'; }
  } catch(e) {
    const _dcErr = $('deudasContent'); if (_dcErr) _dcErr.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle" style="color:var(--red)"></i><p>Error al cargar deudas.</p></div>';
  }
}

function renderDeudaKpis(deudas) {
  const el = $('deudaKpis');
  if (!el) return;
  const totalDeuda  = deudas.reduce((s,d) => s + d.saldo_actual, 0);
  const totalCuotas = deudas.reduce((s,d) => s + d.cuota_mensual, 0);
  const totalIntereses = deudas.reduce((s,d) => s + d.interes_este_mes, 0);
  el.innerHTML = [
    ['Deuda total',   fmt(totalDeuda),   'var(--red)'],
    ['Cuotas/mes',    fmt(totalCuotas),  'var(--gold)'],
    ['Intereses/mes', fmt(totalIntereses),'var(--text-muted)'],
    ['Activas',       deudas.length,     'var(--blue)']
  ].map(([l,v,c]) => `
    <div class="card" style="padding:14px;text-align:center">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${l}</div>
      <div style="font-size:20px;font-weight:900;color:${c}">${v}</div>
    </div>`).join('');
}

function renderDeudas(deudas) {
  const el = $('deudasContent');
  if (!el) return;
  if (!deudas.length) {
    el.innerHTML = `<div class="empty-state">
      <i class="fas fa-credit-card"></i>
      <p>Sin deudas registradas. ¡Excelente! O agrega tus tarjetas para hacer seguimiento.</p>
      <button class="btn btn-primary btn-sm" onclick="openNuevaDeuda()"><i class="fas fa-plus"></i> Agregar deuda</button>
    </div>`;
    return;
  }

  const tipoIcon = { tarjeta:'fa-credit-card', credito:'fa-hand-holding-dollar', hipoteca:'fa-house', otro:'fa-file-invoice-dollar' };

  el.innerHTML = deudas.map(d => {
    const pctPagado = d.saldo_inicial > 0 ? ((d.saldo_inicial - d.saldo_actual) / d.saldo_inicial * 100).toFixed(0) : 0;
    const urgColor  = d.urgencia === 'critico' ? 'var(--red)' : d.urgencia === 'proximo' ? 'var(--gold)' : 'var(--text-muted)';

    return `
    <div class="deuda-card ${d.urgencia}">
      <div class="deuda-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:42px;height:42px;border-radius:12px;background:rgba(255,77,109,.12);display:flex;align-items:center;justify-content:center">
            <i class="fas ${tipoIcon[d.tipo]||'fa-file-invoice-dollar'}" style="color:var(--red)"></i>
          </div>
          <div>
            <div class="deuda-title">${d.nombre}</div>
            <div class="deuda-entidad">${d.entidad || d.tipo} · ${d.tasa_mensual}% mensual (${d.tasa_ea}% E.A.)</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:900;color:var(--red)">${fmt(d.saldo_actual)}</div>
          <div style="font-size:11px;color:${urgColor}">
            <i class="fas fa-clock"></i> Pago en ${d.dias_para_pago}d
            ${d.dias_para_corte !== null ? ` · Corte en ${d.dias_para_corte}d` : ''}
          </div>
        </div>
      </div>
      ${d.saldo_inicial > 0 ? `
      <div class="deuda-progress">
        <div class="deuda-fill" style="width:${pctPagado}%;background:linear-gradient(90deg,var(--emerald),#00a882)"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:-10px;margin-bottom:12px">${pctPagado}% pagado</div>` : ''}
      <div class="deuda-grid">
        <div class="deuda-stat">
          <div class="deuda-stat-label">Cuota/mes</div>
          <div class="deuda-stat-val">${fmt(d.cuota_mensual)}</div>
        </div>
        <div class="deuda-stat">
          <div class="deuda-stat-label">Interés este mes</div>
          <div class="deuda-stat-val" style="color:var(--red)">${fmt(d.interes_este_mes)}</div>
        </div>
        <div class="deuda-stat">
          <div class="deuda-stat-label">Abono capital</div>
          <div class="deuda-stat-val" style="color:var(--emerald)">${fmt(d.abono_capital)}</div>
        </div>
        <div class="deuda-stat">
          <div class="deuda-stat-label">Cuotas restantes</div>
          <div class="deuda-stat-val">${d.cuotas_faltantes !== null ? d.cuotas_faltantes : '—'}</div>
        </div>
      </div>
      <div class="deuda-actions">
        <button class="btn btn-primary btn-sm" onclick="openPagarDeuda('${d.deuda_id}','${encodeURIComponent(d.nombre)}',${d.cuota_mensual})">
          <i class="fas fa-dollar-sign"></i> Registrar pago
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openEditarDeuda('${d.deuda_id}')">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="confirmarEliminarDeuda('${d.deuda_id}','${encodeURIComponent(d.nombre)}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

function openNuevaDeuda() {
  _openFeatModal('modal-deu', `
    <h3><i class="fas fa-credit-card" style="color:var(--red);margin-right:8px"></i>Nueva Deuda</h3>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nombre *</label>
        <input id="dd-nombre" class="form-input" placeholder="Ej: Tarjeta Visa"></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select id="dd-tipo" class="form-select">
          <option value="tarjeta">Tarjeta de crédito</option>
          <option value="credito">Crédito libre inversión</option>
          <option value="hipoteca">Hipoteca</option>
          <option value="otro">Otro</option>
        </select></div>
    </div>
    <div class="form-group"><label class="form-label">Entidad</label>
      <input id="dd-entidad" class="form-input" placeholder="Bancolombia, Davivienda..."></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Saldo actual (COP)</label>
        <input id="dd-saldo" class="form-input" type="number" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Tasa mensual (%)</label>
        <input id="dd-tasa" class="form-input" type="number" step="0.01" placeholder="1.5"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Cuota mensual</label>
        <input id="dd-cuota" class="form-input" type="number" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Día de pago</label>
        <input id="dd-dia-pago" class="form-input" type="number" min="1" max="31" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">Día de corte (tarjetas)</label>
      <input id="dd-dia-corte" class="form-input" type="number" min="1" max="31" placeholder="25"></div>
    <div class="form-group"><label class="form-label">Notas</label>
      <input id="dd-notas" class="form-input" placeholder="Opcional"></div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-deu')">Cancelar</button>
      <button class="btn btn-primary" onclick="_guardarDeudaForm()"><i class="fas fa-save"></i> Guardar</button>
    </div>`);
}

function openPagarDeuda(deuda_id, nombre, cuota) {
  nombre = decodeURIComponent(nombre);
  _openFeatModal('modal-pago', `
    <h3><i class="fas fa-dollar-sign" style="color:var(--emerald);margin-right:8px"></i>Registrar pago: ${nombre}</h3>
    <div class="form-group"><label class="form-label">Monto pagado (COP)</label>
      <input id="dp-monto" class="form-input" type="number" value="${cuota}" autofocus></div>
    <div class="check-row" style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-muted);margin-bottom:16px">
      <input type="checkbox" id="dp-mov" checked style="accent-color:var(--emerald)">
      <label for="dp-mov">Crear movimiento automáticamente</label>
    </div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-pago')">Cancelar</button>
      <button class="btn btn-primary" onclick="_doPagarDeuda('${deuda_id}')"><i class="fas fa-check"></i> Registrar</button>
    </div>`);
}

function openEditarDeuda(deuda_id) {
  const d = _deudasData.find(x => x.deuda_id === deuda_id);
  if (!d) return;
  _openFeatModal('modal-deu', `
    <h3><i class="fas fa-edit" style="color:var(--blue);margin-right:8px"></i>Editar Deuda</h3>
    <input type="hidden" id="dd-id" value="${deuda_id}">
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nombre</label>
        <input id="dd-nombre" class="form-input" value="${d.nombre}"></div>
      <div class="form-group"><label class="form-label">Entidad</label>
        <input id="dd-entidad" class="form-input" value="${d.entidad}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Saldo actual</label>
        <input id="dd-saldo" class="form-input" type="number" value="${d.saldo_actual}"></div>
      <div class="form-group"><label class="form-label">Cuota mensual</label>
        <input id="dd-cuota" class="form-input" type="number" value="${d.cuota_mensual}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tasa mensual (%)</label>
        <input id="dd-tasa" class="form-input" type="number" step="0.01" value="${d.tasa_mensual}"></div>
      <div class="form-group"><label class="form-label">Día de pago</label>
        <input id="dd-dia-pago" class="form-input" type="number" value="${d.dia_pago}"></div>
    </div>
    <div class="feat-modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="_closeFeatModal('modal-deu')">Cancelar</button>
      <button class="btn btn-primary" onclick="_guardarDeudaForm()"><i class="fas fa-save"></i> Actualizar</button>
    </div>`);
}

async function _guardarDeudaForm() {
  const data = {
    deuda_id:     $('dd-id') ? $('dd-id').value : undefined,
    nombre:       $('dd-nombre').value.trim(),
    tipo:         $('dd-tipo') ? $('dd-tipo').value : 'credito',
    entidad:      $('dd-entidad') ? $('dd-entidad').value.trim() : '',
    saldo_actual: parseFloat($('dd-saldo').value) || 0,
    saldo_inicial:parseFloat($('dd-saldo').value) || 0,
    tasa_mensual: parseFloat($('dd-tasa') ? $('dd-tasa').value : 0) || 0,
    cuota_mensual:parseFloat($('dd-cuota').value) || 0,
    dia_pago:     parseInt($('dd-dia-pago').value) || 1,
    dia_corte:    $('dd-dia-corte') ? (parseInt($('dd-dia-corte').value) || '') : '',
    notas:        $('dd-notas') ? $('dd-notas').value.trim() : ''
  };
  if (!data.nombre) { toast('El nombre es obligatorio', 'error'); return; }
  _closeFeatModal('modal-deu');
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).guardarDeudaUI(data));
    toast('Deuda guardada', 'success');
    loadDeudas();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function _doPagarDeuda(deuda_id) {
  const monto   = parseFloat($('dp-monto').value) || 0;
  const crearMov = $('dp-mov') ? $('dp-mov').checked : true;
  if (!monto) { toast('Ingresa un monto', 'error'); return; }
  _closeFeatModal('modal-pago');
  try {
    const res = await new Promise((resolve,rej) =>
      google.script.run.withSuccessHandler(resolve).withFailureHandler(rej).pagarDeudaUI(deuda_id, monto, crearMov)
    );
    toast(`Pago registrado. Nuevo saldo: ${fmt(res.nuevo_saldo)}`, 'success');
    loadDeudas();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function confirmarEliminarDeuda(deuda_id, nombre) {
  nombre = decodeURIComponent(nombre);
  if (!confirm(`¿Eliminar la deuda "${nombre}"?`)) return;
  try {
    await new Promise((res,rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).eliminarDeudaUI(deuda_id));
    toast('Deuda eliminada', 'success');
    loadDeudas();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// HELPER — Modals reutilizables para features
// ═══════════════════════════════════════════════════════
function _openFeatModal(id, html) {
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'feat-modal-overlay';
    overlay.innerHTML = `<div class="feat-modal">${html}</div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeFeatModal(id); });
    document.body.appendChild(overlay);
  } else {
    overlay.querySelector('.feat-modal').innerHTML = html;
  }
  overlay.classList.add('open');
}
function _closeFeatModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
