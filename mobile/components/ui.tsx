import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, s } from "@/lib/tema";

type Variante = "primario" | "secundario" | "peligro" | "ok";

const FONDO: Record<Variante, string> = {
  primario: color.primario, secundario: "#fff", peligro: color.error, ok: color.ok,
};

export function Boton({ children, onPress, variante = "primario", cargando, desactivado, style, grande }: {
  children: ReactNode; onPress: () => void; variante?: Variante; cargando?: boolean;
  desactivado?: boolean; style?: ViewStyle; grande?: boolean;
}) {
  const apagado = desactivado || cargando;
  const textoColor = variante === "secundario" ? color.texto : "#fff";
  return (
    <Pressable
      onPress={onPress}
      disabled={apagado}
      style={({ pressed }) => [{
        backgroundColor: FONDO[variante], borderRadius: 10, alignItems: "center", justifyContent: "center",
        paddingVertical: grande ? 16 : 12, paddingHorizontal: 16, opacity: apagado ? 0.5 : pressed ? 0.8 : 1,
        borderWidth: variante === "secundario" ? 1 : 0, borderColor: color.borde,
      }, style]}
    >
      {cargando
        ? <ActivityIndicator color={textoColor} />
        : <Text style={{ color: textoColor, fontSize: grande ? 18 : 15, fontWeight: "600" }}>{children}</Text>}
    </Pressable>
  );
}

export function Aviso({ tipo, children }: { tipo: "error" | "ok" | "aviso"; children: ReactNode }) {
  const c = { error: [color.errorFondo, color.error], ok: [color.okFondo, color.ok], aviso: [color.avisoFondo, color.aviso] }[tipo];
  return (
    <View style={{ backgroundColor: c[0], borderRadius: 10, padding: 12, borderLeftWidth: 4, borderLeftColor: c[1] }}>
      <Text style={{ color: color.texto, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

/** Chip seleccionable: medios de pago, pasillos, modos */
export function Chip({ children, activo, onPress }: { children: ReactNode; activo?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1,
        borderColor: activo ? color.primario : color.borde, backgroundColor: activo ? color.primario : "#fff",
      }}
    >
      <Text style={{ color: activo ? "#fff" : color.texto, fontWeight: "500" }}>{children}</Text>
    </Pressable>
  );
}

/** Hoja a pantalla completa en celular, centrada en tablet */
export function Hoja({ visible, titulo, onCerrar, children }: {
  visible: boolean; titulo: string; onCerrar: () => void; children: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <SafeAreaView style={s.pantalla} edges={["top", "bottom"]}>
        <View style={[s.entre, { padding: 16, borderBottomWidth: 1, borderColor: color.borde, backgroundColor: "#fff" }]}>
          <Text style={s.subtitulo}>{titulo}</Text>
          <Pressable onPress={onCerrar} hitSlop={12}><Text style={{ color: color.primario, fontSize: 16 }}>Cerrar</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function Fila({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <View style={s.entre}>
      <Text style={[s.texto, fuerte && { fontWeight: "700" }]}>{etiqueta}</Text>
      <Text style={[s.texto, fuerte && { fontWeight: "700" }]}>{valor}</Text>
    </View>
  );
}
