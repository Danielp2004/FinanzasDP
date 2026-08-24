// ═══════════════════════════════════════════════════════════════════════════
// FEATURES.JS — Metas de Ahorro · Gastos Recurrentes · Deudas y Cuotas
// ═══════════════════════════════════════════════════════════════════════════

// ─── HELPERS INTERNOS ────────────────────────────────────────────────────────
function _ss_()  { return SpreadsheetApp.getActiveSpreadsheet(); }
function _sh_(nombre) { return _ss_().getSheetByName(nombre); }
function _uid_(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2,9).toUpperCase();
}
function _hoyISO_() { return new Date().toISOString().slice(0,10); }
function _sheetRows_(nombre) {
  const sh = _sh_(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const hdr  = data[0].map(h => String(h).trim().toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/[ñ]/g,'n')
    .replace(/\s+/g,'_'));
  return data.slice(1).map(row => {
    const obj = { _row: row }; // guardar fila original para actualizaciones
    hdr.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== '' && v !== null));
}

// ═══════════════════════════════════════════════════════════════════════════
// METAS DE AHORRO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve todas las metas con progreso calculado.
 */
function getMetas() {
  const metas = _sheetRows_(CFG.SHEETS.METAS);
  const hoy   = new Date();

  return metas
    .filter(m => m.activa === true || m.activa === 'TRUE' || m.activa === 'true')
    .map(m => {
      const objetivo  = parseFloat(m.monto_objetivo)  || 0;
      const actual    = parseFloat(m.monto_actual)     || 0;
      const progreso  = objetivo > 0 ? Math.min(100, (actual / objetivo) * 100) : 0;
      const faltante  = Math.max(0, objetivo - actual);

      // ETA — cuántos meses faltan según el ritmo actual
      const inicio   = m.fecha_inicio ? new Date(m.fecha_inicio) : hoy;
      const diasTransc = Math.max(1, (hoy - inicio) / (1000 * 60 * 60 * 24));
      const ritmo    = actual / diasTransc; // COP/día ahorrado
      const eta      = ritmo > 0 ? Math.ceil(faltante / (ritmo * 30)) : null; // meses

      // Fecha objetivo
      let fechaObj = null, diasRestantes = null;
      if (m.fecha_objetivo) {
        fechaObj     = new Date(m.fecha_objetivo);
        diasRestantes = Math.ceil((fechaObj - hoy) / (1000 * 60 * 60 * 24));
      }

      // Aporte mensual necesario para llegar a tiempo
      const aporteNecesario = diasRestantes && diasRestantes > 0
        ? Math.ceil(faltante / (diasRestantes / 30))
        : null;

      return {
        meta_id:         String(m.meta_id || ''),
        nombre:          String(m.nombre  || ''),
        descripcion:     String(m.descripcion || ''),
        monto_objetivo:  objetivo,
        monto_actual:    actual,
        progreso_pct:    parseFloat(progreso.toFixed(1)),
        faltante:        faltante,
        fecha_inicio:    m.fecha_inicio  ? String(m.fecha_inicio).slice(0,10)  : '',
        fecha_objetivo:  m.fecha_objetivo ? String(m.fecha_objetivo).slice(0,10) : '',
        dias_restantes:  diasRestantes,
        eta_meses:       eta,
        aporte_necesario_mes: aporteNecesario,
        completada:      progreso >= 100,
        activa:          true
      };
    });
}

/**
 * Crea o actualiza una meta de ahorro.
 */
function guardarMeta(data) {
  const sh = _sh_(CFG.SHEETS.METAS);
  if (!sh) throw new Error('Hoja Metas no encontrada');

  const hdr   = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                  .map(h => String(h).trim());
  const now   = new Date().toISOString();

  if (data.meta_id) {
    // Actualizar existente
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.meta_id)) {
        const col = (campo) => hdr.indexOf(campo);
        if (data.nombre          !== undefined) sh.getRange(i+1, col('nombre')+1).setValue(data.nombre);
        if (data.descripcion     !== undefined) sh.getRange(i+1, col('descripcion')+1).setValue(data.descripcion);
        if (data.monto_objetivo  !== undefined) sh.getRange(i+1, col('monto_objetivo')+1).setValue(parseFloat(data.monto_objetivo)||0);
        if (data.monto_actual    !== undefined) sh.getRange(i+1, col('monto_actual')+1).setValue(parseFloat(data.monto_actual)||0);
        if (data.fecha_objetivo  !== undefined) sh.getRange(i+1, col('fecha_objetivo')+1).setValue(data.fecha_objetivo);
        if (data.activa          !== undefined) sh.getRange(i+1, col('activa')+1).setValue(data.activa);
        return { ok: true, meta_id: data.meta_id };
      }
    }
    throw new Error('Meta no encontrada: ' + data.meta_id);
  }

  // Crear nueva
  const id  = _uid_('META');
  const row = hdr.map(h => {
    const m = {
      meta_id:           id,
      nombre:            data.nombre            || 'Sin nombre',
      descripcion:       data.descripcion       || '',
      monto_objetivo:    parseFloat(data.monto_objetivo) || 0,
      monto_actual:      parseFloat(data.monto_actual)   || 0,
      fecha_inicio:      data.fecha_inicio      || _hoyISO_(),
      fecha_objetivo:    data.fecha_objetivo    || '',
      categoria_exclusion: data.categoria_exclusion || '',
      activa:            true,
      creado_el:         now
    };
    return m[h] !== undefined ? m[h] : '';
  });
  sh.appendRow(row);
  CacheService.getScriptCache().remove('metas_v1');
  return { ok: true, meta_id: id };
}

/**
 * Registra un aporte a una meta.
 */
function aportarMeta(meta_id, monto) {
  const sh   = _sh_(CFG.SHEETS.METAS);
  if (!sh) throw new Error('Hoja Metas no encontrada');
  const rows = sh.getDataRange().getValues();
  const hdr  = rows[0].map(h => String(h).trim());
  const cActual = hdr.indexOf('monto_actual');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(meta_id)) {
      const nuevoActual = (parseFloat(rows[i][cActual]) || 0) + parseFloat(monto);
      sh.getRange(i+1, cActual+1).setValue(nuevoActual);
      CacheService.getScriptCache().remove('metas_v1');
      return { ok: true, nuevo_total: nuevoActual };
    }
  }
  throw new Error('Meta no encontrada');
}

/**
 * Elimina (desactiva) una meta.
 */
function eliminarMeta(meta_id) {
  return guardarMeta({ meta_id, activa: false });
}

// ═══════════════════════════════════════════════════════════════════════════
// GASTOS RECURRENTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve todos los recurrentes con estado de este mes.
 */
function getRecurrentes() {
  const recs = _sheetRows_(CFG.SHEETS.RECURRENTES);
  const hoy  = new Date();
  const mes  = hoy.toISOString().slice(0,7); // yyyy-MM

  return recs
    .filter(r => r.activo === true || r.activo === 'TRUE' || r.activo === 'true')
    .map(r => {
      const diaMes      = parseInt(r.dia_del_mes) || 1;
      const alertaDias  = parseInt(r.alerta_dias_antes) || 2;
      const fechaEsperada = new Date(hoy.getFullYear(), hoy.getMonth(), diaMes);

      // ¿Ya fue registrado este mes?
      const ultimaVez   = r.ultima_vez ? new Date(r.ultima_vez) : null;
      const yaEstesMes  = ultimaVez
        && ultimaVez.getFullYear() === hoy.getFullYear()
        && ultimaVez.getMonth()    === hoy.getMonth();

      // ¿Está próximo o vencido?
      const diasParaVencer = Math.ceil((fechaEsperada - hoy) / (1000 * 60 * 60 * 24));
      let estado = 'ok';
      if (yaEstesMes) {
        estado = 'pagado';
      } else if (diasParaVencer < 0) {
        estado = 'vencido';
      } else if (diasParaVencer <= alertaDias) {
        estado = 'proximo';
      } else {
        estado = 'pendiente';
      }

      return {
        rec_id:            String(r.rec_id || ''),
        nombre:            String(r.nombre || ''),
        monto:             parseFloat(r.monto) || 0,
        tipo:              String(r.tipo || 'gasto'),
        categoria:         String(r.categoria || ''),
        cuenta:            String(r.cuenta || ''),
        dia_del_mes:       diaMes,
        alerta_dias_antes: alertaDias,
        ultima_vez:        r.ultima_vez ? String(r.ultima_vez).slice(0,10) : '',
        notas:             String(r.notas || ''),
        estado:            estado,
        dias_para_vencer:  diasParaVencer,
        ya_este_mes:       yaEstesMes,
        activo:            true
      };
    })
    .sort((a,b) => a.dia_del_mes - b.dia_del_mes);
}

/**
 * Crea o actualiza un gasto recurrente.
 */
function guardarRecurrente(data) {
  const sh = _sh_(CFG.SHEETS.RECURRENTES);
  if (!sh) throw new Error('Hoja Recurrentes no encontrada');
  const hdr = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const now = new Date().toISOString();

  if (data.rec_id) {
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.rec_id)) {
        const col = (c) => hdr.indexOf(c);
        if (data.nombre          !== undefined) sh.getRange(i+1, col('nombre')+1).setValue(data.nombre);
        if (data.monto           !== undefined) sh.getRange(i+1, col('monto')+1).setValue(parseFloat(data.monto)||0);
        if (data.tipo            !== undefined) sh.getRange(i+1, col('tipo')+1).setValue(data.tipo);
        if (data.categoria       !== undefined) sh.getRange(i+1, col('categoria')+1).setValue(data.categoria);
        if (data.cuenta          !== undefined) sh.getRange(i+1, col('cuenta')+1).setValue(data.cuenta);
        if (data.dia_del_mes     !== undefined) sh.getRange(i+1, col('dia_del_mes')+1).setValue(parseInt(data.dia_del_mes)||1);
        if (data.alerta_dias_antes !== undefined) sh.getRange(i+1, col('alerta_dias_antes')+1).setValue(parseInt(data.alerta_dias_antes)||2);
        if (data.ultima_vez      !== undefined) sh.getRange(i+1, col('ultima_vez')+1).setValue(data.ultima_vez);
        if (data.notas           !== undefined) sh.getRange(i+1, col('notas')+1).setValue(data.notas);
        if (data.activo          !== undefined) sh.getRange(i+1, col('activo')+1).setValue(data.activo);
        return { ok: true, rec_id: data.rec_id };
      }
    }
    throw new Error('Recurrente no encontrado: ' + data.rec_id);
  }

  const id  = _uid_('REC');
  const row = hdr.map(h => {
    const d = {
      rec_id:            id,
      nombre:            data.nombre            || 'Sin nombre',
      monto:             parseFloat(data.monto) || 0,
      tipo:              data.tipo              || 'gasto',
      categoria:         data.categoria         || 'Otros',
      cuenta:            data.cuenta            || '',
      dia_del_mes:       parseInt(data.dia_del_mes) || 1,
      activo:            true,
      ultima_vez:        '',
      alerta_dias_antes: parseInt(data.alerta_dias_antes) || 2,
      notas:             data.notas             || '',
      creado_el:         now
    };
    return d[h] !== undefined ? d[h] : '';
  });
  sh.appendRow(row);
  return { ok: true, rec_id: id };
}

/**
 * Marca un recurrente como pagado HOY y opcionalmente crea el movimiento.
 */
function marcarRecurrentePagado(rec_id, crearMovimiento) {
  const sh  = _sh_(CFG.SHEETS.RECURRENTES);
  if (!sh) throw new Error('Hoja Recurrentes no encontrada');
  const rows = sh.getDataRange().getValues();
  const hdr  = rows[0].map(h => String(h).trim());
  const cUltimaVez = hdr.indexOf('ultima_vez');
  const cNombre    = hdr.indexOf('nombre');
  const cMonto     = hdr.indexOf('monto');
  const cTipo      = hdr.indexOf('tipo');
  const cCat       = hdr.indexOf('categoria');
  const cCuenta    = hdr.indexOf('cuenta');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(rec_id)) {
      const hoy = _hoyISO_();
      sh.getRange(i+1, cUltimaVez+1).setValue(hoy);

      let movId = null;
      if (crearMovimiento !== false) {
        try {
          const res = guardarTransaccion({
            descripcion: rows[i][cNombre] + ' (recurrente)',
            monto:       parseFloat(rows[i][cMonto]) || 0,
            grupo:       rows[i][cTipo]   || 'gasto',
            categoria:   rows[i][cCat]    || 'Servicios',
            cuenta_origen: rows[i][cCuenta] || '',
            fecha:       hoy,
            fuente:      'recurrente',
            notas:       'Registrado automáticamente'
          });
          movId = res.id || res.mov_id;
        } catch(e) { Logger.log('No se pudo crear movimiento: ' + e); }
      }
      return { ok: true, rec_id, fecha: hoy, mov_id: movId };
    }
  }
  throw new Error('Recurrente no encontrado');
}

/**
 * Elimina un recurrente.
 */
function eliminarRecurrente(rec_id) {
  return guardarRecurrente({ rec_id, activo: false });
}

/**
 * Trigger diario — alerta recurrentes vencidos o próximos.
 * Llama a verificarAlertasInteligentes() que ya maneja notificaciones.
 */
function verificarRecurrentesPendientes() {
  const recs = getRecurrentes();
  const vencidos = recs.filter(r => r.estado === 'vencido' || r.estado === 'proximo');
  if (vencidos.length === 0) return;

  Logger.log('⚠️ Recurrentes pendientes: ' + vencidos.map(r => r.nombre).join(', '));
  // Se incluyen automáticamente en getAlertasActivas() si están vencidos
}

// ═══════════════════════════════════════════════════════════════════════════
// DEUDAS Y CUOTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve todas las deudas activas con cálculos de interés.
 */
function getDeudas() {
  const deudas = _sheetRows_(CFG.SHEETS.DEUDAS);
  const hoy    = new Date();

  return deudas
    .filter(d => d.activa === true || d.activa === 'TRUE' || d.activa === 'true')
    .map(d => {
      const saldoActual  = parseFloat(d.saldo_actual)   || 0;
      const cuota        = parseFloat(d.cuota_mensual)  || 0;
      const tasaMensual  = parseFloat(d.tasa_mensual)   || 0; // % mensual
      const interesEste  = saldoActual * (tasaMensual / 100);
      const abonoPrincipal = Math.max(0, cuota - interesEste);

      // Cuántas cuotas faltan (amortización simple)
      let cuotasFaltantes = null;
      if (cuota > interesEste && saldoActual > 0) {
        cuotasFaltantes = Math.ceil(
          Math.log(cuota / (cuota - saldoActual * (tasaMensual/100))) /
          Math.log(1 + tasaMensual/100)
        );
        if (!isFinite(cuotasFaltantes) || cuotasFaltantes < 0) cuotasFaltantes = null;
      }

      // Días para próximo pago
      const diaPago      = parseInt(d.dia_pago) || 1;
      const fechaPago    = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago);
      if (fechaPago < hoy) fechaPago.setMonth(fechaPago.getMonth() + 1);
      const diasParaPago = Math.ceil((fechaPago - hoy) / (1000 * 60 * 60 * 24));

      // Días para próximo corte (tarjetas)
      const diaCorte     = parseInt(d.dia_corte) || null;
      let diasParaCorte  = null;
      if (diaCorte) {
        const fechaCorte = new Date(hoy.getFullYear(), hoy.getMonth(), diaCorte);
        if (fechaCorte < hoy) fechaCorte.setMonth(fechaCorte.getMonth() + 1);
        diasParaCorte = Math.ceil((fechaCorte - hoy) / (1000 * 60 * 60 * 24));
      }

      // Estado de urgencia
      let urgencia = 'normal';
      if (diasParaPago <= 3)  urgencia = 'critico';
      else if (diasParaPago <= 7) urgencia = 'proximo';

      return {
        deuda_id:         String(d.deuda_id || ''),
        nombre:           String(d.nombre   || ''),
        tipo:             String(d.tipo     || 'credito'), // tarjeta | credito | hipoteca | otro
        entidad:          String(d.entidad  || ''),
        saldo_inicial:    parseFloat(d.saldo_inicial)  || 0,
        saldo_actual:     saldoActual,
        tasa_mensual:     tasaMensual,
        tasa_ea:          parseFloat((Math.pow(1 + tasaMensual/100, 12) - 1) * 100).toFixed(2),
        cuota_mensual:    cuota,
        interes_este_mes: parseFloat(interesEste.toFixed(0)),
        abono_capital:    parseFloat(abonoPrincipal.toFixed(0)),
        cuotas_faltantes: cuotasFaltantes,
        fecha_inicio:     d.fecha_inicio  ? String(d.fecha_inicio).slice(0,10)  : '',
        fecha_fin:        d.fecha_fin     ? String(d.fecha_fin).slice(0,10)     : '',
        dia_corte:        diaCorte,
        dia_pago:         diaPago,
        dias_para_pago:   diasParaPago,
        dias_para_corte:  diasParaCorte,
        cuenta_pago:      String(d.cuenta_pago || ''),
        notas:            String(d.notas || ''),
        urgencia:         urgencia,
        activa:           true
      };
    })
    .sort((a,b) => a.dias_para_pago - b.dias_para_pago);
}

/**
 * Crea o actualiza una deuda.
 */
function guardarDeuda(data) {
  const sh  = _sh_(CFG.SHEETS.DEUDAS);
  if (!sh) throw new Error('Hoja Deudas no encontrada');
  const hdr = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const now = new Date().toISOString();

  if (data.deuda_id) {
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.deuda_id)) {
        const col = (c) => hdr.indexOf(c);
        const campos = ['nombre','tipo','entidad','saldo_inicial','saldo_actual',
                        'tasa_mensual','cuota_mensual','fecha_inicio','fecha_fin',
                        'dia_corte','dia_pago','cuenta_pago','activa','notas'];
        campos.forEach(c => {
          if (data[c] !== undefined) {
            const val = ['saldo_inicial','saldo_actual','tasa_mensual','cuota_mensual','dia_corte','dia_pago'].includes(c)
              ? parseFloat(data[c]) || 0
              : data[c];
            sh.getRange(i+1, col(c)+1).setValue(val);
          }
        });
        return { ok: true, deuda_id: data.deuda_id };
      }
    }
    throw new Error('Deuda no encontrada: ' + data.deuda_id);
  }

  const id  = _uid_('DEU');
  const row = hdr.map(h => {
    const d = {
      deuda_id:      id,
      nombre:        data.nombre        || 'Sin nombre',
      tipo:          data.tipo          || 'credito',
      entidad:       data.entidad       || '',
      saldo_inicial: parseFloat(data.saldo_inicial)  || 0,
      saldo_actual:  parseFloat(data.saldo_actual)   || parseFloat(data.saldo_inicial) || 0,
      tasa_mensual:  parseFloat(data.tasa_mensual)   || 0,
      cuota_mensual: parseFloat(data.cuota_mensual)  || 0,
      fecha_inicio:  data.fecha_inicio  || _hoyISO_(),
      fecha_fin:     data.fecha_fin     || '',
      dia_corte:     parseInt(data.dia_corte)  || '',
      dia_pago:      parseInt(data.dia_pago)   || 1,
      cuenta_pago:   data.cuenta_pago   || '',
      activa:        true,
      notas:         data.notas         || '',
      creado_el:     now
    };
    return d[h] !== undefined ? d[h] : '';
  });
  sh.appendRow(row);
  return { ok: true, deuda_id: id };
}

/**
 * Registra un pago a una deuda y reduce el saldo.
 */
function pagarDeuda(deuda_id, monto_pagado, crearMovimiento) {
  const sh   = _sh_(CFG.SHEETS.DEUDAS);
  if (!sh) throw new Error('Hoja Deudas no encontrada');
  const rows = sh.getDataRange().getValues();
  const hdr  = rows[0].map(h => String(h).trim());
  const cSaldo  = hdr.indexOf('saldo_actual');
  const cNombre = hdr.indexOf('nombre');
  const cCuenta = hdr.indexOf('cuenta_pago');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(deuda_id)) {
      const saldoAnterior = parseFloat(rows[i][cSaldo]) || 0;
      const nuevoSaldo    = Math.max(0, saldoAnterior - parseFloat(monto_pagado));
      sh.getRange(i+1, cSaldo+1).setValue(nuevoSaldo);

      // Si el saldo llega a 0, marcar como pagada
      if (nuevoSaldo === 0) {
        const cActiva = hdr.indexOf('activa');
        if (cActiva >= 0) sh.getRange(i+1, cActiva+1).setValue(false);
      }

      let movId = null;
      if (crearMovimiento !== false) {
        try {
          const res = guardarTransaccion({
            descripcion:   'Pago ' + rows[i][cNombre],
            monto:         parseFloat(monto_pagado),
            grupo:         'gasto',
            categoria:     'Deudas',
            cuenta_origen: rows[i][cCuenta] || '',
            fecha:         _hoyISO_(),
            fuente:        'manual',
            notas:         `Saldo anterior: ${saldoAnterior.toLocaleString('es-CO')}. Nuevo saldo: ${nuevoSaldo.toLocaleString('es-CO')}`
          });
          movId = res.id || res.mov_id;
        } catch(e) { Logger.log('No se pudo crear movimiento pago deuda: ' + e); }
      }
      return { ok: true, deuda_id, nuevo_saldo: nuevoSaldo, mov_id: movId };
    }
  }
  throw new Error('Deuda no encontrada');
}

/**
 * Elimina (desactiva) una deuda.
 */
function eliminarDeuda(deuda_id) {
  return guardarDeuda({ deuda_id, activa: false });
}

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN FINANCIERO GLOBAL (para dashboard y alertas)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve metas + recurrentes + deudas en un solo payload.
 */
function getFinanzasCompletas() {
  const metas       = getMetas();
  const recurrentes = getRecurrentes();
  const deudas      = getDeudas();

  const totalDeuda        = deudas.reduce((s,d) => s + d.saldo_actual, 0);
  const cuotasTotalesMes  = deudas.reduce((s,d) => s + d.cuota_mensual, 0);
  const recurrentesTotMes = recurrentes.reduce((s,r) => s + r.monto, 0);
  const recVencidos       = recurrentes.filter(r => r.estado === 'vencido' || r.estado === 'proximo');
  const metasProg         = metas.map(m => ({
    nombre: m.nombre,
    progreso_pct: m.progreso_pct,
    faltante: m.faltante
  }));
  const deudasUrgentes    = deudas.filter(d => d.urgencia !== 'normal');

  return {
    ok:               true,
    metas,
    recurrentes,
    deudas,
    resumen: {
      total_deuda:         totalDeuda,
      cuotas_mes:          cuotasTotalesMes,
      recurrentes_mes:     recurrentesTotMes,
      compromiso_fijo_mes: cuotasTotalesMes + recurrentesTotMes,
      rec_pendientes:      recVencidos.length,
      metas_activas:       metas.length,
      deudas_urgentes:     deudasUrgentes.length
    }
  };
}

// ── Wrappers UI (google.script.run) ─────────────────────────────────────────
function getMetasUI()                            { return getMetas(); }
function guardarMetaUI(data)                     { return guardarMeta(data); }
function aportarMetaUI(meta_id, monto)           { return aportarMeta(meta_id, monto); }
function eliminarMetaUI(meta_id)                 { return eliminarMeta(meta_id); }

function getRecurrentesUI()                      { return getRecurrentes(); }
function guardarRecurrenteUI(data)               { return guardarRecurrente(data); }
function marcarPagadoUI(rec_id, crearMov)        { return marcarRecurrentePagado(rec_id, crearMov); }
function eliminarRecurrenteUI(rec_id)            { return eliminarRecurrente(rec_id); }

function getDeudasUI()                           { return getDeudas(); }
function guardarDeudaUI(data)                    { return guardarDeuda(data); }
function pagarDeudaUI(deuda_id, monto, crearMov) { return pagarDeuda(deuda_id, monto, crearMov); }
function eliminarDeudaUI(deuda_id)               { return eliminarDeuda(deuda_id); }

function getFinanzasCompletasUI()                { return getFinanzasCompletas(); }
