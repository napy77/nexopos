// Google Play avisó que la app «requiere» android.hardware.screen.portrait y
// la ocultaba en tablets horizontales, Chromebooks y Android XR. Nadie lo pide
// a propósito: el escáner de ML Kit (lo trae expo-camera) declara una actividad
// invisible con screenOrientation="portrait", y Play deduce de ahí que la app
// necesita pantalla vertical. La app gira libre (orientation "default" en
// app.json), así que se declara la función como opcional.
const { withAndroidManifest } = require("expo/config-plugins");

const FUNCIONES = ["android.hardware.screen.portrait", "android.hardware.screen.landscape"];

module.exports = function withPantallaLibre(config) {
  return withAndroidManifest(config, (cfg) => {
    const m = cfg.modResults.manifest;
    const otras = (m["uses-feature"] ?? []).filter((f) => !FUNCIONES.includes(f.$?.["android:name"]));
    m["uses-feature"] = [
      ...otras,
      ...FUNCIONES.map((nombre) => ({ $: { "android:name": nombre, "android:required": "false" } })),
    ];
    return cfg;
  });
};
