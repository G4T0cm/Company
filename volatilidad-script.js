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

async function aplicarVolatilidad() {
  try {
    const ref = db.ref("productos");
    const snapshot = await ref.once("value");

    if (!snapshot.exists()) {
      console.log("No hay productos para procesar.");
      return;
    }

    const productos = snapshot.val();
    const updates = {};

    for (const id in productos) {
      const producto = productos[id];

      if (!producto.precio) continue;

      // Variación aleatoria ±5%
      const variacion = 1 + (Math.random() * 0.1 - 0.05);
      const nuevoPrecio = Math.round(producto.precio * variacion * 100) / 100;

      updates[`${id}/precio`] = nuevoPrecio;
    }

    await ref.update(updates);
    console.log("Volatilidad aplicada correctamente.");
  } catch (error) {
    console.error("Error aplicando volatilidad:", error);
    process.exit(1);
  }
}

aplicarVolatilidad();
