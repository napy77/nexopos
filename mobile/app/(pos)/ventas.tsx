import { useCallback, useState } from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, mensaje, money } from "@/lib/api";
import { imprimirTicket, useImpresora } from "@/lib/impresora";
import { Aviso, Boton } from "@/components/ui";
import { CompartirTicket } from "@/components/compartir-ticket";
import { fechaHora, MEDIO_LABEL, type Sale } from "@/lib/tipos";
import { color, s } from "@/lib/tema";

/** Historial del comercio: reimprimir un ticket o reembolsarlo. */
export default function Ventas() {
  const [ventas, setVentas] = useState<Sale[]>([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [refrescando, setRefrescando] = useState(false);
  const hayTicketera = useImpresora((e) => e.config.tipo !== "ninguna");
  const [compartir, setCompartir] = useState<{ id: number; ticketNumber: number } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setVentas(await api<Sale[]>("/api/sales"));
    } catch (err) {
      setError(mensaje(err));
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  async function imprimir(id: number) {
    try {
      await imprimirTicket(id);
    } catch (err) {
      setError(mensaje(err, "No se pudo imprimir el ticket"));
    }
  }

  function reembolsar(v: Sale) {
    // Saca plata del cajón y devuelve la mercadería al stock: se confirma
    Alert.alert(
      `Reembolsar el ticket #${v.ticket_number}`,
      `Se devuelven ${money(v.total)} y la mercadería vuelve al stock.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Reembolsar", style: "destructive",
          onPress: async () => {
            setError("");
            try {
              const r = await api<{ id: number; ticketNumber: number }>(`/api/sales/${v.id}/refund`, { method: "POST" });
              setAviso(`Reembolso del ticket #${v.ticket_number} emitido (ticket #${r.ticketNumber}).`);
              setTimeout(() => setAviso(""), 6000);
              cargar();
              if (hayTicketera) imprimir(r.id);
            } catch (err) {
              setError(mensaje(err, "Error al reembolsar"));
            }
          },
        },
      ]
    );
  }

  return (
    <View style={s.pantalla}>
      {(error || aviso) && (
        <View style={{ padding: 12, gap: 6 }}>
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
        </View>
      )}
      <FlatList
        data={ventas}
        keyExtractor={(v) => String(v.id)}
        contentContainerStyle={{ padding: 12, gap: 8, maxWidth: 900, width: "100%", alignSelf: "center" }}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
        ListEmptyComponent={<Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>Todavía no hay ventas.</Text>}
        renderItem={({ item: v }) => {
          const reembolsable = !v.refund_of && !v.refunded_by && Number(v.total) > 0;
          return (
            <View style={[s.tarjeta, { padding: 12, gap: 6 }]}>
              <View style={s.entre}>
                <Text style={s.subtitulo}>
                  #{v.ticket_number}{v.refund_of ? " · reembolso" : ""}{v.refunded_by ? " · reembolsado" : ""}
                </Text>
                <Text style={[s.subtitulo, Number(v.total) < 0 && { color: color.error }]}>{money(v.total)}</Text>
              </View>
              <Text style={s.apagado}>
                {fechaHora(v.created_at)} · {MEDIO_LABEL[v.payment_method] ?? v.payment_method}
                {v.customer_name ? ` · ${v.customer_name}` : ""}
                {v.operado_por ? ` · soporte ${v.operado_por}` : ""}
              </Text>
              <View style={s.fila}>
                {hayTicketera && <Boton variante="secundario" onPress={() => imprimir(v.id)}>Reimprimir</Boton>}
                <Boton variante="secundario" onPress={() => setCompartir({ id: v.id, ticketNumber: v.ticket_number })}>Enviar</Boton>
                {reembolsable && <Boton variante="secundario" onPress={() => reembolsar(v)}>↩️ Reembolsar</Boton>}
              </View>
            </View>
          );
        }}
      />
      <CompartirTicket saleId={compartir?.id ?? null} ticketNumber={compartir?.ticketNumber} onCerrar={() => setCompartir(null)} />
    </View>
  );
}
