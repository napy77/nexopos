// Google Play rechazó el AAB por declarar ACCESS_FINE_LOCATION dos veces con
// distinto maxSdkVersion: el plugin de react-native-ble-plx la agrega como
// <uses-permission-sdk-23 maxSdkVersion="30"> y los manifiestos de ble-plx y
// de react-native-bluetooth-classic la traen como <uses-permission> sin tope
// (y RxAndroidBle, otra vez como -sdk-23 sin tope).
// El fusionador de Gradle no las considera el mismo elemento y deja las dos.
//
// Se deja una sola declaración de cada una, con tope en 30 y tools:node
// "replace" para que pise a las de las librerías. La ubicación sólo hace falta
// para buscar Bluetooth hasta Android 11; desde el 12 alcanzan BLUETOOTH_SCAN
// y BLUETOOTH_CONNECT (es lo que pide lib/impresora/transporte.ts).
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const UBICACION = ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"];

module.exports = function withPermisoUbicacion(config) {
  return withAndroidManifest(config, (cfg) => {
    const m = cfg.modResults.manifest;
    AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
    const esUbicacion = (p) => UBICACION.includes(p.$?.["android:name"]);
    m["uses-permission-sdk-23"] = (m["uses-permission-sdk-23"] ?? []).filter((p) => !esUbicacion(p));
    m["uses-permission"] = (m["uses-permission"] ?? []).filter((p) => !esUbicacion(p));
    for (const nombre of UBICACION) {
      m["uses-permission"].push({
        $: { "android:name": nombre, "android:maxSdkVersion": "30", "tools:node": "replace" },
      });
      // RxAndroidBle (lo trae ble-plx) las declara además como -sdk-23 sin tope.
      m["uses-permission-sdk-23"].push({ $: { "android:name": nombre, "tools:node": "remove" } });
    }
    return cfg;
  });
};
