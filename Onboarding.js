// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING — Sistema de instalación con 1 clic
// Cada usuario que abre la URL de onboarding recibe su propia Sheet
// completamente configurada, lista para usar.
//
// Flujo:
//   1. Usuario abre URL de onboarding → ve landing page (Onboarding.html)
//   2. Hace clic en "Instalar mi app"
//   3. GAS crea una Sheet nueva en el Drive del usuario (ejecuta como USER_ACCESSING)
//   4. Inicializa todas las hojas, configuración y datos de ejemplo
//   5. Devuelve la URL de la Sheet + instrucciones para el siguiente paso
//
// IMPORTANTE: el webapp de onboarding debe tener:
//   executeAs: USER_ACCESSING   ← crea la Sheet en la cuenta del usuario
//   access:    ANYONE           ← cualquiera con cuenta Google puede acceder
// ═══════════════════════════════════════════════════════════════════════════

// ── Punto de entrada GET del onboarding ─────────────────────────────────────
function doGetOnboarding(e) {
  return HtmlService.createTemplateFromFile('Onboarding')
    .evaluate()
    .setTitle('Instalar Finanzas AI Pro')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

// ── Instalación principal — llamada desde el botón de la landing ─────────────
/**
 * Crea la Sheet del usuario y devuelve la URL.
 * Se ejecuta con los permisos del usuario que hizo clic (USER_ACCESSING),
 * por lo que la Sheet queda en su propio Google Drive.
 */
function instalarAppUsuario(opciones) {
  opciones = opciones || {};

  try {
    const user    = Session.getActiveUser().getEmail();
    const nombre  = opciones.nombre || user.split('@')[0];
    const conDemo = opciones.conDemo !== false; // true por defecto

    // 1. Verificar si el usuario ya tiene una Sheet instalada
    const props  = PropertiesService.getUserProperties();
    const yaInst = props.getProperty('SHEET_ID_INSTALADA');
    if (yaInst) {
      try {
        const ss = SpreadsheetApp.openById(yaInst);
        return {
          ok: true,
          yaExistia: true,
          sheetUrl: ss.getUrl(),
          email: user,
          mensaje: '✅ Ya tienes tu app instalada. Abriendo tu hoja...'
        };
      } catch(e) {
        // Sheet fue eliminada, crear una nueva
        props.deleteProperty('SHEET_ID_INSTALADA');
      }
    }

    // 2. Crear la Google Sheet en el Drive del usuario
    const titulo = `Finanzas AI Pro — ${nombre}`;
    const ss     = SpreadsheetApp.create(titulo);
    const ssId   = ss.getId();
    const ssUrl  = ss.getUrl();

    // 3. Guardar el ID en las propiedades del usuario (para detectar reinstalaciones)
    props.setProperty('SHEET_ID_INSTALADA', ssId);
    props.setProperty('INSTALADO_EL', new Date().toISOString());
    props.setProperty('EMAIL_USUARIO', user);

    // 4. Inicializar toda la estructura en la Sheet nueva
    _inicializarSheetUsuario_(ss, nombre, conDemo);

    // 5. Registrar en el log maestro (Sheet del admin)
    _registrarUsuarioEnLog_(user, ssId, ssUrl, nombre);

    return {
      ok:       true,
      yaExistia: false,
      sheetUrl: ssUrl,
      sheetId:  ssId,
      email:    user,
      nombre:   nombre,
      mensaje:  `✅ ¡Tu app está lista, ${nombre}! Haz clic para abrirla.`
    };

  } catch(err) {
    Logger.log('Error instalarAppUsuario: ' + err + '\n' + (err.stack || ''));
    return { ok: false, error: err.message };
  }
}

// ── Inicializar la Sheet del usuario recién creada ───────────────────────────
function _inicializarSheetUsuario_(ss, nombre, conDemo) {
  const now = new Date().toISOString();

  // Helper para crear/configurar una hoja
  const crearHoja = (nombreHoja, headers, datos) => {
    let sh = ss.getSheetByName(nombreHoja);
    if (!sh) sh = ss.insertSheet(nombreHoja);
    sh.clearContents();
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#f8fafc')
      .setFontSize(10);
    sh.setFrozenRows(1);
    if (datos && datos.length) {
      sh.getRange(2, 1, datos.length, headers.length).setValues(datos);
    }
    return sh;
  };

  // ── CONFIG ──────────────────────────────────────────────────────────────
  crearHoja('Config', ['clave','valor','descripción'], [
    ['moneda_base',            'COP',    'Moneda principal'],
    ['proveedor_ia',           'gemini', 'gemini | reglas'],
    ['umbral_auto_aprobacion', '0.88',   'Confianza IA para auto-aprobar emails'],
    ['etiqueta_gmail',         'gastos', 'Etiqueta Gmail a sincronizar'],
    ['salario_mensual',        '0',      'Ingreso mensual (actualiza este valor)'],
    ['usuario_nombre',         nombre,   'Tu nombre en la app'],
    ['instalado_el',           now,      'Fecha de instalación']
  ]);

  // ── CUENTAS ─────────────────────────────────────────────────────────────
  crearHoja('Cuentas', ['cuenta_id','nombre','tipo','institución','moneda','saldo','activa'], [
    ['CTA_01','Efectivo',           'efectivo',  '',              'COP', 0, true],
    ['CTA_02','Bancolombia Ahorro', 'ahorro',    'Bancolombia',   'COP', 0, true],
    ['CTA_03','Nequi',              'digital',   'Nequi',         'COP', 0, true],
    ['CTA_04','Broker / Inversiones','broker',   '',              'COP', 0, true]
  ]);

  // ── CATEGORÍAS ──────────────────────────────────────────────────────────
  crearHoja('Categorias', ['categoria_id','nombre','grupo','icono','color','keywords'], [
    ['CAT_01','Alimentos',            'gasto',        '🍔','#ef4444','supermercado,comida,restaurante,mercado,rappi,ifood'],
    ['CAT_02','Transporte',           'gasto',        '🚗','#f59e0b','uber,taxi,gasolina,peaje,transmilenio'],
    ['CAT_03','Servicios',            'gasto',        '📱','#3b82f6','luz,agua,internet,celular,netflix,spotify'],
    ['CAT_04','Salud',                'gasto',        '🏥','#ec4899','farmacia,medicina,doctor,clinica,gym,bodytech'],
    ['CAT_05','Hogar',                'gasto',        '🏠','#8b5cf6','arriendo,administracion,muebles,mercado'],
    ['CAT_06','Entretenimiento',      'gasto',        '🎬','#06b6d4','cine,teatro,juegos,spotify,youtube'],
    ['CAT_07','Educación',            'gasto',        '📚','#10b981','universidad,curso,libro,udemy'],
    ['CAT_08','Ingresos',             'ingreso',      '💰','#22c55e','nomina,salario,abono,consignacion'],
    ['CAT_09','Transferencia',        'transferencia','↔️','#64748b','transferencia,traslado,nequi'],
    ['CAT_10','Aporte a inversiones', 'transferencia','📈','#a78bfa','aporte,inversion,trii,tyba'],
    ['CAT_11','Otros',                'gasto',        '📦','#94a3b8','']
  ]);

  // ── MOVIMIENTOS ─────────────────────────────────────────────────────────
  crearHoja('Movimientos', [
    'mov_id','fecha','descripción','grupo','categoría',
    'monto','moneda','cuenta_origen','cuenta_destino',
    'activo_inversión','fuente','referencia','notas','creado_el'
  ], conDemo ? _datosDemo_() : []);

  // ── PRESUPUESTO ─────────────────────────────────────────────────────────
  crearHoja('Presupuesto', ['presupuesto_id','categoría','periodo','límite','alerta_pct','activo'], [
    ['PRE_01','Alimentos',       'mensual', 600000, 90, true],
    ['PRE_02','Transporte',      'mensual', 300000, 90, true],
    ['PRE_03','Servicios',       'mensual', 200000, 90, true],
    ['PRE_04','Entretenimiento', 'mensual', 200000, 90, true],
    ['PRE_05','Salud',           'mensual', 150000, 90, true]
  ]);

  // ── INVERSIONES ─────────────────────────────────────────────────────────
  crearHoja('Inversiones', [
    'inversion_id','fecha_compra','cuenta','broker','operacion',
    'ticker','activo','cantidad','precio_compra','moneda_compra',
    'trm_compra','vr_mercado_compra','fuente_precio','precio_actual',
    'moneda_actual','trm_actual','precio_actual_base','vr_mercado_actual',
    'pyg_base','pyg_pct','actualizado_el','notas'
  ]);

  // ── METAS DE AHORRO ─────────────────────────────────────────────────────
  crearHoja('Metas', [
    'meta_id','nombre','descripcion','monto_objetivo','monto_actual',
    'fecha_inicio','fecha_objetivo','categoria_exclusion','activa','creado_el'
  ], conDemo ? [
    ['META_01','Fondo de emergencia','3 meses de gastos',
     6000000, 0, _hoy_(), _fechaFutura_(6), 'Ahorro', true, now],
    ['META_02','Viaje Cartagena','Vacaciones de fin de año',
     2500000, 0, _hoy_(), _fechaFutura_(8), 'Vacaciones', true, now]
  ] : []);

  // ── RECURRENTES ─────────────────────────────────────────────────────────
  crearHoja('Recurrentes', [
    'rec_id','nombre','monto','tipo','categoria','cuenta',
    'dia_del_mes','activo','ultima_vez','alerta_dias_antes','notas','creado_el'
  ], conDemo ? [
    ['REC_01','Arriendo',       1500000,'gasto','Hogar',         'CTA_02', 1, true,'','3','',''],
    ['REC_02','Netflix',          21900,'gasto','Servicios',     'CTA_02', 5, true,'','1','',''],
    ['REC_03','Spotify',          10900,'gasto','Entretenimiento','CTA_02',10, true,'','1','',''],
    ['REC_04','Internet casa',    89900,'gasto','Servicios',     'CTA_02',15, true,'','2','',''],
    ['REC_05','Gym / Bodytech',   95000,'gasto','Salud',         'CTA_02',20, true,'','2','',''],
    ['REC_06','Salario',              0,'ingreso','Ingresos',    'CTA_02', 1, true,'','0','Edita el monto','']
  ] : []);

  // ── DEUDAS ──────────────────────────────────────────────────────────────
  crearHoja('Deudas', [
    'deuda_id','nombre','tipo','entidad','saldo_inicial','saldo_actual',
    'tasa_mensual','cuota_mensual','fecha_inicio','fecha_fin',
    'dia_corte','dia_pago','cuenta_pago','activa','notas','creado_el'
  ], conDemo ? [
    ['DEU_01','Tarjeta Crédito Bancolombia','tarjeta',  'Bancolombia',0,0,1.5,0, _hoy_(),'','25','10','CTA_02',true,'Actualiza el saldo',''],
    ['DEU_02','Crédito de libre inversión', 'credito',  'Bancolombia',0,0,1.8,0, _hoy_(),'','',  '1', 'CTA_02',true,'Actualiza montos','']
  ] : []);

  // ── TIPOS DE CAMBIO ─────────────────────────────────────────────────────
  crearHoja('TiposCambio', ['base','objetivo','tasa','fecha','fuente']);

  // ── CORREOS ─────────────────────────────────────────────────────────────
  crearHoja('Correos', [
    'log_id','msg_id','remitente','asunto','recibido_el',
    'procesado_el','estado','monto','moneda','comercio',
    'categoria_ia','confianza_ia','categoria_usuario','cuenta_sugerida',
    'observación','mov_id','snippet'
  ]);

  // ── AUDITORIA EXTRACTOS ──────────────────────────────────────────────────
  crearHoja('Auditoria_Extractos', [
    'audit_id','fecha_proceso','cuenta','archivo','total_extracto',
    'total_registrado','diferencia','movimientos_nuevos','estado','notas'
  ]);

  // Eliminar la "Sheet1" vacía que crea Google por defecto
  try {
    const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
    if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  } catch(e) {}

  // Mover Config al primer lugar
  try { ss.setActiveSheet(ss.getSheetByName('Config')); ss.moveActiveSheet(1); } catch(e) {}

  Logger.log(`✅ Sheet inicializada para: ${nombre} — ID: ${ss.getId()}`);
}

// ── Log maestro de usuarios instalados ──────────────────────────────────────
// Guarda un registro en la Sheet DEL ADMIN (la tuya) con cada usuario que instala.
function _registrarUsuarioEnLog_(email, sheetId, sheetUrl, nombre) {
  try {
    // Busca la hoja de registro en las propiedades del script (tuya como admin)
    const logSheetId = PropertiesService.getScriptProperties()
                         .getProperty('LOG_USUARIOS_SHEET_ID');
    if (!logSheetId) return; // Si no está configurado, omitir silenciosamente

    const logSS = SpreadsheetApp.openById(logSheetId);
    let sh = logSS.getSheetByName('Usuarios');
    if (!sh) {
      sh = logSS.insertSheet('Usuarios');
      sh.appendRow(['email','nombre','sheet_id','sheet_url','instalado_el','activo']);
      sh.getRange(1,1,1,6).setFontWeight('bold').setBackground('#1e293b').setFontColor('#f8fafc');
    }
    sh.appendRow([email, nombre, sheetId, sheetUrl, new Date(), true]);
  } catch(e) {
    Logger.log('No se pudo registrar en log maestro: ' + e);
    // No fallar el onboarding por esto
  }
}

// ── Datos de demostración ────────────────────────────────────────────────────
function _datosDemo_() {
  const now = new Date().toISOString();
  const mes = new Date().toISOString().slice(0,7);
  const D   = (y,m,d) => new Date(y,m-1,d).toISOString().slice(0,10);
  const u   = () => 'MOV_' + Math.random().toString(36).slice(2,9).toUpperCase();

  const [Y, M] = [new Date().getFullYear(), new Date().getMonth()+1];

  return [
    [u(), D(Y,M,1), 'Salario ' + mes,               'ingreso',      'Ingresos',          3500000,'COP','CTA_02','','','manual','','',''],
    [u(), D(Y,M,2), 'Arriendo',                      'gasto',        'Hogar',             1500000,'COP','CTA_02','','','manual','','',''],
    [u(), D(Y,M,3), 'Mercado Éxito',                 'gasto',        'Alimentos',          280000,'COP','CTA_02','','','manual','','',''],
    [u(), D(Y,M,5), 'Netflix',                        'gasto',        'Servicios',          21900,'COP','CTA_02','','','gmail', '','',''],
    [u(), D(Y,M,6), 'Uber — reunión trabajo',         'gasto',        'Transporte',          18500,'COP','CTA_01','','','gmail', '','',''],
    [u(), D(Y,M,8), 'Farmacia Cruz Verde',            'gasto',        'Salud',               45000,'COP','CTA_01','','','manual','','',''],
    [u(), D(Y,M,10),'Rappi — almuerzo',               'gasto',        'Alimentos',           35000,'COP','CTA_03','','','gmail', '','',''],
    [u(), D(Y,M,12),'Internet ETB',                   'gasto',        'Servicios',           89900,'COP','CTA_02','','','manual','','',''],
    [u(), D(Y,M,14),'Gym Bodytech',                   'gasto',        'Salud',               95000,'COP','CTA_02','','','gmail', '','',''],
    [u(), D(Y,M,15),'Aporte ahorro Trii — ETF S&P',  'transferencia','Aporte a inversiones',300000,'COP','CTA_02','CTA_04','ETF S&P 500','manual','','',''],
    [u(), D(Y,M,17),'Spotify',                        'gasto',        'Entretenimiento',     10900,'COP','CTA_02','','','gmail', '','',''],
    [u(), D(Y,M,19),'Domicilio Dominos',              'gasto',        'Alimentos',           52000,'COP','CTA_03','','','gmail', '','',''],
    [u(), D(Y,M,21),'Gasolina',                       'gasto',        'Transporte',          80000,'COP','CTA_01','','','manual','','',''],
    [u(), D(Y,M,23),'Cine Cinépolis',                 'gasto',        'Entretenimiento',     32000,'COP','CTA_03','','','manual','','',''],
    [u(), D(Y,M,25),'Supermercado Carulla',           'gasto',        'Alimentos',          195000,'COP','CTA_02','','','manual','','','']
  ].map(r => [...r, now]); // agregar creado_el
}

// ── Helpers de fecha ─────────────────────────────────────────────────────────
function _hoy_() {
  return new Date().toISOString().slice(0,10);
}
function _fechaFutura_(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0,10);
}

// ── Estado de la instalación — llamado desde el frontend ────────────────────
function getEstadoInstalacion() {
  try {
    const props  = PropertiesService.getUserProperties();
    const sheetId = props.getProperty('SHEET_ID_INSTALADA');
    if (!sheetId) return { instalado: false };
    const ss = SpreadsheetApp.openById(sheetId);
    return {
      instalado: true,
      sheetUrl:  ss.getUrl(),
      email:     Session.getActiveUser().getEmail(),
      instaladoEl: props.getProperty('INSTALADO_EL')
    };
  } catch(e) {
    // Sheet fue borrada
    PropertiesService.getUserProperties().deleteProperty('SHEET_ID_INSTALADA');
    return { instalado: false };
  }
}

// ── Desinstalar (para pruebas / soporte) ────────────────────────────────────
function desinstalarApp() {
  PropertiesService.getUserProperties().deleteAllProperties();
  return { ok: true, mensaje: 'Propiedades borradas. Puedes reinstalar.' };
}
