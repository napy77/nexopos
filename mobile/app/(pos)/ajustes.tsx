import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { API_URL, mensaje } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { imprimirPrueba, useImpresora } from "@/lib/impresora";
import { buscarBle, vinculadasClasico } from "@/lib/impresora/transporte";
import type { ConfigImpresora, TipoImpresora } from "@/lib/impresora/config";
import { Aviso, Boton, Chip } from "@/components/ui";
import { color, s } from "@/lib/tema";

const TIPOS: { id: TipoImpresora; label: string; soloAndroid?: boolean }[] = [
  { id: "red", label: "Red (Wi-Fi / cable)" },
  { id: "ble", label: "Bluetooth BLE" },
  { id: "clasico", label: "Bluetooth clásico", soloAndroid: true },
];

export default function Ajustes() {
  const { comercio, salir } = useSesion();
  const { config, guardar } = useImpresora();
  const [borrador, setBorrador] = useState<ConfigImpresora>(config);
  const [encontrados, setEncontrados] = useState<{ id: string; nombre: string }[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => setBorrador(config), [config]);

  const cambiar = (c: Partial<ConfigImpresora>) => setBorrador((b) => ({ ...b, ...c }));

  async function buscar() {
    setError("");
    setEncontrados([]);
    setBuscando(true);
    try {
      if (borrador.tipo === "ble") {
        await buscarBle((d) => setEncontrados((prev) => [...prev, d]));
      } else {
        const lista = await vinculadasClasico();
        setEncontrados(lista);
        if (!lista.length) setError("No hay nada vinculado. Vinculá la ticketera desde los ajustes de Bluetooth de Android y volvé.");
      }
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setBuscando(false);
    }
  }

  async function guardarYProbar() {
    setError("");
    setAviso("");
    await guardar(borrador);
    try {
      await imprimirPrueba();
      setAviso("Listo. Si salió la hoja de prueba con los acentos bien, la ticketera quedó configurada.");
    } catch (err) {
      setError(mensaje(err));
    }
  }

  const tipos = TIPOS.filter((t) => !t.soloAndroid || Platform.OS === "android");

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}
      keyboardShouldPersistTaps="handled">
      <View style={[s.tarjeta, { gap: 12 }]}>
        <Text style={s.subtitulo}>Ticketera de este dispositivo</Text>
        <View style={[s.fila, { flexWrap: "wrap" }]}>
          <Chip activo={borrador.tipo === "ninguna"} onPress={() => cambiar({ tipo: "ninguna" })}>Sin ticketera</Chip>
          {tipos.map((t) => (
            <Chip key={t.id} activo={borrador.tipo === t.id}
              onPress={() => { cambiar({ tipo: t.id, dispositivo: "", nombre: "" }); setEncontrados([]); }}>{t.label}</Chip>
          ))}
        </View>
        {Platform.OS === "ios" && (
          <Text style={s.apagado}>
            En iPhone y iPad sólo se ven las ticketeras BLE o de red. Las Bluetooth clásicas no aparecen: es una limitación de Apple.
          </Text>
        )}

        {borrador.tipo === "red" && (
          <View style={s.fila}>
            <TextInput style={[s.input, { flex: 3 }]} placeholder="IP de la ticketera (ej. 192.168.0.50)" value={borrador.host}
              onChangeText={(host) => cambiar({ host: host.trim() })} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
            <TextInput style={[s.input, { flex: 1 }]} placeholder="Puerto" value={String(borrador.puerto)}
              onChangeText={(p) => cambiar({ puerto: Number(p.replace(/\D/g, "")) || 9100 })} keyboardType="number-pad" />
          </View>
        )}

        {(borrador.tipo === "ble" || borrador.tipo === "clasico") && (
          <View style={{ gap: 8 }}>
            {borrador.nombre ? <Text style={s.texto}>Elegida: <Text style={{ fontWeight: "700" }}>{borrador.nombre}</Text></Text> : null}
            <Boton variante="secundario" onPress={buscar} cargando={buscando}>
              {borrador.tipo === "ble" ? "Buscar ticketeras cerca" : "Ver las vinculadas"}
            </Boton>
            {encontrados.map((d) => (
              <Pressable key={d.id} onPress={() => cambiar({ dispositivo: d.id, nombre: d.nombre })}
                style={[s.tarjeta, { padding: 12, borderColor: borrador.dispositivo === d.id ? color.primario : color.borde }]}>
                <Text style={s.texto}>{d.nombre}</Text>
                <Text style={s.apagado}>{d.id}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {borrador.tipo !== "ninguna" && (
          <>
            <Text style={s.subtitulo}>Papel</Text>
            <View style={s.fila}>
              <Chip activo={borrador.ancho === "80mm"} onPress={() => cambiar({ ancho: "80mm" })}>80 mm</Chip>
              <Chip activo={borrador.ancho === "58mm"} onPress={() => cambiar({ ancho: "58mm" })}>58 mm</Chip>
            </View>
            <View style={s.entre}>
              <Text style={s.texto}>Imprimir el ticket al cobrar</Text>
              <Switch value={borrador.autoPrint} onValueChange={(autoPrint) => cambiar({ autoPrint })} />
            </View>
          </>
        )}

        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
        <View style={s.fila}>
          <Boton variante="secundario" style={{ flex: 1 }} onPress={async () => { await guardar(borrador); setAviso("Guardado."); }}>Guardar</Boton>
          {borrador.tipo !== "ninguna" && (
            <Boton style={{ flex: 1 }} onPress={guardarYProbar}
              desactivado={borrador.tipo === "red" ? !borrador.host : !borrador.dispositivo}>Guardar e imprimir prueba</Boton>
          )}
        </View>
      </View>

      <View style={[s.tarjeta, { gap: 10 }]}>
        <Text style={s.subtitulo}>{comercio?.name}</Text>
        <Text style={s.apagado}>{comercio?.email}</Text>
        <Text style={s.apagado}>
          Márgenes, campañas, fotos de productos y configuración siguen en la web por ahora.
        </Text>
        <Boton variante="secundario" onPress={() => WebBrowser.openBrowserAsync("https://nexopos.app/login")}>Abrir nexopos.app</Boton>
        <Boton variante="peligro" onPress={salir}>Cerrar sesión</Boton>
        {API_URL !== "https://nexopos.app" && <Text style={s.apagado}>Servidor: {API_URL}</Text>}
      </View>
    </ScrollView>
  );
}
