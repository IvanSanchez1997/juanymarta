/* ══════════════════════════════════════════════════════════════
   GALERÍA DE FOTOS DE INVITADOS — cliente

   Infra: Worker «boda-fotos-jm» + bucket R2 «boda-fotos-jm»
   en la zona binvita.es (Cloudflare).

   ⚠️  SI CAMBIAS LOS DOMINIOS, TOCA SOLO ESTAS 4 LÍNEAS.
       Nada más en el archivo depende de ellas.
   ══════════════════════════════════════════════════════════════ */
const FOTOS_UPLOAD_URL  = 'https://api-fotos-jm.binvita.es/upload';
const FOTOS_LIST_URL    = 'https://api-fotos-jm.binvita.es/list';
const FOTOS_LOG_URL     = 'https://api-fotos-jm.binvita.es/log';
const FOTOS_PUBLIC_BASE = 'https://fotos-jm.binvita.es/';
/* ══════════════════════════════════════════════════════════════ */

const FOTOS_MAX = 12;
const FOTOS_REINTENTOS = 3;

/* En el index las fotos van en una tira horizontal, así que solo
   se ven unas 3. A partir de este número tiene sentido ofrecer el
   botón de "ver galería completa" (página /galeria, donde sí van
   todas en vertical). */
const FOTOS_TIRA_MAX = 6;

let fotosCola = [];
let fotosSubiendo = false;
let fotosItems = [];
let fotosIdx = 0;
let fotosLogEnviados = 0;

function fotosLog(evento, detalle) {
  console.error('[fotos]', evento, detalle);
  if (fotosLogEnviados >= 12) return;
  fotosLogEnviados++;
  try {
    fetch(FOTOS_LOG_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        t: new Date().toISOString(),
        e: evento,
        d: String(detalle || '').slice(0, 400),
        p: location.protocol + '//' + location.host
      })
    }).catch(() => {});
  } catch (e) {}
}

function fotosEstado(msg, tipo) {
  const el = document.getElementById('fotos-estado');
  if (!el) return;
  el.textContent = msg;
  el.className = 'fotos-estado' + (tipo ? ' fotos-' + tipo : '');
}

function fotosEsperar(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function fotosElegir(files) {
  const sel = Array.from(files || []).filter(f => f.type && f.type.indexOf('image/') === 0);
  ['fotos-input', 'fotos-input-cam'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (!sel.length) {
    fotosEstado('Solo se aceptan imágenes.', 'err');
    return;
  }
  fotosCola = sel.slice(0, FOTOS_MAX);
  if (sel.length > FOTOS_MAX) {
    fotosEstado('Máximo ' + FOTOS_MAX + ' fotos por vez: subiremos las ' + FOTOS_MAX + ' primeras.', 'ok');
  } else {
    fotosEstado(fotosCola.length + (fotosCola.length === 1 ? ' foto lista para subir.' : ' fotos listas para subir.'), 'ok');
  }
  const prev = document.getElementById('fotos-prev');
  if (!prev) return;
  prev.innerHTML = '';
  fotosCola.forEach(f => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(f);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    prev.appendChild(img);
  });
}

async function fotosDecodificar(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    try {
      return await createImageBitmap(file);
    } catch (e2) {
      return null;
    }
  }
}

async function fotosProcesar(file) {
  const bmp = await fotosDecodificar(file);
  if (!bmp) return null;
  const lienzo = (maxLado, calidad) => new Promise(res => {
    const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * escala));
    c.height = Math.max(1, Math.round(bmp.height * escala));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    c.toBlob(b => res(b), 'image/jpeg', calidad);
  });
  const full = await lienzo(1600, 0.85);
  const thumb = await lienzo(480, 0.8);
  if (bmp.close) bmp.close();
  if (!full || !thumb) return null;
  return { full: full, thumb: thumb };
}

async function fotosPost(blob, nombre) {
  let err = null;
  for (let intento = 1; intento <= FOTOS_REINTENTOS; intento++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let reintentar = true;
    try {
      const r = await fetch(FOTOS_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-file-name': nombre },
        body: blob,
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (r.ok) return true;
      err = new Error('HTTP ' + r.status);
      reintentar = r.status >= 500 || r.status === 408 || r.status === 429;
    } catch (e) {
      clearTimeout(timer);
      err = ctrl.signal.aborted ? new Error('sin respuesta (timeout)') : e;
    }
    if (!reintentar) break;
    if (intento < FOTOS_REINTENTOS) await fotosEsperar(intento * 900);
  }
  throw err || new Error('sin conexión');
}

async function fotosSubirUna(file) {
  let par = await fotosProcesar(file);
  if (!par) {
    const valido = ['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) !== -1 && file.size <= 8 * 1024 * 1024;
    if (!valido) {
      const e = file.size > 8 * 1024 * 1024
        ? new Error('foto demasiado grande (> 8 MB)')
        : new Error('formato no compatible' + (file.type ? ' (' + file.type + ')' : ''));
      e.fotosFormato = true;
      throw e;
    }
    par = { full: file, thumb: file };
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await fotosPost(par.full, id + '_f.jpg');
  await fotosPost(par.thumb, id + '_t.jpg');
}

async function fotosSubir() {
  if (fotosSubiendo) return;
  if (!fotosCola.length) {
    fotosEstado('Elige primero tus fotos.', 'err');
    return;
  }
  fotosSubiendo = true;
  const btn = document.getElementById('fotos-btn');
  if (btn) btn.disabled = true;
  const total = fotosCola.length;
  let subidas = 0;
  let fallidas = 0;
  let fallosFormato = 0;
  for (let i = 0; i < total; i++) {
    fotosEstado('Subiendo foto ' + (i + 1) + ' de ' + total + '…');
    try {
      await fotosSubirUna(fotosCola[i]);
      subidas++;
    } catch (e) {
      fallidas++;
      if (e && e.fotosFormato) fallosFormato++;
      fotosLog('subida_fallida', 'foto ' + (i + 1) + '/' + total + ' (' + (fotosCola[i] && fotosCola[i].type) + '): ' + ((e && e.message) || e));
    }
  }
  fotosCola = [];
  const prev = document.getElementById('fotos-prev');
  if (prev) prev.innerHTML = '';
  if (btn) btn.disabled = false;
  fotosSubiendo = false;
  if (fallidas === 0) {
    fotosEstado('¡' + subidas + (subidas === 1 ? ' foto subida!' : ' fotos subidas!'), 'ok');
  } else if (subidas === 0 && fallosFormato === fallidas) {
    fotosEstado('No podemos procesar alguna de estas fotos. Prueba con fotos guardadas en JPG.', 'err');
  } else if (subidas === 0) {
    fotosEstado('No podemos subir las fotos ahora. Comprueba tu conexión e inténtalo en unos minutos.', 'err');
  } else {
    fotosEstado(subidas + (subidas === 1 ? ' subida · ' : ' subidas · ') + fallidas + (fallidas === 1 ? ' fallida.' : ' fallidas.') + ' Inténtalo de nuevo con las que falten.', 'err');
  }
  fotosCargar();
}

async function fotosCargar() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(FOTOS_LIST_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let data = await r.json();
    if (!Array.isArray(data)) data = (data && data.keys) || [];
    const ids = {};
    data.forEach(entrada => {
      const k = typeof entrada === 'string' ? entrada : entrada.key;
      const m = k && k.match(/^fotos\/(.+)_(f|t)\.jpg$/);
      if (!m) return;
      if (!ids[m[1]]) ids[m[1]] = {};
      ids[m[1]][m[2]] = k;
    });
    fotosItems = Object.keys(ids)
      .filter(id => ids[id].t)
      .sort()
      .reverse()
      .map(id => ({
        thumb: FOTOS_PUBLIC_BASE + ids[id].t,
        full: FOTOS_PUBLIC_BASE + (ids[id].f || ids[id].t)
      }));
    fotosPintar();
  } catch (e) {
    clearTimeout(timer);
    fotosLog('galeria_fallida', ((e && e.message) || e));
  }
}

function fotosPintar() {
  // La misma función sirve para las dos páginas: en /index pinta la
  // tira horizontal, en /galeria la rejilla vertical completa.
  const gal = document.getElementById('fotos-gal') || document.getElementById('fotos-gal-full');
  const vacio = document.getElementById('fotos-vacio');
  if (!gal) return;
  const completa = gal.id === 'fotos-gal-full';
  gal.innerHTML = '';
  if (vacio) vacio.style.display = fotosItems.length ? 'none' : '';
  // Solo en /galeria: "12 fotos" junto al enlace de volver.
  const contador = document.getElementById('fotos-count');
  if (contador) {
    contador.textContent = fotosItems.length === 1
      ? '1 foto'
      : fotosItems.length + ' fotos';
  }
  fotosItems.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fotos-item';
    b.style.animationDelay = Math.min(i, 8) * 0.04 + 's';
    const img = document.createElement('img');
    // En la rejilla de /galeria la foto se ve a 150px, así que
    // merece la pena cargar la versión grande y no la miniatura.
    img.src = completa ? it.full : it.thumb;
    img.loading = 'lazy';
    img.alt = 'Foto de la boda';
    b.appendChild(img);
    b.addEventListener('click', () => fotosLbAbrir(i));
    gal.appendChild(b);
  });
  fotosAjustarTira();
}

/* Solo existen en /index. El botón de la página completa aparece
   cuando hay muchas fotos; la flecha de "desliza", cuando la tira
   realmente desborda. En /galeria no hay ninguno de los dos. */
function fotosAjustarTira() {
  const btn = document.getElementById('fotos-ver-todas');
  const hint = document.getElementById('fotos-gal-hint');
  const gal = document.getElementById('fotos-gal');
  if (!btn && !hint) return;
  if (hint) hint.classList.toggle('on', !!gal && gal.scrollWidth > gal.clientWidth + 4);
  if (btn) btn.classList.toggle('on', fotosItems.length > FOTOS_TIRA_MAX);
}

function fotosLbAbrir(i) {
  if (!fotosItems.length) return;
  fotosIdx = i;
  const lb = document.getElementById('fotos-lb');
  const img = document.getElementById('fotos-lb-img');
  if (!lb || !img) return;
  img.src = fotosItems[i].full;
  lb.classList.add('abierta');
}

function fotosLbMover(d) {
  if (!fotosItems.length) return;
  fotosLbAbrir((fotosIdx + d + fotosItems.length) % fotosItems.length);
}

function fotosLbCerrar() {
  const lb = document.getElementById('fotos-lb');
  if (lb) lb.classList.remove('abierta');
}

document.addEventListener('keydown', e => {
  const lb = document.getElementById('fotos-lb');
  if (!lb || !lb.classList.contains('abierta')) return;
  if (e.key === 'Escape') fotosLbCerrar();
  else if (e.key === 'ArrowRight') fotosLbMover(1);
  else if (e.key === 'ArrowLeft') fotosLbMover(-1);
});

let fotosTocX = null;
const fotosLbEl = document.getElementById('fotos-lb');
if (fotosLbEl) {
  fotosLbEl.addEventListener('touchstart', e => {
    fotosTocX = e.touches[0].clientX;
  }, { passive: true });
  fotosLbEl.addEventListener('touchend', e => {
    if (fotosTocX === null) return;
    const dx = e.changedTouches[0].clientX - fotosTocX;
    fotosTocX = null;
    if (Math.abs(dx) > 45) fotosLbMover(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// Al girar el móvil cambia cuántas fotos caben en la tira, así que
// el botón y la flecha se recalculan. Se registra una sola vez, aquí,
// y no dentro de fotosSubir().
window.addEventListener('resize', fotosAjustarTira, { passive: true });

fotosCargar();
