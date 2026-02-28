const admin = require("firebase-admin");
// fetch compatible con Node 18
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1477314293946122376/jYG54gCmMAObMCqZfGfZJvv2O-AvOfZzixJ1yw8Ev1OY1PocFXoDPqrE24N6nBGQ7R8X";
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const databaseURL = process.env.FIREBASE_DATABASE_URL;
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL,
});
const db = admin.database();
const VOL_CONFIG_PATH = "volatilidad/config";

async function enviarADiscord(detalle, subidas, bajadas, ts) {
  const lines = detalle.slice(0, 20).map(d =>
    `${d.sube ? "🟢" : "🔴"} **${d.negocio}**  
${fmtMoney(d.anterior)} → **${fmtMoney(d.nuevo)}** (${d.sube ? "+" : "-"}${d.pct}%)`
  );
  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "📈 Volatilidad",
      embeds: [
        {
          title: "Cambios de volatilidad aplicados",
          description: lines.join("\n"),
          color: subidas >= bajadas ? 0x2ecc71 : 0xe74c3c,
          footer: {
            text: `▲ ${subidas} subidas · ▼ ${bajadas} bajadas`,
          },
          timestamp: new Date(ts).toISOString(),
        },
      ],
    }),
  });
}

function fmtMoney(n){
  if(n>=1e6)return`$${(n/1e6).toFixed(2)}M`;
  if(n>=1e3)return`$${(n/1e3).toFixed(1)}K`;
  return`$${Number(n).toLocaleString("es-ES")}`;
}

async function aplicarVolatilidad() {
  try {
    console.log("🔄 Iniciando volatilidad...");
    const cfgSnap = await db.ref(VOL_CONFIG_PATH).once("value");
    const cfg = cfgSnap.val() || {
      activo: true,
      precioMin: 100
      // Volatilidad por tramos de precio:
      // 0-100: 1-2%
      // 101-200: 1-2%
      // 201-300: 1-3%
      // 301-500: 1-4%
      // 501-800: 1-6%
      // 801+: 1-7%
    };
    console.log("⚙️ Configuración:", cfg);
    if (!cfg.activo) {
      console.log("Volatilidad desactivada, saliendo.");
      process.exit(0);
    }
    const negSnap = await db.ref("negocios").once("value");
    if (!negSnap.exists()) {
      console.log("No hay negocios.");
      process.exit(0);
    }
    const negocios = negSnap.val();
    console.log(`📊 Negocios encontrados: ${Object.keys(negocios).length}`);
    const ahora = Date.now();
    const updates = {};
    let subidas = 0, bajadas = 0;
    const detalle = [];
    let negociosActivos = 0;
    for (const id in negocios) {
      const neg = negocios[id];
      if ((neg.estado || "activa") !== "activa") continue;
      if (!neg.valorAccion) continue;
      negociosActivos++;
      const precioActual = neg.valorAccion;
      
      // Determinar volatilidad según tramos de precio
      let minVol, maxVol;
      
      if (precioActual <= 100) {
        minVol = 1;
        maxVol = 2;
      } else if (precioActual <= 200) {
        minVol = 1;
        maxVol = 2;
      } else if (precioActual <= 300) {
        minVol = 1;
        maxVol = 3;
      } else if (precioActual <= 500) {
        minVol = 1;
        maxVol = 4;
      } else if (precioActual <= 800) {
        minVol = 1;
        maxVol = 6;
      } else {
        minVol = 1;
        maxVol = 7;
      }
      
      const rango = maxVol - minVol;
      const pct = (Math.random() * rango + minVol) / 100;
      const sube = Math.random() >= 0.5;
      
      let nuevoPrecio = sube
        ? precioActual * (1 + pct)
        : precioActual * (1 - pct);
      nuevoPrecio = Math.max(cfg.precioMin || 100, Math.round(nuevoPrecio));
      updates[`negocios/${id}/valorAccion`] = nuevoPrecio;
      const histKey = db.ref().push().key;
      updates[`negocios/${id}/valorHistorial/${histKey}`] = {
        ts: ahora,
        precio: nuevoPrecio,
      };
      if (sube) subidas++;
      else bajadas++;
      const cambio = nuevoPrecio - precioActual;
      detalle.push({
        negocio: neg.nombre,
        anterior: precioActual,
        nuevo: nuevoPrecio,
        sube,
        pct: Math.round(pct * 10000) / 100,
        cambio: cambio,
        ts: ahora
      });
      console.log(`${sube ? "▲" : "▼"} ${neg.nombre}: ${fmtMoney(precioActual)} → ${fmtMoney(nuevoPrecio)} (${minVol}-${maxVol}%)`);
    }
    if (!Object.keys(updates).length) {
      console.log("Sin negocios activos.");
      process.exit(0);
    }
    console.log(`✅ Aplicando ${negociosActivos} cambios (${subidas} subidas, ${bajadas} bajadas)...`);
    await db.ref().update(updates);
    console.log("📝 Precios actualizados en Firebase");
    
    // 🔴 GUARDAR EN VOLATILIDAD/LOG CORRECTAMENTE
    console.log("📝 Guardando en volatilidad/log...");
    await db.ref("volatilidad/log").push({
      ts: ahora,
      subidas,
      bajadas,
      negocios: negociosActivos,
      detalle: detalle
    });
    console.log("✅ Registrado en volatilidad/log");
    
    // 🔔 ENVIAR A DISCORD
    await enviarADiscord(detalle, subidas, bajadas, ahora);
    console.log(`✅ Volatilidad aplicada y enviada a Discord`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}
aplicarVolatilidad();
