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

/* Tope de fotos acumuladas esperando a que el invitado pulse
   "Subir fotos". Con la cámara se puede hacer una detrás de otra,
   así que este guard es más real que antes: solo salta si alguien
   hace más de 30 fotos sin pulsar el botón. */
const FOTOS_COLA_MAX = 30;

/* En el index las fotos van en una tira horizontal, así que solo se
   ven unas 3. El botón de "ver galería completa" (página /galeria,
   donde sí van todas en vertical) aparece en cuanto hay al menos
   una foto, no a partir de un mínimo: hasta con dos fotos subidas
   tiene sentido poder verlas grandes. */
const FOTOS_TIRA_MIN = 1;

let fotosCola = [];
let fotosSubiendo = false;
/* Se pone a true en cuanto el invitado hace la primera foto con la
   cámara. A partir de ahí la opción de galería se deshabilita y solo
   se puede seguir haciendo fotos. No se guarda en ningún sitio: al
   recargar la página el flujo vuelve a empezar abierto. */
let fotosSoloCamara = false;
/* Texto que tenía la opción de galería antes de bloquearla, para
   poder devolverlo tal cual al desbloquear en vez de reescribirlo
   aquí y que se quede viejo si algún día cambia la redacción. */
let fotosSubGalTexto = null;
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

/* Al hacer la primera foto con la cámara, la opción de galería
   queda bloqueada para el resto de la sesión: si has empezado
   con la cámara, sigues con la cámara. Un doble bloqueo por si
   acaso: el CSS pone pointer-events:none en la etiqueta y aquí
   además se desactiva el input y se ignoran los ficheros. */
function fotosBloquearGaleria() {
  fotosSoloCamara = true;
  const lab = document.getElementById('fotos-pick-gal');
  if (lab) {
    lab.classList.add('bloqueada');
    lab.setAttribute('aria-disabled', 'true');
  }
  const sub = document.getElementById('fotos-sub-gal');
  if (sub) {
    if (fotosSubGalTexto === null) fotosSubGalTexto = sub.textContent;
    sub.textContent = 'solo cámara';
  }
  const inp = document.getElementById('fotos-input');
  if (inp) inp.disabled = true;
}

/* Contrario de lo anterior: al terminar de subir las fotos de la
   cámara, la galería vuelve a estar disponible. El caso real es que
   el invitado lleva un rato haciendo fotos, las sube, y luego
   quiere añadir otras que ya tenía en el móvil y no ha subido. Si
   la galería se quedara bloqueada para siempre no podría, y perder
   fotos ajenas al navegador por un candado que ya no hace falta es
   la peor forma de perderlas. */
function fotosDesbloquearGaleria() {
  if (!fotosSoloCamara) return;
  fotosSoloCamara = false;
  const lab = document.getElementById('fotos-pick-gal');
  if (lab) {
    lab.classList.remove('bloqueada');
    lab.removeAttribute('aria-disabled');
  }
  const sub = document.getElementById('fotos-sub-gal');
  if (sub && fotosSubGalTexto !== null) sub.textContent = fotosSubGalTexto;
  const inp = document.getElementById('fotos-input');
  if (inp) inp.disabled = false;
}

/* auto: true cuando la foto viene de la cámara (el input que lleva
   capture="environment"). La foto NO se sube sola: se queda en la
   cola, preparada, y el invitado sigue haciendo más hasta que
   pulsa "Subir fotos". Elegir en la galería del móvil mantiene el
   flujo de siempre: varias de golpe, revisión y botón. */
function fotosElegir(files, auto) {
  if (!auto && fotosSoloCamara) return;
  const sel = Array.from(files || []).filter(f => f.type && f.type.indexOf('image/') === 0);
  ['fotos-input', 'fotos-input-cam'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (!sel.length) {
    fotosEstado('Solo se aceptan imágenes.', 'err');
    return;
  }
  if (auto) fotosBloquearGaleria();
  const nuevas = sel.slice(0, FOTOS_MAX);
  /* ¿Se añaden al final o sustituyen a lo que había?
     La cámara ACUMULA siempre que ya haya fotos preparadas: es lo
     que se ha pedido, hacer varias fotos seguidas y subirlas juntas.
     Antes esto solo se acumulaba si había una subida en marcha, y
     al dejar de subida automática el hueco dejó de existir: hacer
     dos fotos seguidas dejaba solo la segunda. La galería sí
     sustituye, porque es un "elige tu tanda" de una vez: si te
     arrepientes y vuelves a elegir, quieres que gane la nueva. */
  const acumular = fotosSubiendo || (auto && fotosCola.length > 0);
  let topado = false;
  if (acumular) {
    fotosCola = fotosCola.concat(nuevas);
    if (fotosCola.length > FOTOS_COLA_MAX) {
      fotosCola = fotosCola.slice(0, FOTOS_COLA_MAX);
      topado = true;
    }
  } else {
    fotosCola = nuevas;
  }
  const n = fotosCola.length;
  if (topado) {
    fotosEstado('Solo caben ' + FOTOS_COLA_MAX + ' sin subir. Pulsa Subir fotos y añade el resto después.', 'ok');
  } else if (auto) {
    fotosEstado(n + (n === 1 ? ' foto preparada' : ' fotos preparadas') +
      '. Puedes hacer más y luego pulsa Subir fotos.', 'ok');
  } else if (sel.length > FOTOS_MAX) {
    fotosEstado('Máximo ' + FOTOS_MAX + ' fotos por vez: subiremos las ' + FOTOS_MAX + ' primeras.', 'ok');
  } else {
    fotosEstado(n + (n === 1 ? ' foto lista para subir.' : ' fotos listas para subir.'), 'ok');
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
  const cola = fotosCola;
  // A partir de aquí la cola queda VACÍA y pasa a significar solo
  // "pendientes": si el invitado hace otra foto o elige más
  // mientras esta tanda sube, se acumulan aquí y se subirán en la
  // ronda siguiente. Mezclar los dos papeles hacía que la foto en
  // vuelo se volviera a subir.
  fotosCola = [];
  const total = cola.length;
  let subidas = 0;
  let fallidas = 0;
  let fallosFormato = 0;
  for (let i = 0; i < total; i++) {
    fotosEstado('Subiendo foto ' + (i + 1) + ' de ' + total + '…');
    try {
      await fotosSubirUna(cola[i]);
      subidas++;
    } catch (e) {
      fallidas++;
      if (e && e.fotosFormato) fallosFormato++;
      fotosLog('subida_fallida', 'foto ' + (i + 1) + '/' + total + ' (' + (cola[i] && cola[i].type) + '): ' + ((e && e.message) || e));
    }
  }
  const quedan = fotosCola.length;
  if (!quedan) {
    const prev = document.getElementById('fotos-prev');
    if (prev) prev.innerHTML = '';
  }
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
  /* La cámara deja de retener al invitado solo cuando la tanda se ha
     subido ENTERA y no queda nada pendiente. Si falló alguna se
     mantiene el bloqueo, porque todavía tiene fotos sueltas y lo
     natural es seguir haciéndolas con la cámara, que es lo que
     estaba usando. */
  if (fallidas === 0 && subidas > 0 && quedan === 0) fotosDesbloquearGaleria();
  fotosCargar();
  // Lo que se acumuló mientras subíamos sale ahora, en otra ronda.
  if (quedan) fotosSubir();
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
  if (btn) btn.classList.toggle('on', fotosItems.length >= FOTOS_TIRA_MIN);
}

/* El visor abre una entrada propia en el historial del navegador.
   Sin esto, el gesto de "atrás" del móvil no tenía nada que
   consumir y se llevaba al invitado FUERA de la web de un salto,
   sin llegar siquiera a cerrar el visor: el zoom no había formado
   parte de la navegación. Con la entrada, el gesto lo cierra y la
   web se queda exactamente donde estaba. */
let fotosLbHist = false;

function fotosLbAbrir(i) {
  if (!fotosItems.length) return;
  fotosIdx = i;
  const lb = document.getElementById('fotos-lb');
  const img = document.getElementById('fotos-lb-img');
  if (!lb || !img) return;
  img.src = fotosItems[i].full;
  lb.classList.add('abierta');
  // Solo la apertura crea entrada. Si no, pasar de foto a foto con
  // los flechitos o deslizando añadiría una entrada por cada foto y
  // el "atrás" daría pasos de una en una, que es peor.
  if (!fotosLbHist) {
    fotosLbHist = true;
    // Se pasa location.href para que la barra de direcciones no
    // cambie: el invitado no ve nada, solo nota que "atrás" cierra
    // el visor en vez de echarlo de la web.
    history.pushState({ fotosLb: true }, '', location.href);
  }
}

function fotosLbMover(d) {
  if (!fotosItems.length) return;
  fotosLbAbrir((fotosIdx + d + fotosItems.length) % fotosItems.length);
}

function fotosLbCerrar() {
  const lb = document.getElementById('fotos-lb');
  if (lb) lb.classList.remove('abierta');
  if (fotosLbHist) {
    // El flag se baja ANTES de history.back(), porque esa llamada
    // dispara popstate y el listener de abajo no debe volver a
    // cerrar. Con el flag ya en false, se limita a no hacer nada.
    fotosLbHist = false;
    history.back();
  }
}

/* El gesto de "atrás" del móvil. El navegador ya está retrocediendo
   hacia la entrada anterior, así que aquí NO se llama a history.back
   (sería navegar dos veces): solo se cierra el visor. Si el flag
   está en false es que la entrada ya se consumió cerrando con la X,
   y entonces no hay nada que hacer. */
window.addEventListener('popstate', () => {
  if (!fotosLbHist) return;
  fotosLbHist = false;
  const lb = document.getElementById('fotos-lb');
  if (lb) lb.classList.remove('abierta');
});

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
