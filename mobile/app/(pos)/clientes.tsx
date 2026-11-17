import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, leerNumero, mensaje, money } from "@/lib/api";
import { Aviso, Boton, Chip, Fila, Hoja } from "@/components/ui";
import { fechaHora, type Customer } from "@/lib/tipos";
import { color, s } from "@/lib/tema";

interface Ficha {
  customer: Customer & { libreta_activa?: boolean };
  transactions: { id: number; type: string; amount: string; note: string | null; created_at: string }[];
  credito: { libreta: boolean; pausado: boolean; limite: number | null; disponible: number | null } | null;
}

const MEDIOS_PAGO = [
  { id: "cash", label: "Efectivo" }, { id: "transfer", label: "Transferencia" },
  { id: "card", label: "Tarjeta" }, { id: "wallet", label: "Billetera" },
];

/**
 * Clientes y su cuenta corriente: ver lo que deben y cobrarles en el
 * mostrador. La ficha completa (límite, pausa, resúmenes, ClubPay) sigue en
 * nexopos.app.
 */
export default function Clientes() {
  const [clientes, setClientes] = useState<Customer[]>([]);
  const [busca, setBusca] = useState("");
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState("cash");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [busy, setBusy] = useState(false);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setClientes(await api<Customer[]>("/api/customers"));
    } catch (err) {
      setError(mensaje(err));
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  async function abrir(id: number) {
    setError("");
    try {
      setFicha(await api<Ficha>(`/api/customers/${id}/transactions`));
      setMonto("");
    } catch (err) {
      setError(mensaje(err));
    }
  }

  async function registrarPago() {
    if (!ficha) return;
    const amount = leerNumero(monto);
    if (!amount || amount <= 0) return setError("Poné cuánto paga.");
    setBusy(true);
    setError("");
    try {
      // Se imputa del resumen más viejo al más nuevo, como el cuaderno
      await api(`/api/customers/${ficha.customer.id}/payments`, { body: { amount, paymentMethod: medio } });
      setAviso(`Pago de ${money(amount)} registrado a ${ficha.customer.name}.`);
      setTimeout(() => setAviso(""), 5000);
      await Promise.all([abrir(Number(ficha.customer.id)), cargar()]);
    } catch (err) {
      setError(mensaje(err, "No se pudo registrar el pago"));
    } finally {
      setBusy(false);
    }
  }

  const lista = clientes.filter((c) => !busca || c.name.toLowerCase().includes(busca.toLowerCase())
    || (c.doc_number ?? "").includes(busca) || (c.phone ?? "").includes(busca));

  return (
    <View style={s.pantalla}>
      <View style={{ padding: 12, gap: 8 }}>
        <TextInput style={s.input} placeholder="Buscar por nombre, documento o teléfono…" value={busca} onChangeText={setBusca} />
        {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
        {error && !ficha ? <Aviso tipo="error">{error}</Aviso> : null}
      </View>
      <FlatList
        data={lista}
        keyExtractor={(c) => String(c.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6, maxWidth: 900, width: "100%", alignSelf: "center" }}
        ListEmptyComponent={<Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>
          {busca ? "Ningún cliente coincide con la búsqueda." : "Todavía no hay clientes. Se cargan al vender, desde «Consumidor final»."}
        </Text>}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
        renderItem={({ item: c }) => (
          <Pressable onPress={() => abrir(Number(c.id))} style={[s.tarjeta, s.entre, { padding: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.texto}>{c.name}</Text>
              {c.phone ? <Text style={s.apagado}>{c.phone}</Text> : null}
            </View>
            <Text style={[s.texto, { fontWeight: "700", color: Number(c.balance) > 0 ? color.error : color.apagado }]}>
              {Number(c.balance) > 0 ? `debe ${money(c.balance)}` : Number(c.balance) < 0 ? `a favor ${money(-Number(c.balance))}` : "al día"}
            </Text>
          </Pressable>
        )}
      />

      <Hoja visible={!!ficha} titulo={ficha?.customer.name ?? ""} onCerrar={() => { setFicha(null); setError(""); }}>
        {ficha && (
          <>
            <View style={[s.tarjeta, { gap: 6 }]}>
              <Fila etiqueta="Saldo" valor={money(ficha.customer.balance)} fuerte />
              {ficha.credito && !ficha.credito.libreta && <Text style={s.apagado}>Sin libreta: no se le puede fiar.</Text>}
              {ficha.credito?.pausado && <Aviso tipo="aviso">La cuenta corriente está pausada. Se reactiva desde la ficha en nexopos.app.</Aviso>}
            </View>
            <View style={[s.tarjeta, { gap: 10 }]}>
              <Text style={s.subtitulo}>Registrar un pago</Text>
              <TextInput style={[s.input, { fontSize: 20 }]} placeholder="Importe" keyboardType="decimal-pad" value={monto} onChangeText={setMonto} />
              <View style={[s.fila, { flexWrap: "wrap" }]}>
                {Number(ficha.customer.balance) > 0 && <Chip onPress={() => setMonto(String(Number(ficha.customer.balance)))}>Todo lo que debe</Chip>}
              </View>
              <View style={[s.fila, { flexWrap: "wrap" }]}>
                {MEDIOS_PAGO.map((m) => <Chip key={m.id} activo={medio === m.id} onPress={() => setMedio(m.id)}>{m.label}</Chip>)}
              </View>
              {error ? <Aviso tipo="error">{error}</Aviso> : null}
              <Boton onPress={registrarPago} cargando={busy}>Registrar pago</Boton>
            </View>
            <Text style={s.subtitulo}>Movimientos</Text>
            {ficha.transactions.map((t) => (
              <Fila key={t.id} etiqueta={`${fechaHora(t.created_at)} · ${t.note ?? t.type}`}
                valor={`${Number(t.amount) > 0 ? "+" : ""}${money(t.amount)}`} />
            ))}
          </>
        )}
      </Hoja>
    </View>
  );
}
