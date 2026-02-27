const admin = require("firebase-admin");

// Leer secrets desde variables de entorno
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const databaseURL = process.env.FIREBASE_DATABASE_URL;

// Inicializar Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL,
});

const db = admin.database();

// Configuración de volatilidad (puedes ajustarla desde Firebase / frontend)
const VOL_CONFIG_PATH = 'volatilidad/config';
const VOL_LOG_PATH = 'volatilidad/log';

async function aplicarVolatilidad() {
  try {
    // Leer configuración de volatilidad desde Firebase
    const cfgSnap = await db.ref(VOL_CONFIG_PATH).once('value');
    const cfg = cfgSnap.val() || { activo: true, min: 1, max: 5, precioMin: 100 };

    if (!cfg.activo) {
      console.log("Volatilidad desactivada, no se aplica nada.");
      return;
    }

    // Leer negocios
    const ref = db.ref("negocios");
    const snap = await ref.once("value");

    if (!snap.exists()) {
      console.log("No hay negocios para procesar.");
      return;
    }

    const negocios = snap.val();
    const updates = {};
    const ahora = Date.now();
    let subidas = 0, bajadas = 0;
    const detalle = [];

    for (const id in negocios) {
      const neg = negocios[id];
      if ((neg.estado || 'activa') !== 'activa') continue;
      if (!neg.valorAccion) continue;

      // Variación aleatoria entre min% y max%
      const rango = cfg.max - cfg.min;
      const pct = (Math.random() * rango + cfg.min) / 100;
      const sube = Math.random() >= 0.5;
      const precioActual = neg.valorAccion;
      let nuevoPrecio = sube ? precioActual * (1 + pct) : precioActual * (1 - pct);

      // Aplicar precio mínimo y redondear
      nuevoPrecio = Math.max(cfg.precioMin || 100, Math.round(nuevoPrecio));

      updates[`${id}/valorAccion`] = nuevoPrecio;

      // Guardar historial
      const histRef = db.ref(`negocios/${id}/valorHistorial`).push();
      updates[`negocios/${id}/valorHistorial/${histRef.key}`] = { ts: ahora, precio: nuevoPrecio };

      if (sube) subidas++; else bajadas++;
      detalle.push({ negocio: neg.nombre, anterior: precioActual, nuevo: nuevoPrecio, sube, pct: Math.round(pct * 10000) / 100, ts: ahora });
    }

    if (!Object.keys(updates).length) {
      console.log("No hay negocios activos para procesar.");
      return;
    }

    // Actualizar Firebase
    await ref.update(updates);

    // Guardar log global de volatilidad
    const logKey = db.ref(VOL_LOG_PATH).push();
    await db.ref(`${VOL_LOG_PATH}/${logKey.key}`).set({ ts: ahora, subidas, bajadas, negocios: Object.keys(negocios).length, detalle });

    console.log(`📉 Volatilidad aplicada: ${subidas} ▲ subidas · ${bajadas} ▼ bajadas`);
  } catch (err) {
    console.error("Error aplicando volatilidad:", err);
    process.exit(1);
  }
}

aplicarVolatilidad();
