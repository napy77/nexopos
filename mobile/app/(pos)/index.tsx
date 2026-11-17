import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList, Image, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, ApiError, leerNumero, mensaje, money, referencia } from "@/lib/api";
import { imprimirQr, imprimirTicket, useImpresora } from "@/lib/impresora";
import { BALANZA_DEFAULT, buscarPorPlu, leerCodigoBalanza, type BalanzaConfig } from "@/lib/balanza";
import { Aviso, Boton, Chip, Fila, Hoja } from "@/components/ui";
import { CompartirTicket } from "@/components/compartir-ticket";
import {
  type ClubPayCobro, type ClubPayCobroEstado, type ClubPayElegido, type ClubPayOferta,
  type ClubPayValidacion, type CobroMP, type Customer, type StockItem,
} from "@/lib/tipos";
import { color, s } from "@/lib/tema";

/**
 * El mostrador. Sigue a `frontend/app/(dashboard)/ventas/page.tsx` regla por
 * regla: los mismos endpoints, los mismos resguardos con ClubPay y Mercado
 * Pago. Lo que cambia es la pantalla, que tiene que servir en un celular.
 *
 * El lector Bluetooth se empareja como un teclado: "tipea" el código en el
 * buscador y manda Enter. Por eso el buscador tiene que tener el foco siempre
 * que no se esté escribiendo en otro lado.
 */

interface SaleLine {
  productId: number; name: string; quantity: number;
  unitPrice: number; basePrice: number; available: number; porPeso?: boolean;
}

const MEDIOS = [
  { id: "cash", label: "💵 Efectivo" },
  { id: "wallet", label: "📱 Billetera" },
  { id: "card", label: "💳 Tarjeta" },
  { id: "transfer", label: "🏦 Transferencia" },
  { id: "account", label: "📒 Cuenta corriente" },
  { id: "mercadopago", label: "📲 Mercado Pago" },
] as const;

/** Tablet apaisada o grande: catálogo y ticket lado a lado */
const ANCHO_DOS_PANELES = 900;

export default function Vender() {
  const { width } = useWindowDimensions();
  const dosPaneles = width >= ANCHO_DOS_PANELES;
  const autoPrint = useImpresora((e) => e.config.autoPrint);
  // Sin ticketera elegida no se intenta imprimir: el ticket sale por WhatsApp o QR
  const hayTicketera = useImpresora((e) => e.config.tipo !== "ninguna");
  const [compartir, setCompartir] = useState<{ id: number; ticketNumber: number } | null>(null);

  const [items, setItems] = useState<StockItem[]>([]);
  // Un comercio sin productos y un stock que todavía no llegó se ven igual
  // (lista vacía); sin esto, el primero quedaba en "Cargando" para siempre.
  const [stockCargado, setStockCargado] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [pasillo, setPasillo] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [view, setView] = useState<"order" | "payment">("order");
  /** En celular: qué mitad se ve */
  const [verTicket, setVerTicket] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastTicket, setLastTicket] = useState<{ id: number; ticketNumber: number; total: number; vuelto: number | null } | null>(null);
  const [showCustomers, setShowCustomers] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [balanza, setBalanza] = useState<BalanzaConfig>(BALANZA_DEFAULT);
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [pagaCon, setPagaCon] = useState("");
  const [cobrando, setCobrando] = useState(false);
  // ClubPay: el QR vence a los 60 segundos, nada se guarda más allá de esta venta
  const [clubpayDisponible, setClubpayDisponible] = useState(false);
  const [qrSocio, setQrSocio] = useState("");
  const [validando, setValidando] = useState(false);
  const [socio, setSocio] = useState<ClubPayValidacion | null>(null);
  const [clubpayElegido, setClubpayElegido] = useState<ClubPayElegido | null>(null);
  const [clubpayError, setClubpayError] = useState("");
  const [cobro, setCobro] = useState<ClubPayCobro | null>(null);
  const [cobroEstado, setCobroEstado] = useState<ClubPayCobroEstado | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);
  const refCobro = useRef<{ id: string; total: number } | null>(null);
  // Mercado Pago, por el vínculo que el comercio hizo en ClubPay
  const [mpEstado, setMpEstado] = useState<{ mostrador: boolean; motivo: string | null } | null>(null);
  const [cobroMP, setCobroMP] = useState<CobroMP | null>(null);
  const [mpError, setMpError] = useState("");
  const refCobroMP = useRef<{ id: string; total: number } | null>(null);
  /** El pago ya entró y la venta se está emitiendo: no emitirla dos veces */
  const emitiendoMP = useRef(false);
  /**
   * El último QR de Mercado Pago que quedó vivo. Mientras exista no se cobra
   * de otra forma sin darlo de baja: si no, el cliente paga en efectivo, el
   * QR se aprueba igual y pagó dos veces.
   */
  const mpVivo = useRef<string | null>(null);
  const searchRef = useRef<TextInput>(null);

  const foco = () => setTimeout(() => searchRef.current?.focus(), 50);
  /*
   * Se borra el campo en pantalla además del estado: con el lector, el estado
   * puede ir atrasado respecto de lo tipeado, y si ya estaba vacío setQ("") no
   * redibuja y el código queda escrito. La lectura siguiente se pegaría atrás.
   */
  const vaciarBuscador = () => { searchRef.current?.clear(); setQ(""); };
  const avisar = (t: string, ms = 6000) => { setNotice(t); setTimeout(() => setNotice(""), ms); };

  const loadStock = useCallback(() => {
    api<StockItem[]>("/api/stock")
      .then((r) => { setItems(r); setStockCargado(true); })
      .catch((e) => setError(mensaje(e)));
  }, []);
  const loadCustomers = useCallback(() => {
    api<Customer[]>("/api/customers").then(setCustomers).catch(() => {});
  }, []);

  useEffect(() => {
    loadStock();
    loadCustomers();
    api<{ balanza: BalanzaConfig }>("/api/settings/balanza").then((d) => setBalanza(d.balanza)).catch(() => {});
    api<{ configurado: boolean }>("/api/clubpay/estado")
      .then((d) => setClubpayDisponible(d.configurado)).catch(() => setClubpayDisponible(false));
    api<{ mostrador: boolean; motivo: string | null }>("/api/mercadopago/estado")
      .then(setMpEstado).catch(() => setMpEstado(null));
  }, [loadStock, loadCustomers]);

  // La caja se abre y se cierra desde otra pestaña, y los productos y precios
  // se cargan en Productos y Compras: se relee todo al volver
  useFocusEffect(useCallback(() => {
    api<{ abierta: boolean }>("/api/caja").then((d) => setCajaAbierta(d.abierta)).catch(() => {});
    loadStock();
    foco();
  }, [loadStock]));

  // ── Sondeo del QR de ClubPay, cada 2 s hasta que el socio confirma o vence ──
  useEffect(() => {
    if (!chargeId) return;
    let vivo = true;
    const timer = setInterval(async () => {
      try {
        const est = await api<ClubPayCobroEstado>(`/api/clubpay/cobro/${chargeId}`);
        if (!vivo) return;
        setCobroEstado(est);
        if (est.status === "applied") {
          clearInterval(timer);
          if (est.member && est.offer) {
            setClubpayElegido({
              socio: est.member,
              oferta: {
                ...est.offer, points_per_use: 0, valid_until: null,
                condiciones: est.offer.condiciones ?? [], aplica_hoy: true, motivo: "",
              },
              descuento: est.descuento ?? 0,
            });
          }
          // Queda aplicado, sin cancelarlo
          setTimeout(() => { setCobro(null); setChargeId(null); }, 1800);
        }
        if (est.status === "expired" || est.status === "rejected" || est.status === "cancelled") clearInterval(timer);
      } catch (err) {
        if (!vivo) return;
        clearInterval(timer);
        setClubpayError(mensaje(err, "Se perdió la conexión con ClubPay"));
      }
    }, 2000);
    return () => { vivo = false; clearInterval(timer); };
  }, [chargeId]);

  // ── Sondeo de Mercado Pago: apenas acredita, la venta se emite sola ─────────
  const cobroMPId = cobroMP?.paymentId ?? null;
  useEffect(() => {
    if (!cobroMPId) return;
    let vivo = true;
    const timer = setInterval(async () => {
      try {
        const est = await api<{ status: CobroMP["status"]; error: string | null }>(`/api/mercadopago/cobro/${cobroMPId}`);
        if (!vivo) return;
        setCobroMP((c) => (c ? { ...c, status: est.status, error: est.error } : c));
        if (est.status === "paid") {
          clearInterval(timer);
          emitirConMP(cobroMPId);
        }
        // `rejected` no corta: con el mismo QR el cliente puede probar otra tarjeta
        if (est.status === "expired" || est.status === "cancelled" || est.status === "refunded") clearInterval(timer);
      } catch (err) {
        if (!vivo) return;
        setMpError(mensaje(err, "Se perdió la conexión con ClubPay"));
      }
    }, 2000);
    return () => { vivo = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobroMPId]);

  // ── Catálogo ───────────────────────────────────────────────────────────────

  // La grilla muestra lo que tiene stock, pero el lector busca en todo el stock
  // local: si el cajero tiene el producto en la mano, existe.
  const sellable = useMemo(() => items.filter((i) => Number(i.quantity) > 0), [items]);
  const pasillos = useMemo(() => [...new Set(sellable.map((i) => i.pasillo_nombre ?? "Otros"))].sort(), [sellable]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sellable.filter((i) => {
      if (pasillo && (i.pasillo_nombre ?? "Otros") !== pasillo) return false;
      if (!term) return true;
      return i.name.toLowerCase().includes(term) || (i.ean ?? "").includes(term) || (i.plu ?? "") === term;
    });
  }, [sellable, pasillo, q]);

  const customer = customers.find((c) => Number(c.id) === customerId);
  const total = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
  // El beneficio de ClubPay no achica la venta: entra como forma de pago
  const descuentoClub = clubpayElegido?.descuento ?? 0;
  const aCobrar = Math.round((total - descuentoClub) * 100) / 100;
  const montoPagado = leerNumero(pagaCon);
  const vuelto = montoPagado !== null ? montoPagado - aCobrar : null;
  const faltaPlata = vuelto !== null && vuelto < 0;
  const unidades = lines.reduce((a, l) => a + (l.porPeso ? 1 : l.quantity), 0);

  /** El monto justo y los billetes inmediatamente superiores */
  const sugerencias = useMemo(() => {
    const billetes = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const mayores = billetes.filter((b) => b > aCobrar).slice(0, 3);
    const alMil = Math.ceil(aCobrar / 1000) * 1000;
    if (alMil > aCobrar && !mayores.includes(alMil)) mayores.unshift(alMil);
    return [...new Set(mayores)].sort((a, b) => a - b).slice(0, 4);
  }, [aCobrar]);

  function addLine(item: StockItem, cantidad?: number, importe?: number) {
    if (!item.sale_price && importe === undefined) {
      setError(`"${item.name}" no tiene precio de venta. Definilo en Stock (nexopos.app).`);
      return;
    }
    setError("");
    setLastTicket(null);
    // Etiqueta de balanza: entra con el peso (o el importe), no se acumula de a uno
    if (cantidad !== undefined || importe !== undefined) {
      const precio = importe !== undefined ? importe : Number(item.sale_price);
      setLines((prev) => [...prev, {
        productId: item.product_id, name: item.name, quantity: importe !== undefined ? 1 : cantidad!,
        unitPrice: precio, basePrice: precio, available: Number(item.quantity), porPeso: item.venta_por_peso,
      }]);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === item.product_id && !l.porPeso);
      // Sumar sin tope: si el stock quedó corto igual se vende, y queda en negativo
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      const price = Number(item.sale_price);
      return [...prev, {
        productId: item.product_id, name: item.name, quantity: 1,
        unitPrice: price, basePrice: price, available: Number(item.quantity),
      }];
    });
  }

  /**
   * Recibe el texto que trae el Enter y no lee el estado: el lector tipea los
   * 13 dígitos y el Enter en milisegundos, y el estado todavía puede tener
   * la lectura a medias cuando llega el Enter.
   */
  async function onSearchEnter(texto: string) {
    const term = texto.trim();
    if (!term) return foco();

    // 1. Etiqueta de balanza: trae el producto y el peso adentro
    const lectura = leerCodigoBalanza(term, balanza);
    if (lectura) {
      const item = buscarPorPlu(items, lectura.plu);
      if (!item) {
        setError(`Etiqueta de balanza con código ${lectura.plu}, pero ningún producto tuyo lo tiene asignado.`);
      } else {
        addLine(item, lectura.peso, lectura.importe);
      }
      vaciarBuscador();
      return foco();
    }

    // 2. EAN común (en todo el stock, con o sin existencias), o el único resultado a la vista
    let exact = items.find((i) => i.ean === term);
    // El stock llega de a 500: un comercio grande puede tener el código más allá
    if (!exact && /^\d{8,14}$/.test(term)) {
      exact = (await api<StockItem[]>(`/api/stock?q=${encodeURIComponent(term)}`).catch(() => []))
        .find((i) => i.ean === term);
    }
    const target = exact ?? (visible.length === 1 ? visible[0] : null);
    if (target) {
      addLine(target);
      vaciarBuscador();
    } else if (/^\d{8,14}$/.test(term)) {
      setError(`El código ${term} no está en tu stock.`);
      vaciarBuscador();
    }
    foco();
  }

  // ── ClubPay ────────────────────────────────────────────────────────────────

  async function validarSocio(texto = qrSocio) {
    const token = texto.trim();
    if (!token) return;
    setClubpayError("");
    setValidando(true);
    try {
      const val = await api<ClubPayValidacion>("/api/clubpay/validar", { body: { qrToken: token, total } });
      setSocio(val);
      setQrSocio("");
      const aplicables = val.offers.filter((o) => o.aplica_hoy);
      if (aplicables.length === 1) elegirOferta(val, aplicables[0]);
    } catch (err) {
      // El mensaje viene escrito por ClubPay para leérselo al cliente
      setClubpayError(mensaje(err, "No se pudo validar el socio"));
      setSocio(null);
      setClubpayElegido(null);
    } finally {
      setValidando(false);
    }
  }

  function elegirOferta(val: ClubPayValidacion, oferta: ClubPayOferta) {
    setClubpayElegido({
      socio: val.member, oferta,
      descuento: oferta.discount_cents !== undefined ? oferta.discount_cents / 100 : 0,
    });
  }

  /** QR del comercio para que el socio lo escanee con su teléfono */
  async function mostrarQrCobro() {
    setClubpayError("");
    try {
      // Mismo intento y mismo importe → mismo cobro; si el ticket cambió, es otro
      let ref = refCobro.current;
      if (!ref || ref.total !== total) refCobro.current = ref = { id: referencia(), total };
      const c = await api<ClubPayCobro>("/api/clubpay/cobro", { body: { total, referencia: ref.id } });
      setCobro(c);
      setChargeId(c.charge_id);
      setCobroEstado(null);
    } catch (err) {
      setClubpayError(mensaje(err, "No se pudo generar el QR"));
    }
  }

  function cerrarQrCobro(cancelar = true) {
    const id = chargeId;
    setCobro(null);
    setChargeId(null);
    setCobroEstado(null);
    refCobro.current = null;
    if (cancelar && id) api(`/api/clubpay/cobro/${id}/cancelar`, { method: "POST" }).catch(() => {});
  }

  function quitarClubpay() {
    setSocio(null);
    setClubpayElegido(null);
    setClubpayError("");
    setQrSocio("");
    cerrarQrCobro();
  }

  // ── Mercado Pago ───────────────────────────────────────────────────────────

  async function mostrarQrMP() {
    setMpError("");
    setError("");
    try {
      let ref = refCobroMP.current;
      if (!ref || ref.total !== aCobrar) refCobroMP.current = ref = { id: referencia(), total: aCobrar };
      const c = await api<CobroMP>("/api/mercadopago/cobro", { body: { total: aCobrar, referencia: ref.id } });
      emitiendoMP.current = false;
      mpVivo.current = c.paymentId;
      setCobroMP(c);
    } catch (err) {
      setError(mensaje(err, "No se pudo generar el QR de Mercado Pago"));
    }
  }

  /**
   * Cancelar puede llegar tarde: si el cliente pagó justo antes, el backend
   * contesta `paid` y en vez de cerrar se emite la venta.
   */
  async function cancelarQrMP(): Promise<boolean> {
    const c = cobroMP;
    if (!c) return true;
    if (c.status === "paid") return false;
    try {
      const r = await api<{ status: CobroMP["status"] }>(`/api/mercadopago/cobro/${c.paymentId}/cancelar`, { method: "POST" });
      if (r.status === "paid") {
        setCobroMP({ ...c, status: "paid" });
        emitirConMP(c.paymentId);
        return false;
      }
    } catch (err) {
      setMpError(mensaje(err, "No se pudo cancelar el cobro"));
      return false;
    }
    mpVivo.current = null;
    setCobroMP(null);
    refCobroMP.current = null;
    return true;
  }

  async function emitirConMP(paymentId: string) {
    if (emitiendoMP.current) return;
    emitiendoMP.current = true;
    const ok = await cobrar(paymentId);
    if (ok) {
      mpVivo.current = null;
      setCobroMP(null);
      refCobroMP.current = null;
    } else {
      // El pago entró pero la venta no: queda a la vista con la salida, que es devolverlo
      emitiendoMP.current = false;
    }
  }

  async function devolverPagoMP() {
    const c = cobroMP;
    if (!c) return;
    setMpError("");
    try {
      await api(`/api/mercadopago/cobro/${c.paymentId}/devolver`, { method: "POST" });
      mpVivo.current = null;
      setCobroMP(null);
      refCobroMP.current = null;
      avisar(`Se le devolvieron ${money(c.monto)} al cliente por Mercado Pago.`, 8000);
    } catch (err) {
      setMpError(mensaje(err, "No se pudo devolver el pago"));
    }
  }

  // ── Cobro ──────────────────────────────────────────────────────────────────

  async function cobrar(mpPaymentId?: string): Promise<boolean> {
    setError("");
    // Otro medio con un QR de Mercado Pago vivo: primero se da de baja. Si al
    // cancelar resulta que ya pagó, la venta se cierra con ese pago.
    if (!mpPaymentId && mpVivo.current) {
      const vivo = mpVivo.current;
      try {
        const r = await api<{ status: CobroMP["status"] }>(`/api/mercadopago/cobro/${vivo}/cancelar`, { method: "POST" });
        if (r.status === "paid") {
          setPaymentMethod("mercadopago");
          setCobroMP((c) => (c ? { ...c, status: "paid" } : c));
          setError("El cliente ya había pagado con Mercado Pago: la venta se cierra con ese pago.");
          await emitirConMP(vivo);
          return false;
        }
        mpVivo.current = null;
        refCobroMP.current = null;
        setCobroMP(null);
      } catch (err) {
        setError(`No se pudo dar de baja el QR de Mercado Pago: ${mensaje(err)}. Probá de nuevo antes de cobrar de otra forma.`);
        return false;
      }
    }
    setCobrando(true);
    try {
      const sale = await api<{
        id: number; ticketNumber: number; total: number; vuelto: number | null;
        clubpay?: { descuento: number; recorteTexto: string | null } | null;
      }>("/api/sales", {
        body: {
          items: lines.filter((l) => l.quantity > 0).map((l) => ({
            productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice,
          })),
          // Con un pago de Mercado Pago el medio es ése, elija lo que elija la pantalla
          paymentMethod: mpPaymentId ? "mercadopago" : paymentMethod,
          customerId: customerId ?? undefined,
          discount: 0,
          paidAmount: !mpPaymentId && paymentMethod === "cash" && montoPagado ? montoPagado : undefined,
          // Sólo los ids: los importes los relee el backend de ClubPay y de Mercado Pago
          mercadopago: mpPaymentId ? { paymentId: mpPaymentId } : undefined,
          clubpay: !clubpayElegido ? undefined : {
            ...(cobroEstado?.status === "applied"
              ? { chargeId: cobroEstado.charge_id }
              : { membershipId: clubpayElegido.socio.membership_id, offerId: clubpayElegido.oferta.id }),
            memberName: clubpayElegido.socio.name,
            clubName: clubpayElegido.socio.club_name,
          },
        },
      });
      setLastTicket({ id: sale.id, ticketNumber: sale.ticketNumber, total, vuelto: sale.vuelto ?? null });
      setLines([]);
      setCustomerId(null);
      setPaymentMethod("cash");
      setPagaCon("");
      quitarClubpay();
      setView("order");
      setVerTicket(false);
      if (sale.clubpay) {
        const extra = sale.clubpay.recorteTexto ? ` · ${sale.clubpay.recorteTexto}` : "";
        avisar(`Beneficio ClubPay aplicado: ${money(sale.clubpay.descuento)}${extra}`, 8000);
      }
      loadStock();
      loadCustomers();
      foco();
      // La impresión va después de limpiar: la caja queda lista aunque la impresora falle
      if (autoPrint && hayTicketera) imprimir(sale.id);
      return true;
    } catch (err) {
      const msg = mensaje(err, "Error al cobrar");
      setError(msg);
      if (mpPaymentId) setMpError(msg);
      if (err instanceof ApiError && err.code === "caja_cerrada") setCajaAbierta(false);
      return false;
    } finally {
      setCobrando(false);
    }
  }

  async function imprimir(saleId: number) {
    try {
      await imprimirTicket(saleId);
    } catch (err) {
      setError(mensaje(err, "No se pudo imprimir el ticket"));
    }
  }

  function anularVenta() {
    setLines([]);
    quitarClubpay();
    setCustomerId(null);
    setView("order");
    avisar("Venta anulada.", 2500);
    foco();
  }

  async function crearCliente() {
    const name = buscaCliente.trim();
    if (!name) return;
    try {
      const c = await api<Customer>("/api/customers", { body: { name } });
      setBuscaCliente("");
      loadCustomers();
      setCustomers((prev) => [...prev, c]);
      setCustomerId(Number(c.id));
      setShowCustomers(false);
    } catch (err) {
      setError(mensaje(err, "No se pudo crear el cliente"));
    }
  }

  // ── Pantalla ───────────────────────────────────────────────────────────────

  if (cajaAbierta === false) {
    return (
      <View style={[s.pantalla, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <View style={[s.tarjeta, { maxWidth: 440, gap: 12, alignItems: "center" }]}>
          <Text style={{ fontSize: 48 }}>🔒</Text>
          <Text style={s.titulo}>La caja está cerrada</Text>
          <Text style={[s.apagado, { textAlign: "center" }]}>
            Para vender hay que abrir la caja del turno y anotar con cuánto efectivo arrancás.
          </Text>
          <Boton grande onPress={() => router.navigate("/caja")}>Abrir la caja</Boton>
        </View>
      </View>
    );
  }

  const linea = editando !== null ? lines[editando] : null;
  const columnas = dosPaneles ? Math.max(2, Math.floor((width * 0.58) / 180)) : width >= 600 ? 3 : 2;

  const catalogo = (
    <View style={{ flex: dosPaneles ? 3 : 1 }}>
      <View style={{ padding: 12, gap: 8 }}>
        <TextInput
          ref={searchRef}
          style={[s.input, { fontSize: 18 }]}
          placeholder="Escaneá o buscá un producto…"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={(e) => onSearchEnter(e.nativeEvent.text)}
          submitBehavior="submit"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
          <Chip activo={!pasillo} onPress={() => setPasillo("")}>Todo</Chip>
          {pasillos.map((p) => <Chip key={p} activo={pasillo === p} onPress={() => setPasillo(pasillo === p ? "" : p)}>{p}</Chip>)}
        </ScrollView>
      </View>
      <FlatList
        key={columnas}
        data={visible}
        numColumns={columnas}
        keyExtractor={(i) => String(i.product_id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 8, paddingBottom: dosPaneles ? 8 : 90 }}
        ListEmptyComponent={<Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>
          {!stockCargado
            ? "Cargando el stock…"
            : q.trim()
              ? "No hay productos con ese nombre."
              : "No hay productos con stock para mostrar. Escaneá el código para venderlo igual."}
        </Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { addLine(item); foco(); }}
            style={({ pressed }) => [s.tarjeta, { flex: 1 / columnas, margin: 4, padding: 10, opacity: pressed ? 0.7 : 1, gap: 4 }]}
          >
            {item.image_url
              ? <Image source={{ uri: item.image_url }} style={{ height: 70, borderRadius: 6 }} resizeMode="contain" />
              : null}
            <Text numberOfLines={2} style={[s.texto, { fontWeight: "600", minHeight: 38 }]}>{item.name}</Text>
            <Text style={[s.texto, { color: color.primario, fontWeight: "700" }]}>
              {item.sale_price ? money(item.sale_price) : "Sin precio"}{item.venta_por_peso ? " /kg" : ""}
            </Text>
            <Text style={s.apagado}>Stock {Number(item.quantity).toLocaleString("es-AR")}</Text>
          </Pressable>
        )}
      />
    </View>
  );

  const ticket = (
    <View style={{ flex: dosPaneles ? 2 : 1, backgroundColor: "#fff", borderLeftWidth: dosPaneles ? 1 : 0, borderColor: color.borde }}>
      <View style={[s.entre, { padding: 12, borderBottomWidth: 1, borderColor: color.borde }]}>
        <Pressable onPress={() => setShowCustomers(true)} style={{ flex: 1 }}>
          <Text style={[s.subtitulo, { color: customer ? color.primario : color.texto }]} numberOfLines={1}>
            👤 {customer ? customer.name : "Consumidor final"}
          </Text>
          {customer && Number(customer.balance) > 0 && <Text style={s.apagado}>Debe {money(customer.balance)}</Text>}
        </Pressable>
        {!dosPaneles && <Boton variante="secundario" onPress={() => setVerTicket(false)}>+ Productos</Boton>}
      </View>

      {view === "order" ? (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }} keyboardShouldPersistTaps="handled">
            {lines.length === 0 && <Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>Escaneá un producto para empezar.</Text>}
            {lines.map((l, i) => (
              <Pressable key={`${l.productId}-${i}`} onPress={() => setEditando(i)}
                style={[s.entre, { paddingVertical: 8, borderBottomWidth: 1, borderColor: color.borde }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.texto} numberOfLines={2}>{l.name}</Text>
                  <Text style={s.apagado}>
                    {l.quantity.toLocaleString("es-AR", { maximumFractionDigits: 3 })}{l.porPeso ? " kg" : ""} × {money(l.unitPrice)}
                    {l.unitPrice !== l.basePrice ? `  (antes ${money(l.basePrice)})` : ""}
                  </Text>
                </View>
                <Text style={[s.texto, { fontWeight: "700" }]}>{money(l.quantity * l.unitPrice)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderColor: color.borde }}>
            <Fila etiqueta="TOTAL" valor={money(total)} fuerte />
            <View style={s.fila}>
              <Boton variante="secundario" onPress={anularVenta} desactivado={!lines.length}>Anular</Boton>
              <Boton grande style={{ flex: 1 }} desactivado={!lines.length} onPress={() => setView("payment")}>
                Cobrar {money(total)}
              </Boton>
            </View>
          </View>
        </>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => setView("order")}><Text style={{ color: color.primario }}>← Volver al ticket</Text></Pressable>
          <Fila etiqueta="Total" valor={money(total)} fuerte />

          {clubpayDisponible && (
            <View style={[s.tarjeta, { gap: 8, padding: 12 }]}>
              <Text style={s.subtitulo}>🎫 Socio ClubPay</Text>
              {!socio && !clubpayElegido && (
                <>
                  <Boton variante="secundario" onPress={mostrarQrCobro}>Mostrar QR al socio</Boton>
                  <Text style={s.apagado}>¿Tenés lector de QR? Escaneá el del socio:</Text>
                  <View style={s.fila}>
                    <TextInput style={[s.input, { flex: 1 }]} value={qrSocio} onChangeText={setQrSocio}
                      onSubmitEditing={(e) => validarSocio(e.nativeEvent.text)} placeholder="QR del socio…" autoCapitalize="none" autoCorrect={false} />
                    <Boton variante="secundario" onPress={() => validarSocio()} cargando={validando} desactivado={!qrSocio.trim()}>Validar</Boton>
                  </View>
                </>
              )}
              {socio && !clubpayElegido && (
                <>
                  <Text style={s.texto}>{socio.member.name} · {socio.member.club_name} · Socio {socio.member.member_number}</Text>
                  {socio.offers.length === 0 && <Text style={s.apagado}>El socio está al día, pero hoy no tiene beneficios en este comercio.</Text>}
                  {socio.offers.map((o) => (
                    <Pressable key={o.id} disabled={!o.aplica_hoy} onPress={() => elegirOferta(socio, o)}
                      style={[s.tarjeta, { padding: 10, opacity: o.aplica_hoy ? 1 : 0.6 }]}>
                      <Text style={s.texto}>{o.description} · {o.discount_percent}%</Text>
                      {o.discount_cents !== undefined && o.aplica_hoy && <Text style={{ color: color.ok }}>−{money(o.discount_cents / 100)}</Text>}
                      {!o.aplica_hoy && o.motivo ? <Text style={s.apagado}>{o.motivo}</Text> : null}
                    </Pressable>
                  ))}
                </>
              )}
              {clubpayElegido && (
                <View style={s.entre}>
                  <Text style={[s.texto, { flex: 1 }]}>{clubpayElegido.socio.name} · {clubpayElegido.oferta.description}</Text>
                  <Text style={{ color: color.ok, fontWeight: "700" }}>−{money(clubpayElegido.descuento)}</Text>
                </View>
              )}
              {(socio || clubpayElegido) && <Boton variante="secundario" onPress={quitarClubpay}>Quitar socio</Boton>}
              {clubpayError ? <Aviso tipo="error">{clubpayError}</Aviso> : null}
            </View>
          )}

          {descuentoClub > 0 && <Fila etiqueta="A cobrar" valor={money(aCobrar)} fuerte />}

          <View style={[s.fila, { flexWrap: "wrap" }]}>
            {MEDIOS.map((m) => {
              // Mercado Pago se cobra por ClubPay: sin ClubPay no aparece
              if (m.id === "mercadopago" && !mpEstado?.mostrador && !mpEstado?.motivo) return null;
              const apagado = (m.id === "account" && !customerId) || (m.id === "mercadopago" && !mpEstado?.mostrador);
              return (
                <Chip key={m.id} activo={paymentMethod === m.id}
                  onPress={() => {
                    if (apagado) {
                      setError(m.id === "account" ? "La cuenta corriente requiere un cliente: tocá 👤 arriba y elegilo." : mpEstado?.motivo ?? "");
                      return;
                    }
                    setError("");
                    setPaymentMethod(m.id);
                  }}>
                  {m.label}
                </Chip>
              );
            })}
          </View>

          {paymentMethod === "cash" && (
            <View style={{ gap: 8 }}>
              <TextInput style={[s.input, { fontSize: 20 }]} placeholder="Paga con…" keyboardType="decimal-pad" value={pagaCon} onChangeText={setPagaCon} />
              <View style={[s.fila, { flexWrap: "wrap" }]}>
                <Chip onPress={() => setPagaCon(String(aCobrar))}>Justo</Chip>
                {sugerencias.map((b) => <Chip key={b} onPress={() => setPagaCon(String(b))}>{money(b)}</Chip>)}
              </View>
              {vuelto !== null && (
                <Text style={[s.titulo, { color: faltaPlata ? color.error : color.ok }]}>
                  {faltaPlata ? `Faltan ${money(-vuelto)}` : `Vuelto ${money(vuelto)}`}
                </Text>
              )}
            </View>
          )}

          {paymentMethod === "mercadopago" ? (
            cobroMP ? (
              <View style={[s.tarjeta, { alignItems: "center", gap: 8 }]}>
                <Text style={s.subtitulo}>Que el cliente escanee con Mercado Pago</Text>
                <Image source={{ uri: cobroMP.qrDataUrl }} style={{ width: 240, height: 240 }} />
                <Text style={s.titulo}>{money(cobroMP.monto)}</Text>
                <Text style={s.apagado}>
                  {cobroMP.status === "pending" ? "Esperando el pago…"
                    : cobroMP.status === "paid" ? "Pagado. Emitiendo el ticket…"
                    : cobroMP.status === "rejected" ? (cobroMP.error ?? "Rechazado. Puede probar con otra tarjeta.")
                    : cobroMP.status === "expired" ? "El QR venció. Generá otro." : cobroMP.status}
                </Text>
                {mpError ? <Aviso tipo="error">{mpError}</Aviso> : null}
                {cobroMP.status === "paid" && mpError
                  ? <Boton variante="peligro" onPress={devolverPagoMP}>Devolverle el pago al cliente</Boton>
                  : (
                    <View style={s.fila}>
                      {cobroMP.qrData && (
                        <Boton variante="secundario" onPress={() => imprimirQr({
                          medio: "mercadopago", contenido: cobroMP.qrData!, total: money(cobroMP.monto), venceA: cobroMP.expiresAt ?? null,
                        }).catch((e) => setMpError(mensaje(e)))}>Imprimir QR</Boton>
                      )}
                      <Boton variante="secundario" onPress={cancelarQrMP}>Cancelar QR</Boton>
                    </View>
                  )}
              </View>
            ) : (
              <Boton grande onPress={mostrarQrMP}>Generar QR por {money(aCobrar)}</Boton>
            )
          ) : (
            <Boton grande variante="ok" cargando={cobrando} onPress={() => cobrar()}
              desactivado={(paymentMethod === "account" && !customerId) || faltaPlata || !lines.length}>
              Confirmar cobro {money(aCobrar)}
            </Boton>
          )}
        </ScrollView>
      )}
    </View>
  );

  return (
    <View style={s.pantalla}>
      {(error || notice || lastTicket) && (
        <View style={{ padding: 8, gap: 6 }}>
          {error ? <Pressable onPress={() => setError("")}><Aviso tipo="error">{error}</Aviso></Pressable> : null}
          {notice ? <Aviso tipo="ok">{notice}</Aviso> : null}
          {lastTicket && (
            <View style={[s.tarjeta, s.entre, { padding: 10 }]}>
              <Text style={[s.texto, { flex: 1 }]}>
                Ticket #{lastTicket.ticketNumber} · {money(lastTicket.total)}
                {lastTicket.vuelto ? `  ·  Vuelto ${money(lastTicket.vuelto)}` : ""}
              </Text>
              {hayTicketera && <Boton variante="secundario" onPress={() => imprimir(lastTicket.id)}>Imprimir</Boton>}
              <Boton variante="secundario" onPress={() => setCompartir(lastTicket)}>Enviar</Boton>
            </View>
          )}
        </View>
      )}

      {dosPaneles ? (
        <View style={{ flex: 1, flexDirection: "row" }}>{catalogo}{ticket}</View>
      ) : verTicket ? ticket : (
        <>
          {catalogo}
          {lines.length > 0 && (
            <Pressable onPress={() => setVerTicket(true)}
              style={{ position: "absolute", left: 12, right: 12, bottom: 12, backgroundColor: color.primario, borderRadius: 12, padding: 16 }}>
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700", textAlign: "center" }}>
                Ver ticket · {unidades.toLocaleString("es-AR", { maximumFractionDigits: 3 })} · {money(total)}
              </Text>
            </Pressable>
          )}
        </>
      )}

      {/* Editar el renglón: cantidad, descuento o precio, como el numpad de la web */}
      <Hoja visible={linea !== null} titulo={linea?.name ?? ""} onCerrar={() => { setEditando(null); foco(); }}>
        {linea && editando !== null && (
          <EditorLinea
            linea={linea}
            onCambiar={(l) => setLines((prev) => prev.map((x, i) => (i === editando ? l : x)))}
            onBorrar={() => { setLines((prev) => prev.filter((_, i) => i !== editando)); setEditando(null); }}
          />
        )}
      </Hoja>

      <Hoja visible={showCustomers} titulo="Cliente de la venta" onCerrar={() => setShowCustomers(false)}>
        <TextInput style={s.input} placeholder="Buscar o crear cliente…" value={buscaCliente} onChangeText={setBuscaCliente} />
        <Boton variante="secundario" onPress={() => { setCustomerId(null); setShowCustomers(false); }}>Consumidor final</Boton>
        {customers
          .filter((c) => !buscaCliente || c.name.toLowerCase().includes(buscaCliente.toLowerCase()))
          .slice(0, 50)
          .map((c) => (
            <Pressable key={c.id} onPress={() => { setCustomerId(Number(c.id)); setShowCustomers(false); setBuscaCliente(""); }}
              style={[s.tarjeta, s.entre, { padding: 12 }]}>
              <Text style={s.texto}>{c.name}</Text>
              {Number(c.balance) > 0 && <Text style={s.apagado}>debe {money(c.balance)}</Text>}
            </Pressable>
          ))}
        {buscaCliente.trim().length > 1 && (
          <Boton onPress={crearCliente}>Crear «{buscaCliente.trim()}»</Boton>
        )}
      </Hoja>

      {/* QR del comercio: el socio lo escanea con su teléfono */}
      <Hoja visible={!!cobro} titulo="Que el cliente escanee con ClubPay" onCerrar={() => cerrarQrCobro()}>
        {cobro && (
          <View style={{ alignItems: "center", gap: 10 }}>
            {cobroEstado?.status === "applied" ? (
              <Aviso tipo="ok">
                Listo: {cobroEstado.member?.name} (socio {cobroEstado.member?.member_number}) · −{money(cobroEstado.descuento ?? 0)}
              </Aviso>
            ) : cobroEstado && ["rejected", "expired", "cancelled"].includes(cobroEstado.status) ? (
              <Aviso tipo="error">{cobroEstado.error ?? "Al socio no le corresponde beneficio en esta compra."}</Aviso>
            ) : (
              <>
                <Image source={{ uri: cobro.qr_data_url }} style={{ width: 260, height: 260 }} />
                <Text style={s.titulo}>{money(total)}</Text>
                <Text style={s.apagado}>Esperando que el socio confirme en su teléfono…</Text>
                <Boton variante="secundario" onPress={() => imprimirQr({
                  medio: "clubpay", contenido: cobro.qr_payload, total: money(total), venceA: cobro.expires_at,
                }).catch((e) => setClubpayError(mensaje(e)))}>Imprimir QR</Boton>
              </>
            )}
            {clubpayError ? <Aviso tipo="error">{clubpayError}</Aviso> : null}
          </View>
        )}
      </Hoja>
      <CompartirTicket saleId={compartir?.id ?? null} ticketNumber={compartir?.ticketNumber} onCerrar={() => setCompartir(null)} />
    </View>
  );
}

function EditorLinea({ linea, onCambiar, onBorrar }: {
  linea: SaleLine; onCambiar: (l: SaleLine) => void; onBorrar: () => void;
}) {
  const [cantidad, setCantidad] = useState(String(linea.quantity).replace(".", ","));
  const [pct, setPct] = useState("");
  const [precio, setPrecio] = useState(String(linea.unitPrice).replace(".", ","));

  return (
    <View style={{ gap: 12 }}>
      <Text style={s.apagado}>Precio de lista {money(linea.basePrice)}{linea.porPeso ? " (pesado)" : ""}</Text>
      <Text style={s.subtitulo}>Cantidad</Text>
      <View style={s.fila}>
        <Boton variante="secundario" onPress={() => {
          const n = Math.max(0, linea.quantity - 1);
          setCantidad(String(n)); onCambiar({ ...linea, quantity: n });
        }}>−</Boton>
        <TextInput style={[s.input, { flex: 1, textAlign: "center", fontSize: 20 }]} keyboardType="decimal-pad" value={cantidad}
          onChangeText={(t) => { setCantidad(t); const n = leerNumero(t); if (n !== null) onCambiar({ ...linea, quantity: Math.max(0, n) }); }} />
        <Boton variante="secundario" onPress={() => {
          const n = linea.quantity + 1;
          setCantidad(String(n)); onCambiar({ ...linea, quantity: n });
        }}>+</Boton>
      </View>
      <Text style={s.subtitulo}>Descuento %</Text>
      <TextInput style={s.input} keyboardType="decimal-pad" placeholder="ej. 10" value={pct}
        onChangeText={(t) => {
          setPct(t);
          const n = leerNumero(t);
          if (n === null) return;
          const unitPrice = Math.max(0, linea.basePrice * (1 - n / 100));
          setPrecio(unitPrice.toFixed(2).replace(".", ","));
          onCambiar({ ...linea, unitPrice });
        }} />
      <Text style={s.subtitulo}>Precio unitario</Text>
      <TextInput style={s.input} keyboardType="decimal-pad" value={precio}
        onChangeText={(t) => { setPrecio(t); setPct(""); const n = leerNumero(t); if (n !== null) onCambiar({ ...linea, unitPrice: Math.max(0, n) }); }} />
      <Fila etiqueta="Importe" valor={money(linea.quantity * linea.unitPrice)} fuerte />
      <Boton variante="peligro" onPress={onBorrar}>Quitar del ticket</Boton>
    </View>
  );
}
