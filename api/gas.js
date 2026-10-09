// Proxy Vercel → Google Apps Script (Galponix)
// Ruta: /api/gas   |   Variable opcional en Vercel: GAS_URL (URL del Web App /exec)
// Guardar como: api/gas.js (en la raíz del proyecto)
const GAS_URL = process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbx6raorZG8zueSQW7X3OZtI8cdC9kS-AhQkf8p5PGwAU4Hm93sF3Tu-Q8lIS34TDzCT6g/exec';

function responder(res, status, obj) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(JSON.stringify(obj));
}

async function llamarGAS(payload, esLectura) {
  const upstream = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: payload,
    redirect: 'follow',
    signal: AbortSignal.timeout(28000)
  });
  return { status: upstream.status, texto: await upstream.text() };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return responder(res, 405, { success: false, error: 'Método no permitido' });
  }

  try {
    // Vercel ya entrega req.body como objeto cuando el Content-Type es application/json
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const accion = (req.body && typeof req.body === 'object' && req.body.action) || '';
    const esLectura = /^get/.test(String(accion));

    // Apps Script responde con 302 hacia googleusercontent.com; fetch lo sigue solo
    let r;
    try {
      r = await llamarGAS(payload, esLectura);
    } catch (e) {
      // Las lecturas se reintentan una vez ante un fallo de red; las escrituras NO (evita duplicados)
      const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      if (esLectura && !timeout) r = await llamarGAS(payload, esLectura);
      else throw e;
    }

    // Si Google devuelve HTML (página de login, error o cuota excedida) no es JSON válido
    let json;
    try { json = JSON.parse(r.texto); }
    catch (e) {
      return responder(res, 502, {
        success: false,
        error: 'Apps Script no devolvió JSON (status ' + r.status + '). Revisa que el Web App esté publicado para «Cualquier persona».'
      });
    }
    return responder(res, 200, json);
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return responder(res, timeout ? 504 : 502, {
      success: false,
      error: timeout ? 'Timeout esperando a Apps Script' : 'No se pudo contactar con Apps Script: ' + (err && err.message)
    });
  }
};
