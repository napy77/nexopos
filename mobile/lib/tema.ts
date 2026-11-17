import { StyleSheet } from "react-native";

/** Los mismos colores que `frontend/app/globals.css`, para que la app y la web se sientan la misma caja. */
export const color = {
  fondo: "#f6f7f9",
  tarjeta: "#ffffff",
  borde: "#e2e5ea",
  texto: "#1c2230",
  apagado: "#6b7280",
  primario: "#1d4ed8",
  primarioTexto: "#ffffff",
  ok: "#16a34a",
  okFondo: "#e8f6ee",
  error: "#dc2626",
  errorFondo: "#fdecec",
  aviso: "#d97706",
  avisoFondo: "#fef6e7",
};

export const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: color.fondo },
  tarjeta: {
    backgroundColor: color.tarjeta, borderRadius: 12, borderWidth: 1, borderColor: color.borde, padding: 16,
  },
  titulo: { fontSize: 22, fontWeight: "700", color: color.texto },
  subtitulo: { fontSize: 16, fontWeight: "600", color: color.texto },
  texto: { fontSize: 15, color: color.texto },
  apagado: { fontSize: 13, color: color.apagado },
  input: {
    borderWidth: 1, borderColor: color.borde, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, backgroundColor: "#fff", color: color.texto,
  },
  fila: { flexDirection: "row", alignItems: "center", gap: 8 },
  entre: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
