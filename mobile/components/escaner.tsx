import { forwardRef, useRef, useState } from "react";
import { Linking, Modal, Pressable, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeType } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Boton } from "@/components/ui";
import { color, s } from "@/lib/tema";

/** Los de los productos del súper y los internos; el QR sólo donde se pide. */
const CODIGOS: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "itf14"];

/**
 * Cámara a pantalla completa que devuelve el primer código que lee. Es la
 * alternativa al lector Bluetooth: el lector tipea en el buscador y no pasa
 * por acá.
 */
export function EscanerCamara({ visible, onLeido, onCerrar, qr }: {
  visible: boolean; onLeido: (codigo: string) => void; onCerrar: () => void; qr?: boolean;
}) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  // La cámara avisa el mismo código varias veces por segundo mientras lo ve:
  // sin esto, un solo escaneo agregaba el producto tres o cuatro veces.
  const leido = useRef(false);
  // Los márgenes se leen acá, afuera del Modal: adentro de un Modal a pantalla
  // completa SafeAreaView no los recibe y el encabezado quedaba bajo la hora.
  const margen = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar} onShow={() => { leido.current = false; }}>
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: margen.top, paddingBottom: margen.bottom }}>
        {/* La hora y la batería en blanco sobre el fondo negro de la cámara */}
        <StatusBar style="light" />
        <View style={[s.entre, { padding: 16 }]}>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
            {qr ? "Apuntá al QR" : "Apuntá al código de barras"}
          </Text>
          <Pressable onPress={onCerrar} hitSlop={12}><Text style={{ color: "#fff", fontSize: 16 }}>Cerrar</Text></Pressable>
        </View>
        {!permiso ? null : permiso.granted ? (
          <View style={{ flex: 1 }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: qr ? ["qr"] : CODIGOS }}
              onBarcodeScanned={({ data }) => {
                if (leido.current || !data) return;
                leido.current = true;
                onLeido(data.trim());
              }}
            />
            {/* La guía: el código entra mejor cuando se ve dónde ponerlo */}
            <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
              <View style={{
                width: qr ? 240 : "80%", height: qr ? 240 : 140, borderWidth: 3, borderColor: "#fff",
                borderRadius: 12, opacity: 0.8,
              }} />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontSize: 16, textAlign: "center" }}>
              Para escanear con el celular, NexoPOS necesita usar la cámara.
            </Text>
            {permiso.canAskAgain
              ? <Boton onPress={pedirPermiso}>Permitir la cámara</Boton>
              : <Boton onPress={() => Linking.openSettings()}>Abrir los ajustes del teléfono</Boton>}
          </View>
        )}
      </View>
    </Modal>
  );
}

/**
 * Buscador de productos con el ícono de código de barras a la derecha, que
 * abre la cámara. Lo leído entra por `onEscaneo`, igual que si lo hubiera
 * tipeado el lector y mandado Enter.
 */
export const CampoBusqueda = forwardRef<TextInput, TextInputProps & {
  onEscaneo: (codigo: string) => void; qr?: boolean;
  /** Para el lugar que ocupa en una fila (`flex: 1`); `style` va al campo. */
  estiloCaja?: ViewStyle;
}>(function CampoBusqueda({ onEscaneo, qr, style, estiloCaja, ...props }, ref) {
  const [abierta, setAbierta] = useState(false);
  return (
    <View style={[{ justifyContent: "center" }, estiloCaja]}>
      <TextInput ref={ref} {...props} style={[s.input, style, { paddingRight: 48 }]} />
      <Pressable
        onPress={() => setAbierta(true)}
        hitSlop={8}
        accessibilityLabel="Escanear con la cámara"
        style={{ position: "absolute", right: 4, top: 0, bottom: 0, width: 44, alignItems: "center", justifyContent: "center" }}
      >
        <MaterialCommunityIcons name={qr ? "qrcode-scan" : "barcode-scan"} size={24} color={color.apagado} />
      </Pressable>
      <EscanerCamara
        visible={abierta}
        qr={qr}
        onCerrar={() => setAbierta(false)}
        onLeido={(codigo) => { setAbierta(false); onEscaneo(codigo); }}
      />
    </View>
  );
});
