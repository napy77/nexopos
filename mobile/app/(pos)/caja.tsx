import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, leerNumero, mensaje, money } from "@/lib/api";
import { imprimirCierre } from "@/lib/impresora";
import { Aviso, Boton, Chip, Fila } from "@/components/ui";
import { fechaHora, MEDIO_LABEL, type Cierre, type EstadoCaja, type SesionCerrada } from "@/lib/tipos";
import { color, s } from "@/lib/tema";

/** Los medios que van al cajón: sólo el efectivo se cuenta a mano. Igual que la web. */
const MEDIOS = ["cash", "wallet", "card", "transfer", "account", "mercadopago"];

export default function Caja() {
  const [estado, setEstado] = useState<EstadoCaja | null>(null);
  const [historial, setHistorial] = useState<SesionCerrada[]>([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [busy, setBusy] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  // Abrir
  const [fondo, setFondo] = useState("");
  const [notaApertura, setNotaApertura] = useState("");
  // Movimiento
  const [tipoMov, setTipoMov] = useState<"ingreso" | "egreso">("egreso");
  const [montoMov, setMontoMov] = useState("");
  const [notaMov, setNotaMov] = useState("");
  // Cerrar
  const [cerrando, setCerrando] = useState(false);
  const [contado, setContado] = useState("");
  const [ultimoCierre, setUltimoCierre] = useState<(Cierre & { sessionId: number }) | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [e, h] = await Promise.all([
        api<EstadoCaja>("/api/caja"),
        api<SesionCerrada[]>("/api/caja/historial"),
      ]);
      setEstado(e);
      setHistorial(h);
    } catch (err) {
      setError(mensaje(err));
    }
  }, []);

  // Se relee cada vez que se vuelve a la pestaña: las ventas mueven el arqueo
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  async function imprimir(sessionId: number) {
    try {
      await imprimirCierre(sessionId);
    } catch (err) {
      setError(mensaje(err, "No se pudo imprimir el resumen"));
    }
  }

  async function abrir() {
    setError("");
    setBusy(true);
    try {
      await api("/api/caja/abrir", { body: { openingAmount: leerNumero(fondo) ?? 0, note: notaApertura || undefined } });
      setFondo("");
      setNotaApertura("");
      setUltimoCierre(null);
      await cargar();
    } catch (err) {
      setError(mensaje(err, "No se pudo abrir la caja"));
    } finally {
      setBusy(false);
    }
  }

  async function registrarMovimiento() {
    setError("");
    const amount = leerNumero(montoMov);
    if (!amount || amount <= 0) return setError("Poné un importe.");
    if (!notaMov.trim()) return setError("Anotá el motivo: es lo que se lee después en el arqueo.");
    try {
      await api("/api/caja/movimiento", { body: { type: tipoMov, amount, note: notaMov.trim() } });
      setMontoMov("");
      setNotaMov("");
      setAviso(tipoMov === "egreso" ? "Retiro registrado." : "Ingreso registrado.");
      setTimeout(() => setAviso(""), 3000);
      await cargar();
    } catch (err) {
      setError(mensaje(err, "No se pudo registrar el movimiento"));
    }
  }

  async function cerrar() {
    setError("");
    setBusy(true);
    try {
      const r = await api<{ cierre: Cierre; sessionId: number }>("/api/caja/cerrar", {
        body: { countedAmount: leerNumero(contado) ?? 0 },
      });
      setUltimoCierre({ ...r.cierre, sessionId: r.sessionId });
      setCerrando(false);
      setContado("");
      await cargar();
      // El cierre sale por la impresora apenas se confirma
      imprimir(r.sessionId);
    } catch (err) {
      setError(mensaje(err, "No se pudo cerrar la caja"));
    } finally {
      setBusy(false);
    }
  }

  const r = estado?.resumen;
  const diferenciaPrevia = r && contado ? (leerNumero(contado) ?? 0) - r.efectivoEsperado : null;

  return (
    <ScrollView
      style={s.pantalla}
      contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
    >
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}

      {ultimoCierre && (
        <View style={[s.tarjeta, { gap: 6 }]}>
          <Text style={s.subtitulo}>Caja cerrada</Text>
          <Fila etiqueta="Efectivo esperado" valor={money(ultimoCierre.efectivoEsperado)} />
          <Fila etiqueta="Efectivo contado" valor={money(ultimoCierre.contado)} />
          <Fila
            etiqueta="Diferencia" fuerte
            valor={`${ultimoCierre.diferencia > 0 ? "+" : ""}${money(ultimoCierre.diferencia)}`}
          />
          <Text style={s.apagado}>
            {ultimoCierre.diferencia === 0 ? "La caja cierra exacta"
              : ultimoCierre.diferencia > 0 ? "Sobra dinero en el cajón" : "Falta dinero en el cajón"}
          </Text>
          <Boton variante="secundario" onPress={() => imprimir(ultimoCierre.sessionId)}>Reimprimir cierre</Boton>
        </View>
      )}

      {estado && !estado.abierta && (
        <View style={[s.tarjeta, { gap: 12 }]}>
          <Text style={s.titulo}>🔒 La caja está cerrada</Text>
          <Text style={s.apagado}>
            Anotá con cuánto efectivo arrancás. Así, al cerrar, el sistema puede decirte cuánto tendría que haber en el cajón.
          </Text>
          <TextInput style={s.input} placeholder="Fondo inicial en efectivo" keyboardType="decimal-pad" value={fondo} onChangeText={setFondo} />
          <TextInput style={s.input} placeholder="Nota (opcional)" value={notaApertura} onChangeText={setNotaApertura} />
          <Boton grande onPress={abrir} cargando={busy}>Abrir la caja</Boton>
        </View>
      )}

      {estado?.abierta && r && estado.sesion && (
        <>
          <View style={[s.tarjeta, { gap: 6 }]}>
            <View style={s.entre}>
              <Text style={s.subtitulo}>Turno #{estado.sesion.id}</Text>
              <Text style={s.apagado}>Abierta {fechaHora(estado.sesion.opened_at)}</Text>
            </View>
            <Fila etiqueta="Fondo inicial" valor={money(r.apertura)} />
            {MEDIOS.map((m) => {
              const v = r.ventasPorMedio[m];
              if (!v || (v.total === 0 && v.tickets === 0)) return null;
              return <Fila key={m} etiqueta={`${MEDIO_LABEL[m]} (${v.tickets})`} valor={money(v.total)} />;
            })}
            {r.cuponesEntregados ? <Fila etiqueta="Descuentos ClubPay" valor={`-${money(r.cuponesEntregados)}`} /> : null}
            {r.totalCobrosCuentaCorriente ? <Fila etiqueta="Cobros de cuenta corriente" valor={money(r.totalCobrosCuentaCorriente)} /> : null}
            {r.ingresos ? <Fila etiqueta="Ingresos" valor={money(r.ingresos)} /> : null}
            {r.egresos ? <Fila etiqueta="Retiros y pagos" valor={`-${money(r.egresos)}`} /> : null}
            <View style={{ height: 1, backgroundColor: color.borde, marginVertical: 4 }} />
            <Fila etiqueta={`Total vendido · ${r.totalTickets} tickets`} valor={money(r.totalVendido)} fuerte />
            <Fila etiqueta="Efectivo esperado en el cajón" valor={money(r.efectivoEsperado)} fuerte />
            <Boton variante="secundario" onPress={() => imprimir(estado.sesion!.id)} style={{ marginTop: 8 }}>
              Imprimir resumen parcial
            </Boton>
          </View>

          <View style={[s.tarjeta, { gap: 10 }]}>
            <Text style={s.subtitulo}>Retiro o ingreso de efectivo</Text>
            <View style={s.fila}>
              <Chip activo={tipoMov === "egreso"} onPress={() => setTipoMov("egreso")}>Retiro / pago</Chip>
              <Chip activo={tipoMov === "ingreso"} onPress={() => setTipoMov("ingreso")}>Ingreso</Chip>
            </View>
            <TextInput style={s.input} placeholder="Importe" keyboardType="decimal-pad" value={montoMov} onChangeText={setMontoMov} />
            <TextInput style={s.input} placeholder="Motivo (ej. pago al proveedor de pan)" value={notaMov} onChangeText={setNotaMov} />
            <Boton variante="secundario" onPress={registrarMovimiento}>Registrar</Boton>
            {estado.movimientos?.map((m) => (
              <Fila key={m.id} etiqueta={`${fechaHora(m.created_at)} · ${m.note}`}
                valor={`${m.type === "egreso" ? "-" : "+"}${money(m.amount)}`} />
            ))}
          </View>

          <View style={[s.tarjeta, { gap: 10 }]}>
            {!cerrando ? (
              <Boton variante="peligro" onPress={() => setCerrando(true)}>Cerrar la caja</Boton>
            ) : (
              <>
                <Text style={s.subtitulo}>Contá el efectivo del cajón</Text>
                <TextInput style={s.input} placeholder="Efectivo contado" keyboardType="decimal-pad" value={contado} onChangeText={setContado} autoFocus />
                {diferenciaPrevia !== null && (
                  <Text style={[s.texto, { color: diferenciaPrevia === 0 ? color.ok : color.aviso }]}>
                    {diferenciaPrevia === 0 ? "Cierra exacta"
                      : `${diferenciaPrevia > 0 ? "Sobran" : "Faltan"} ${money(Math.abs(diferenciaPrevia))}`}
                  </Text>
                )}
                <View style={s.fila}>
                  <Boton variante="secundario" onPress={() => setCerrando(false)} style={{ flex: 1 }}>Volver</Boton>
                  <Boton variante="peligro" onPress={cerrar} cargando={busy} desactivado={!contado} style={{ flex: 1 }}>
                    Confirmar cierre
                  </Boton>
                </View>
              </>
            )}
          </View>
        </>
      )}

      {historial.length > 0 && (
        <View style={[s.tarjeta, { gap: 8 }]}>
          <Text style={s.subtitulo}>Cierres anteriores</Text>
          {historial.slice(0, 15).map((h) => (
            <View key={h.id} style={s.entre}>
              <Text style={[s.texto, { flex: 1 }]}>
                #{h.id} · {fechaHora(h.closed_at)}
                {h.closing_summary ? ` · ${money(h.closing_summary.totalVendido)}` : ""}
                {h.closing_summary && h.closing_summary.diferencia !== 0
                  ? ` · dif. ${h.closing_summary.diferencia > 0 ? "+" : ""}${money(h.closing_summary.diferencia)}` : ""}
              </Text>
              <Boton variante="secundario" onPress={() => imprimir(h.id)}>Imprimir</Boton>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
