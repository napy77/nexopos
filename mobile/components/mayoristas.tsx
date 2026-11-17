import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Aviso, Boton, Chip } from "@/components/ui";
import { api, mensaje } from "@/lib/api";
import type { B2BMayorista } from "@/lib/b2b";
import { color, s } from "@/lib/tema";

/*
 * «Descubrí mayoristas», igual que en la web y en el portal de NexoB2B: los
 * mismos mayoristas, en el mismo orden. Las equivalencias de rubros y el
 * resguardo sin rubros los hace el backend.
 */

const ESTADO: Record<string, { label: string; color: string }> = {
  aceptado: { label: "Habilitado", color: color.ok },
  pendiente: { label: "Solicitud pendiente", color: color.aviso },
  rechazado: { label: "Rechazado", color: color.error },
};

const RADIOS = [
  { value: 25, label: "25 km" },
  { value: 50, label: "50 km" },
  { value: 100, label: "100 km" },
  { value: 200, label: "200 km" },
  { value: 9999, label: "Todo el país" },
];

type Meta = {
  tieneUbicacion: boolean;
  radioKm: number;
  rubros: string[];
  rubrosSugeridos: string[];
  sinDeSusRubros: boolean;
  rubrosDisponibles: string[];
  perfilUrl: string;
};

const distancia = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`);

export function Mayoristas({ onVerCatalogo }: { onVerCatalogo: (m: B2BMayorista) => void }) {
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [radioKm, setRadioKm] = useState(50);
  // null = todavía no eligió: el backend aplica los de su tipo de comercio
  const [rubros, setRubros] = useState<string[] | null>(null);
  const [mayoristas, setMayoristas] = useState<B2BMayorista[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [solicitando, setSolicitando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const pedido = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 400);
    return () => clearTimeout(t);
  }, [texto]);

  const cargar = useCallback(async () => {
    const nro = ++pedido.current;
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams({ radio_km: String(radioKm) });
      if (rubros !== null) params.set("rubros", rubros.join(","));
      if (busqueda) params.set("busqueda", busqueda);
      const d = await api<{ mayoristas: B2BMayorista[]; meta: Meta }>(`/api/mayoristas/descubrir?${params}`);
      if (nro !== pedido.current) return;
      setMayoristas(d.mayoristas);
      setMeta(d.meta);
    } catch (e) {
      if (nro === pedido.current) setError(mensaje(e, "No se pudieron traer los mayoristas"));
    } finally {
      if (nro === pedido.current) setCargando(false);
    }
  }, [radioKm, rubros, busqueda]);

  useEffect(() => { cargar(); }, [cargar]);

  const activos = rubros ?? meta?.rubros ?? [];

  function toggleRubro(r: string) {
    setRubros(activos.includes(r) ? activos.filter((x) => x !== r) : [...activos, r]);
  }

  async function pedirAlta(m: B2BMayorista) {
    setError("");
    setSolicitando(m.id);
    try {
      await api("/api/mayoristas/solicitudes", { body: { mayoristaId: m.id, mensaje: "" } });
      setOk(`Le pediste el alta a ${m.nombre}. Te avisan cuando la acepte.`);
      setTimeout(() => setOk(""), 5000);
      cargar();
    } catch (e) {
      setError(mensaje(e, "No se pudo pedir el alta"));
    } finally {
      setSolicitando(null);
    }
  }

  const zona = radioKm === 9999 ? "todo el país" : `${radioKm} km`;

  return (
    <FlatList
      data={mayoristas}
      keyExtractor={(m) => m.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, gap: 8, maxWidth: 900, width: "100%", alignSelf: "center" }}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <TextInput style={s.input} placeholder="Buscar por nombre, rubro o ciudad…" value={texto} onChangeText={setTexto}
            autoCorrect={false} autoCapitalize="none" returnKeyType="search"
            onSubmitEditing={(e) => setBusqueda(e.nativeEvent.text.trim())} />
          {meta && (
            <>
              {meta.tieneUbicacion ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
                  {RADIOS.map((r) => (
                    <Chip key={r.value} activo={radioKm === r.value} onPress={() => setRadioKm(r.value)}>{r.label}</Chip>
                  ))}
                </ScrollView>
              ) : (
                <Aviso tipo="aviso">
                  Para ver los mayoristas cerca tuyo cargá tu ubicación en tu perfil de NexoB2B, sección «Ubicación en el mapa».
                </Aviso>
              )}
              {meta.rubrosDisponibles.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
                  {activos.length > 0 && <Chip onPress={() => setRubros([])}>Todos los rubros</Chip>}
                  {meta.rubrosDisponibles.map((r) => (
                    <Chip key={r} activo={activos.includes(r)} onPress={() => toggleRubro(r)}>{r}</Chip>
                  ))}
                </ScrollView>
              )}
              {meta.sinDeSusRubros && !cargando && (
                <Aviso tipo="aviso">No encontramos mayoristas de tus rubros en {zona}. Te mostramos todos los de la zona.</Aviso>
              )}
            </>
          )}
          {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          {!cargando && <Text style={s.apagado}>{mayoristas.length} encontrados</Text>}
          {cargando && mayoristas.length === 0 && <ActivityIndicator style={{ marginTop: 12 }} />}
        </View>
      }
      ListEmptyComponent={!cargando && !error ? (
        <View style={{ alignItems: "center", gap: 10, marginTop: 24 }}>
          <Text style={s.apagado}>Ningún mayorista en {zona}{activos.length ? " con los rubros elegidos" : ""}.</Text>
          {meta?.tieneUbicacion && radioKm < 9999 && (
            <Boton variante="secundario" onPress={() => setRadioKm(RADIOS.find((r) => r.value > radioKm)?.value ?? 9999)}>
              Ampliar la zona
            </Boton>
          )}
        </View>
      ) : null}
      renderItem={({ item: m }) => {
        const estado = m.solicitud ? ESTADO[m.solicitud.estado] : null;
        const lugar = [m.ciudad, m.provincia].filter(Boolean).join(", ");
        const puedePedir = !m.solicitud || m.solicitud.estado === "rechazado";
        return (
          <View style={[s.tarjeta, { gap: 6, padding: 14 }]}>
            <View style={s.entre}>
              <Text style={[s.subtitulo, { flex: 1 }]} numberOfLines={2}>{m.nombre}</Text>
              {estado && <Text style={{ color: estado.color, fontWeight: "700", fontSize: 13 }}>{estado.label}</Text>}
            </View>
            <Text style={s.apagado}>
              {[m.rubros[0], lugar, m.distancia_km != null ? `a ${distancia(m.distancia_km)}` : null].filter(Boolean).join(" · ")}
            </Text>
            {(m.productos_count ?? 0) > 0 && <Text style={s.apagado}>{m.productos_count} productos publicados</Text>}
            {m.descripcion ? <Text style={s.apagado} numberOfLines={2}>{m.descripcion}</Text> : null}
            {/* A quién llamar para un pedido, una vez que ya se le puede comprar */}
            {m.solicitud?.estado === "aceptado" && m.contacto && (
              <Text style={s.texto}>
                {m.contacto.es_vendedor ? "Vendedor: " : "Contacto: "}
                <Text style={{ fontWeight: "700" }}>{m.contacto.nombre}</Text>
                {m.contacto.celular ? (
                  <Text style={{ color: color.primario }}
                    onPress={() => Linking.openURL(`https://wa.me/${m.contacto!.celular!.replace(/\D/g, "")}`)}>
                    {`  ·  WhatsApp ${m.contacto.celular}`}
                  </Text>
                ) : null}
              </Text>
            )}
            <View style={[s.fila, { marginTop: 4 }]}>
              <Boton variante="secundario" style={{ flex: 1 }} onPress={() => onVerCatalogo(m)}>Ver catálogo</Boton>
              {puedePedir && (
                <Boton style={{ flex: 1 }} cargando={solicitando === m.id} onPress={() => pedirAlta(m)}>Pedir alta</Boton>
              )}
            </View>
          </View>
        );
      }}
    />
  );
}
