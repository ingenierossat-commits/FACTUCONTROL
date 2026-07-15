/* =========================================================
   CONFIG FIREBASE — Realtime Database (igual que el resto
   de tus PWAs: DIANET, MANTIS, WATCHALL, etc.)
   ========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyChMXx5ZcleAo5oqzPvo1K_Af_wgQkh-LQ",
  authDomain: "listify-16b5d.firebaseapp.com",
  databaseURL: "https://listify-16b5d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "listify-16b5d",
  storageBucket: "listify-16b5d.appspot.com",
  messagingSenderId: "238610923350",
  appId: "1:238610923350:web:cd5c2c3fb23b5c0afba0f7"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const REF = db.ref('factucontrol/movimientos');

// ---------- Estado ----------
let movimientos = [];      // todos los docs, con id
let tipoSeleccionado = 'gasto';
let editandoId = null;
let fotoBase64Actual = null;

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const fmtEUR = (n) => (n||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const hoy = () => new Date();
const isoHoy = () => hoy().toISOString().slice(0,10);

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

function importeConIva(mov){
  if(mov.sinIva) return mov.neto;
  return mov.neto * (1 + (mov.ivaPct||0)/100);
}
function ivaDe(mov){
  if(mov.sinIva) return 0;
  return mov.neto * (mov.ivaPct||0)/100;
}

// ---------- Trimestres ----------
// T1 ene-mar (cierre 1 abr), T2 abr-jun (cierre 1 jul), T3 jul-sep (cierre 1 oct), T4 oct-dic (cierre 1 ene)
function trimestreDeFecha(d){
  const mes = d.getMonth()+1; // 1-12
  if(mes<=3) return 1;
  if(mes<=6) return 2;
  if(mes<=9) return 3;
  return 4;
}
function rangoTrimestre(anio, t){
  const inicios = {1:0,2:3,3:6,4:9};
  const start = new Date(anio, inicios[t], 1);
  const end = new Date(anio, inicios[t]+3, 1); // exclusivo
  return {start, end};
}
function proximoCierreInfo(){
  const d = hoy();
  const t = trimestreDeFecha(d);
  const cierres = {1:{mes:4,dia:1,label:'1 de abril'},2:{mes:7,dia:1,label:'1 de julio'},3:{mes:10,dia:1,label:'1 de octubre'},4:{mes:1,dia:1,label:'1 de enero'}};
  const c = cierres[t];
  const anioCierre = (t===4) ? d.getFullYear()+1 : d.getFullYear();
  return `Próximo resumen contable: ${c.label} de ${anioCierre} — corresponde a T${t} (${['ene-mar','abr-jun','jul-sep','oct-dic'][t-1]})`;
}

// ---------- Carga inicial + recurrencia ----------
async function cargarYGenerarRecurrentes(){
  const snap = await REF.once('value');
  movimientos = [];
  snap.forEach(child=>{
    movimientos.push({id: child.key, ...child.val()});
  });

  const plantillas = movimientos.filter(m => m.recurrente === true);
  const hoyD = hoy();
  const anioActual = hoyD.getFullYear();
  const mesActual = hoyD.getMonth(); // 0-11

  const nuevos = [];
  for(const pl of plantillas){
    const fechaPl = new Date(pl.fecha+'T00:00:00');
    let cursor = new Date(fechaPl.getFullYear(), fechaPl.getMonth()+1, 1); // mes siguiente al de la plantilla
    while(cursor.getFullYear() < anioActual || (cursor.getFullYear()===anioActual && cursor.getMonth() <= mesActual)){
      const yy = cursor.getFullYear(), mm = cursor.getMonth();
      const yaExiste = movimientos.some(m => m.origenId === pl.id && new Date(m.fecha+'T00:00:00').getFullYear()===yy && new Date(m.fecha+'T00:00:00').getMonth()===mm)
                        || (fechaPl.getFullYear()===yy && fechaPl.getMonth()===mm); // el propio mes de la plantilla
      if(!yaExiste){
        const diaOriginal = fechaPl.getDate();
        const ultimoDiaMes = new Date(yy, mm+1, 0).getDate();
        const dia = Math.min(diaOriginal, ultimoDiaMes);
        const nuevaFecha = new Date(yy, mm, dia).toISOString().slice(0,10);
        nuevos.push({
          tipo: pl.tipo, concepto: pl.concepto, neto: pl.neto, ivaPct: pl.ivaPct||0,
          sinIva: !!pl.sinIva, recurrente:false, origenId: pl.id, fotoBase64:null,
          fecha: nuevaFecha, creadoEn: firebase.database.ServerValue.TIMESTAMP
        });
      }
      cursor = new Date(yy, mm+1, 1);
    }
  }

  if(nuevos.length){
    const updates = {};
    nuevos.forEach(n=>{
      const newKey = REF.push().key;
      updates[newKey] = n;
    });
    await REF.update(updates);
    toast(`${nuevos.length} apunte(s) recurrente(s) añadido(s) automáticamente`);
    const snap2 = await REF.once('value');
    movimientos = [];
    snap2.forEach(child=>{ movimientos.push({id: child.key, ...child.val()}); });
  }

  render();
}

// ---------- Render lista ----------
function render(){
  $('headerSub').textContent = `${movimientos.length} apuntes registrados`;
  $('proximoCierre').innerHTML = proximoCierreInfo();

  const ordenados = [...movimientos].sort((a,b)=> b.fecha.localeCompare(a.fecha));
  const porMes = {};
  ordenados.forEach(m=>{
    const key = m.fecha.slice(0,7);
    (porMes[key] = porMes[key]||[]).push(m);
  });

  const cont = $('listaMovs');
  if(ordenados.length===0){
    cont.innerHTML = '<div class="empty">Sin apuntes todavía. Toca + para registrar el primero.</div>';
    return;
  }

  let html = '';
  Object.keys(porMes).sort().reverse().forEach(mesKey=>{
    const [yy,mm] = mesKey.split('-');
    const nombreMes = new Date(yy,mm-1,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
    html += `<div class="section-title">${nombreMes}</div><div class="card">`;
    porMes[mesKey].forEach(m=>{
      const importe = importeConIva(m);
      html += `
        <div class="movimiento" data-id="${m.id}">
          <div class="mov-left">
            <div class="mov-concepto">${escapeHtml(m.concepto||'(sin concepto)')}</div>
            <div class="mov-meta">${m.fecha} · neto ${fmtEUR(m.neto)}${m.sinIva?'':' · IVA '+(m.ivaPct||0)+'%'}</div>
          </div>
          <div class="mov-right">
            <div class="mov-importe ${m.tipo}">${m.tipo==='gasto'?'-':'+'}${fmtEUR(importe)}</div>
            <div class="mov-tags">
              ${m.sinIva?'<span class="tag">sin iva</span>':''}
              ${m.recurrente?'<span class="tag rec">recurrente</span>':''}
              ${m.origenId?'<span class="tag rec">auto</span>':''}
            </div>
            <div class="mov-actions">
              <button data-action="edit" data-id="${m.id}">editar</button>
              <button data-action="del" data-id="${m.id}">borrar</button>
            </div>
          </div>
        </div>`;
    });
    html += '</div>';
  });
  cont.innerHTML = html;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- Delegación de eventos lista ----------
document.getElementById('listaMovs').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.dataset.action==='edit') abrirModalEdicion(id);
  if(btn.dataset.action==='del') borrarApunte(id);
});

// ---------- Modal apunte ----------
function resetModal(){
  editandoId = null;
  fotoBase64Actual = null;
  $('modalTitulo').textContent = 'Nuevo apunte';
  $('inpConcepto').value='';
  $('inpFecha').value = isoHoy();
  $('inpNeto').value='';
  $('inpIvaPct').value='21';
  $('inpSinIva').checked=false;
  $('inpRecurrente').checked=false;
  $('inpFoto').value='';
  $('previewFoto').style.display='none';
  $('btnBorrarApunte').style.display='none';
  seleccionarTipo('gasto');
  actualizarVisibilidadIva();
}

function seleccionarTipo(t){
  tipoSeleccionado = t;
  $('btnTipoGasto').classList.toggle('on', t==='gasto');
  $('btnTipoCobro').classList.toggle('on', t==='cobro');
}
$('btnTipoGasto').onclick = ()=>seleccionarTipo('gasto');
$('btnTipoCobro').onclick = ()=>seleccionarTipo('cobro');

function actualizarVisibilidadIva(){
  $('fieldIvaPct').style.display = $('inpSinIva').checked ? 'none' : 'block';
}
$('inpSinIva').addEventListener('change', actualizarVisibilidadIva);

$('fabNuevo').onclick = ()=>{ resetModal(); $('modalApunte').classList.add('open'); };
$('closeApunte').onclick = ()=> $('modalApunte').classList.remove('open');

$('inpFoto').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  comprimirImagen(file, 900, 0.7).then(base64=>{
    fotoBase64Actual = base64;
    $('previewFoto').src = base64;
    $('previewFoto').style.display='block';
  });
});

function comprimirImagen(file, maxAncho, calidad){
  return new Promise((resolve)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxAncho){ h = h * (maxAncho/w); w = maxAncho; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function abrirModalEdicion(id){
  const m = movimientos.find(x=>x.id===id);
  if(!m) return;
  editandoId = id;
  fotoBase64Actual = m.fotoBase64 || null;
  $('modalTitulo').textContent = 'Editar apunte';
  seleccionarTipo(m.tipo);
  $('inpConcepto').value = m.concepto || '';
  $('inpFecha').value = m.fecha;
  $('inpNeto').value = m.neto;
  $('inpIvaPct').value = m.ivaPct || 0;
  $('inpSinIva').checked = !!m.sinIva;
  $('inpRecurrente').checked = !!m.recurrente;
  actualizarVisibilidadIva();
  if(fotoBase64Actual){ $('previewFoto').src = fotoBase64Actual; $('previewFoto').style.display='block'; }
  else { $('previewFoto').style.display='none'; }
  $('btnBorrarApunte').style.display='block';
  $('modalApunte').classList.add('open');
}

function conTimeout(promesa, ms=10000){
  return Promise.race([
    promesa,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tiempo agotado (10s) escribiendo en la base de datos — revisa conexión/reglas')), ms))
  ]);
}

$('btnGuardarApunte').onclick = async ()=>{
  const concepto = $('inpConcepto').value.trim();
  const neto = parseFloat($('inpNeto').value);
  const fecha = $('inpFecha').value;
  if(!concepto){ toast('Falta el concepto'); return; }
  if(isNaN(neto)){ toast('Neto no válido'); return; }
  if(!fecha){ toast('Falta la fecha'); return; }

  const sinIva = $('inpSinIva').checked;
  const data = {
    tipo: tipoSeleccionado,
    concepto,
    neto,
    ivaPct: sinIva ? 0 : (parseFloat($('inpIvaPct').value)||0),
    sinIva,
    recurrente: $('inpRecurrente').checked,
    fecha,
    fotoBase64: fotoBase64Actual || null
  };

  const btn = $('btnGuardarApunte');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try{
    if(editandoId){
      await conTimeout(REF.child(editandoId).update(data));
      const idx = movimientos.findIndex(m=>m.id===editandoId);
      if(idx>-1) movimientos[idx] = {...movimientos[idx], ...data};
      toast('Apunte actualizado');
    } else {
      data.origenId = null;
      data.creadoEn = firebase.database.ServerValue.TIMESTAMP;
      const newRef = REF.push();
      await conTimeout(newRef.set(data));
      movimientos.push({id: newRef.key, ...data, creadoEn: Date.now()});
      toast('Apunte guardado');
    }
    $('modalApunte').classList.remove('open');
    render();
    if($('cardResumenPrincipal').style.display==='block') calcularResumen();
  } catch(err){
    console.error('Fallo al guardar apunte:', err);
    toast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar apunte';
  }
};

$('btnBorrarApunte').onclick = async ()=>{
  if(!editandoId) return;
  await borrarApunte(editandoId);
  $('modalApunte').classList.remove('open');
};

async function borrarApunte(id){
  if(!confirm('¿Eliminar este apunte?')) return;
  await REF.child(id).remove();
  movimientos = movimientos.filter(m=>m.id!==id);
  toast('Apunte eliminado');
  render();
  if($('cardResumenPrincipal').style.display==='block') calcularResumen();
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.view).classList.add('active');
    if(tab.dataset.view === 'viewResumen') calcularResumen();
  });
});

// ---------- Resumen contable ----------
function initSelectores(){
  const anioSel = $('selAnio');
  const anioActual = hoy().getFullYear();
  for(let y = anioActual-1; y<=anioActual+1; y++){
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if(y===anioActual) opt.selected = true;
    anioSel.appendChild(opt);
  }
  // Preseleccionar el trimestre y año actuales (el de cierre anterior queda a un clic si lo necesitas)
  const t = trimestreDeFecha(hoy());
  $('selTrimestre').value = t;
  anioSel.value = anioActual;
}

function calcularResumen(){
  const t = parseInt($('selTrimestre').value);
  const anio = parseInt($('selAnio').value);
  const {start,end} = rangoTrimestre(anio,t);

  const enRango = movimientos.filter(m=>{
    const f = new Date(m.fecha+'T00:00:00');
    return f>=start && f<end;
  });

  const gastos = enRango.filter(m=>m.tipo==='gasto');
  const cobros = enRango.filter(m=>m.tipo==='cobro');

  const gastosConIva = gastos.filter(m=>!m.sinIva).reduce((s,m)=>s+importeConIva(m),0);
  const gastosSinIva = gastos.filter(m=>m.sinIva).reduce((s,m)=>s+m.neto,0);
  const ingresosConIva = cobros.filter(m=>!m.sinIva).reduce((s,m)=>s+importeConIva(m),0);
  const ingresosSinIva = cobros.filter(m=>m.sinIva).reduce((s,m)=>s+m.neto,0);

  const ivaSoportado = gastos.filter(m=>!m.sinIva).reduce((s,m)=>s+ivaDe(m),0);
  const ivaRepercutido = cobros.filter(m=>!m.sinIva).reduce((s,m)=>s+ivaDe(m),0);
  const liquidacion = ivaRepercutido - ivaSoportado;

  const netoTotalGastos = gastos.reduce((s,m)=>s+m.neto,0);
  const netoTotalIngresos = cobros.reduce((s,m)=>s+m.neto,0);
  const resultadoNeto = netoTotalIngresos - netoTotalGastos;

  $('valIvaAPagar').textContent = (liquidacion>=0?'+':'') + fmtEUR(liquidacion) + (liquidacion>=0 ? ' (a ingresar)' : ' (a compensar)');
  $('valIvaAPagar').className = 'summary-value ' + (liquidacion>=0 ? 'gasto' : 'cobro');
  $('valResultadoNeto').textContent = fmtEUR(resultadoNeto);
  $('valResultadoNeto').className = 'summary-value ' + (resultadoNeto>=0 ? 'cobro' : 'gasto');
  $('cardResumenHacienda').style.display='block';

  $('valGastosConIva').textContent = fmtEUR(gastosConIva);
  $('valGastosSinIva').textContent = fmtEUR(gastosSinIva);
  $('valIngresosConIva').textContent = fmtEUR(ingresosConIva);
  $('valIvaSoportado').textContent = fmtEUR(ivaSoportado);
  $('valIvaRepercutido').textContent = fmtEUR(ivaRepercutido);
  $('valLiquidacion').textContent = (liquidacion>=0?'+':'') + fmtEUR(liquidacion) + (liquidacion>=0 ? ' (a ingresar)' : ' (a compensar)');
  $('valIngresosSinIva').textContent = fmtEUR(ingresosSinIva);

  $('cardResumenPrincipal').style.display='block';
  $('cardResumenExtra').style.display='block';
}
$('btnCalcular').onclick = calcularResumen;
$('selTrimestre').addEventListener('change', calcularResumen);
$('selAnio').addEventListener('change', calcularResumen);

// ---------- Init ----------
initSelectores();
cargarYGenerarRecurrentes();

// ---------- Service worker ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(console.error);
  });
}
