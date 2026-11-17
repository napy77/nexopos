import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Aviso, Boton, Chip } from "@/components/ui";
import { api, mensaje, money } from "@/lib/api";
import { ABIERTOS, usePedidos, type Pedido } from "@/lib/pedidos";
import { color, s } from "@/lib/tema";

/**
 * Los pedidos que entran por NexoTienda. Lo que esta pantalla tiene que evitar
 * no es que el comerciante no se entere: es que se entere, no haga nada en
 * cuarenta minutos, y el que pidió no sepa si va o no va. Por eso los
 * pendientes van arriba con el reloj a la vista, y aceptar pide decir para
 * cuándo, con el tiempo ya sugerido. Mismo criterio que la web.
 */

const REVISION: Record<string, string> = {
  cuenta_nueva_monto_alto: "Es el primer pedido de esta persona y es grande. Llamala antes de armarlo.",
  identidad_no_disponible: "No pudimos comprobar su cuenta de ClubPay al recibirlo. Confirmá con la persona antes de armarlo.",
};

const ESTADO: Record<string, { texto: string; color: string }> = {
  recibido: { texto: "Sin aceptar", color: color.aviso },
  aceptado: { texto: "Preparando", color: color.primario },
  listo: { texto: "Listo", color: color.ok },
  en_camino: { texto: "En camino", color: color.ok },
  entregado: { texto: "Entregado", color: color.ok },
  cancelado: { texto: "Cancelado", color: color.apagado },
};

const PAGO: Record<string, string> = {
  efectivo_entrega: "Efectivo al recibir",
  online: "Pagado online",
  cuenta_corriente: "A la libreta",
};

const TIEMPOS = ["15 minutos", "30 minutos", "1 hora", "Hoy a la tarde", "Mañana"];
const MOTIVOS = ["No me queda stock", "No llego con el horario", "Cerramos por hoy"];

function hace(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

export default function Pedidos() {
  const { pedidos, cargado, error: errorCarga, cargar } = usePedidos();
  const [refrescando, setRefrescando] = useState(false);
  const [trabajando, setTrabajando] = useState<number | null>(null);
  const [error, setError] = useState("");

  // El layout ya consulta cada 20 s; al entrar se trae al instante
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  async function accion(id: number, ruta: string, body?: unknown) {
    setError("");
    setTrabajando(id);
    try {
      await api(`/api/pedidos/${id}/${ruta}`, { method: "POST", body: body ?? {} });
      await cargar();
    } catch (e) {
      setError(mensaje(e, "No se pudo"));
    } finally {
      setTrabajando(null);
    }
  }

  const abiertos = pedidos.filter((p) => ABIERTOS.includes(p.status));
  const cerrados = pedidos.filter((p) => !ABIERTOS.includes(p.status));

  return (
    <ScrollView style={s.pantalla} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, gap: 10, maxWidth: 900, width: "100%", alignSelf: "center" }}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {errorCarga && !cargado ? <Aviso tipo="error">{errorCarga}</Aviso> : null}

      {cargado && abiertos.length === 0 && (
        <View style={s.tarjeta}>
          <Text style={s.apagado}>No hay pedidos esperando. Los que entren por tu tienda aparecen acá.</Text>
        </View>
      )}
      {!cargado && !errorCarga && <Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>Cargando…</Text>}

      {abiertos.map((p) => (
        <Tarjeta key={p.id} p={p} trabajando={trabajando === p.id} onAccion={accion} />
      ))}

      {cerrados.length > 0 && (
        <View style={[s.tarjeta, { gap: 8 }]}>
          <Text style={s.subtitulo}>Cerrados</Text>
          {cerrados.map((p) => (
            <View key={p.id} style={[s.entre, { paddingVertical: 4, borderTopWidth: 1, borderTopColor: color.borde }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.texto} numberOfLines={1}>{p.contact_name ?? p.customer_name ?? "Sin nombre"}</Text>
                <Text style={s.apagado} numberOfLines={2}>
                  {[p.code, ESTADO[p.status]?.texto ?? p.status, p.cancel_reason, hace(p.created_at)].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Text style={s.texto}>{money(p.total)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Tarjeta({ p, trabajando, onAccion }: {
  p: Pedido; trabajando: boolean;
  onAccion: (id: number, ruta: string, body?: unknown) => void;
}) {
  const [tiempo, setTiempo] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const urgente = p.status === "recibido";
  const estado = ESTADO[p.status];

  function aceptar() {
    const hacer = () => onAccion(p.id, "aceptar", { readyEstimate: tiempo.trim() });
    // Un toque más, sólo para los marcados: el que acepta sin leer es justo
    // el caso del pedido falso de cincuenta productos
    if (p.review_reason) {
      Alert.alert("Mirá antes de aceptar", REVISION[p.review_reason], [
        { text: "Volver", style: "cancel" },
        { text: "Aceptarlo igual", onPress: hacer },
      ]);
    } else hacer();
  }

  return (
    <View style={[s.tarjeta, { gap: 8, padding: 14 }, urgente && { borderLeftWidth: 4, borderLeftColor: color.aviso }]}>
      <View style={s.entre}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.subtitulo} numberOfLines={1}>{p.contact_name ?? p.customer_name ?? "Sin nombre"}</Text>
          <Text style={s.apagado}>
            <Text style={{ color: estado?.color, fontWeight: "700" }}>{estado?.texto ?? p.status}</Text>
            {`  ·  ${p.code}  ·  ${hace(p.created_at)}`}
          </Text>
        </View>
        <Text style={[s.subtitulo, { fontSize: 18 }]}>{money(p.total)}</Text>
      </View>

      <Text style={s.apagado}>
        {[p.slot_label, p.address, PAGO[p.payment_method] ?? p.payment_method].filter(Boolean).join(" · ")}
      </Text>
      {p.contact_phone ? (
        <Text style={{ color: color.primario }} onPress={() => Linking.openURL(`tel:${p.contact_phone!.replace(/[^\d+]/g, "")}`)}>
          📞 {p.contact_phone}
        </Text>
      ) : null}
      {p.customer_origen === "tienda" && <Text style={s.apagado}>Se identificó con ClubPay</Text>}
      {p.review_reason && urgente && <Aviso tipo="aviso">{`Mirá antes de aceptar: ${REVISION[p.review_reason]}`}</Aviso>}
      {p.notes ? <Text style={s.texto}>📝 {p.notes}</Text> : null}

      <View style={{ gap: 4, paddingVertical: 4 }}>
        {(p.lines ?? []).map((l, i) => (
          <View key={i} style={s.entre}>
            <Text style={[s.texto, { flex: 1 }]}>
              <Text style={{ fontWeight: "700" }}>{Number(l.quantity).toLocaleString("es-AR")}×</Text> {l.name}
            </Text>
            <Text style={s.texto}>{money(Number(l.quantity) * Number(l.unitPrice))}</Text>
          </View>
        ))}
      </View>

      {p.ready_estimate ? <Text style={s.apagado}>Le dijiste: <Text style={{ fontWeight: "700" }}>{p.ready_estimate}</Text></Text> : null}

      {cancelando ? (
        <View style={{ gap: 8, backgroundColor: color.avisoFondo, padding: 10, borderRadius: 10 }}>
          <Text style={s.apagado}>Lo que escribas lo lee el cliente. Decile cómo seguir, no solo que no va:</Text>
          <View style={[s.fila, { flexWrap: "wrap" }]}>
            {MOTIVOS.map((m) => <Chip key={m} activo={motivo === m} onPress={() => setMotivo(m)}>{m}</Chip>)}
          </View>
          <TextInput style={s.input} value={motivo} onChangeText={setMotivo}
            placeholder="No me quedan de ananá, tengo de muzzarella. Pasá igual y te las hago." multiline />
          <View style={s.fila}>
            <Boton variante="secundario" style={{ flex: 1 }} onPress={() => setCancelando(false)}>Volver</Boton>
            <Boton variante="peligro" style={{ flex: 1 }} cargando={trabajando} desactivado={!motivo.trim()}
              onPress={() => onAccion(p.id, "cancelar", { motivo: motivo.trim() })}>Cancelar el pedido</Boton>
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {urgente && (
            <>
              <Text style={s.texto}>¿Para cuándo lo tenés?</Text>
              <View style={[s.fila, { flexWrap: "wrap" }]}>
                {TIEMPOS.map((t) => <Chip key={t} activo={tiempo === t} onPress={() => setTiempo(t)}>{t}</Chip>)}
              </View>
              <TextInput style={s.input} value={tiempo} onChangeText={setTiempo} placeholder="o escribilo" />
              <Boton cargando={trabajando} desactivado={!tiempo.trim()} onPress={aceptar}>Aceptar</Boton>
            </>
          )}
          {p.status === "aceptado" && (
            <Boton cargando={trabajando} onPress={() => onAccion(p.id, "listo")}>Está listo</Boton>
          )}
          {p.status === "listo" && p.slot_kind === "reparto" && (
            <Boton cargando={trabajando} onPress={() => onAccion(p.id, "en-camino")}>Salió para allá</Boton>
          )}
          {(p.status === "listo" || p.status === "en_camino") && (
            <Boton variante={p.status === "listo" && p.slot_kind === "reparto" ? "secundario" : "primario"} cargando={trabajando}
              onPress={() => onAccion(p.id, "entregado")}>
              {p.payment_method === "efectivo_entrega" ? "Entregado y cobrado" : "Entregado"}
            </Boton>
          )}
          <Boton variante="secundario" onPress={() => setCancelando(true)}>Cancelar</Boton>
        </View>
      )}
    </View>
  );
}
