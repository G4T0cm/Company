const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const databaseURL = process.env.FIREBASE_DATABASE_URL;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL,
});

const db = admin.database();

const VOL_CONFIG_PATH = "volatilidad/config";
const VOL_LOG_PATH = "volatilidad/log";

async function aplicarVolatilidad() {
  try {
    // Leer configuración
    const cfgSnap = await db.ref(VOL_CONFIG_PATH).once("value");
    const cfg = cfgSnap.val() || { activo: true, min: 1, max: 5, precioMin: 100 };

    if (!cfg.activo) {
      console.log("Volatilidad desactivada, saliendo.");
      process.exit(0);
    }

    // Leer negocios
    const negSnap = await db.ref("negocios").once("value");
    if (!negSnap.exists()) {
      console.log("No hay negocios.");
      process.exit(0);
    }

    const negocios = negSnap.val();
    const ahora = Date.now();
    // CLAVE: todas las rutas son absolutas desde la raíz de la DB
    const updates = {};
    let subidas = 0, bajadas = 0;
    const detalle = [];

    for (const id in negocios) {
      const neg = negocios[id];
      if ((neg.estado || "activa") !== "activa") continue;
      if (!neg.valorAccion) continue;

      const rango = (cfg.max || 5) - (cfg.min || 1);
      const pct = (Math.random() * rango + (cfg.min || 1)) / 100;
      const sube = Math.random() >= 0.5;
      const precioActual = neg.valorAccion;

      let nuevoPrecio = sube
        ? precioActual * (1 + pct)
        : precioActual * (1 - pct);

      nuevoPrecio = Math.max(cfg.precioMin || 100, Math.round(nuevoPrecio));

      // Ruta absoluta desde la raíz
      updates[`negocios/${id}/valorAccion`] = nuevoPrecio;

      // Nuevo nodo en historial con push key manual
      const histKey = db.ref().push().key;
      updates[`negocios/${id}/valorHistorial/${histKey}`] = {
        ts: ahora,
        precio: nuevoPrecio,
      };

      if (sube) subidas++; else bajadas++;
      detalle.push({
        negocio: neg.nombre,
        anterior: precioActual,
        nuevo: nuevoPrecio,
        sube,
        pct: Math.round(pct * 10000) / 100,
        ts: ahora,
      });
    }

    if (!Object.keys(updates).length) {
      console.log("Sin negocios activos para procesar.");
      process.exit(0);
    }

    // Un solo update atómico desde la raíz
    await db.ref().update(updates);

    // Log global
    const logKey = db.ref().push().key;
    await db.ref(`${VOL_LOG_PATH}/${logKey}`).set({
      ts: ahora,
      subidas,
      bajadas,
      negocios: detalle.length,
      detalle,
    });

    console.log(`✅ Volatilidad aplicada: ${subidas} ▲ subidas · ${bajadas} ▼ bajadas`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

aplicarVolatilidad();
