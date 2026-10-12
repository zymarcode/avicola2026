// Proxy Vercel → Google Apps Script (multi-proyecto)
// Ruta: /api/gas            → proyecto por defecto (compatible con lo que ya tienes)
//       /api/gas?app=otro   → otro proyecto
//
// Variables en Vercel (Settings > Environment Variables), una por proyecto:
//   GAS_URL            URL /exec del proyecto por defecto (Galponix)
//   GAS_URL_OTRO       URL /exec del proyecto «otro»      (nombre en MAYÚSCULAS, guiones → _)
//   GAS_URL_MIAPP      ... y así con cada proyecto nuevo (no hay que tocar este archivo)
//
// Solo se aceptan nombres de app con letras, números, guion y guion bajo, y SOLO los que
// tengan su variable definida: nunca se reenvía a una URL que venga del navegador.

const DEFAULT_URL = process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbx6raorZG8zueSQW7X3OZtI8cdC9kS-AhQkf8p5PGwAU4Hm93sF3Tu-Q8lIS34TDzCT6g/exec';

function responder(res, status, obj) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(JSON.stringify(obj));
}

// Devuelve la URL del proyecto pedido, o null si no existe
function resolverUrl(app) {
  if (!app) return DEFAULT_URL;
  if (!/^[a-z0-9_-]{1,40}$/i.test(app)) return null;
  const clave = 'GAS_URL_' + app.toUpperCase().replace(/-/g, '_');
  const url = process.env[clave];
  return (url && /^https:\/\/script\.google\.com\//.test(url)) ? url : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return responder(res, 405, { success: false, error: 'Método no permitido' });
  }

  const app = String((req.query && req.query.app) || req.headers['x-app'] || '').trim();
  const GAS_URL = resolverUrl(app);
  if (!GAS_URL) {
    return responder(res, 404, { success: false, error: 'Proyecto «' + app + '» no configurado en el proxy.' });
  }

  try {
    // Vercel ya entrega req.body como objeto cuando el Content-Type es application/json
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

    // Apps Script responde con 302 hacia googleusercontent.com; fetch lo sigue solo
    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
      redirect: 'follow',
      signal: AbortSignal.timeout(28000)
    });

    const texto = await upstream.text();

    // Si Google devuelve HTML (página de login, error o cuota excedida) no es JSON válido
    let json;
    try { json = JSON.parse(texto); }
    catch (e) {
      return responder(res, 502, {
        success: false,
        error: 'Apps Script no devolvió JSON (status ' + upstream.status + '). Revisa que el Web App esté publicado para «Cualquier persona».'
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
