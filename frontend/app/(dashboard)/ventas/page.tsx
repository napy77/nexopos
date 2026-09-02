"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, money } from "@/lib/api";
import { loadPrintSettings, printTicket, openTicketPdf } from "@/lib/print";
import { leerCodigoBalanza, buscarPorPlu, BALANZA_DEFAULT, type BalanzaConfig } from "@/lib/balanza";
import { Foto } from "@/lib/foto";
import { centavosAPesos, type ClubPayValidacion, type ClubPayOferta, type ClubPayElegido, type ClubPayCobro, type ClubPayCobroEstado } from "@/lib/clubpay";

interface StockItem {
  product_id: number; name: string; ean: string; category: string | null;
  pasillo_nombre: string | null; rubro_nombre: string | null; subrubro_nombre: string | null;
  image_url: string | null; quantity: string; sale_price: string | null;
  origen: string; plu: string | null; venta_por_peso: boolean;
}
interface Customer { id: number; name: string; balance: string }
interface SaleLine {
  productId: number; name: string; quantity: number;
  unitPrice: number; basePrice: number; available: number;
  porPeso?: boolean;
}
interface Sale {
  id: number; ticket_number: number; payment_method: string; total: string;
  created_at: string; customer_name: string | null; refund_of: number | null; refunded_by: number | null;
}

const CATEGORY_EMOJI: Record<string, string> = {
  "Almacén": "🛒", "Bebidas": "🥤", "Limpieza": "🧼",
  "Perfumería": "🧴", "Lácteos": "🥛", "Golosinas": "🍬",
};
const PAYMENT_METHODS = [
  { id: "cash", label: "Efectivo", icon: "💵" },
  { id: "wallet", label: "Billetera", icon: "📱" },
  { id: "card", label: "Tarjeta", icon: "💳" },
  { id: "transfer", label: "Transferencia", icon: "🏦" },
  { id: "account", label: "Cuenta corriente", icon: "📒" },
] as const;
const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo", wallet: "Billetera", card: "Tarjeta",
  transfer: "Transfe", account: "Cta. cte.",
};

type NumpadMode = "qty" | "pct" | "price";
type View = "order" | "payment";

export default function VentasPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [pasillo, setPasillo] = useState("");
  const [rubro, setRubro] = useState("");
  const [subrubro, setSubrubro] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [numpadMode, setNumpadMode] = useState<NumpadMode>("qty");
  const [buffer, setBuffer] = useState("");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [view, setView] = useState<View>("order");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastTicket, setLastTicket] = useState<{ id: number; ticketNumber: number; total: number; vuelto?: number | null } | null>(null);
  const [showCustomers, setShowCustomers] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [refundList, setRefundList] = useState<Sale[] | null>(null);
  const [balanza, setBalanza] = useState<BalanzaConfig>(BALANZA_DEFAULT);
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [pagaCon, setPagaCon] = useState("");
  const [vueltoPendiente, setVueltoPendiente] = useState<number | null>(null);
  // ClubPay: el QR vence a los 60 segundos, así que ni el token ni la
  // validación se guardan más allá de la venta que se está cobrando.
  const [clubpayDisponible, setClubpayDisponible] = useState(false);
  const [qrSocio, setQrSocio] = useState("");
  const [validando, setValidando] = useState(false);
  const [socio, setSocio] = useState<ClubPayValidacion | null>(null);
  const [clubpayElegido, setClubpayElegido] = useState<ClubPayElegido | null>(null);
  const [clubpayError, setClubpayError] = useState("");
  const qrRef = useRef<HTMLInputElement>(null);
  // Cobro con QR mostrado por el comercio: el socio lo escanea con su teléfono
  const [cobro, setCobro] = useState<ClubPayCobro | null>(null);
  const [cobroEstado, setCobroEstado] = useState<ClubPayCobroEstado | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pagaConRef = useRef<HTMLInputElement>(null);

  const loadStock = useCallback(() => {
    api<StockItem[]>("/api/stock").then(setItems).catch(console.error);
  }, []);
  const loadCustomers = useCallback(() => {
    api<Customer[]>("/api/customers").then(setCustomers).catch(console.error);
  }, []);

  useEffect(() => {
    loadStock();
    loadCustomers();
    api<{ balanza: BalanzaConfig }>("/api/settings/balanza")
      .then((d) => setBalanza(d.balanza))
      .catch(console.error);
    api<{ abierta: boolean }>("/api/caja")
      .then((d) => setCajaAbierta(d.abierta))
      .catch(console.error);
    api<{ configurado: boolean }>("/api/clubpay/estado")
      .then((d) => setClubpayDisponible(d.configurado))
      .catch(() => setClubpayDisponible(false));
    searchRef.current?.focus();
  }, [loadStock, loadCustomers]);

  /*
   * Mientras el QR está en pantalla se consulta el estado cada 2 segundos,
   * hasta que el socio confirma en su teléfono o el cobro vence. Cuando queda
   * aplicado, ClubPay ya registró la transacción: el descuento sale de ahí.
   */
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
                aplica_hoy: true, motivo: "",
              },
              descuento: est.descuento ?? 0,
            });
          }
          // El cobro queda cerrado, pero sin cancelarlo: ya está aplicado
          setTimeout(() => { setCobro(null); setChargeId(null); }, 1800);
        }
        if (est.status === "expired" || est.status === "rejected" || est.status === "cancelled") {
          clearInterval(timer);
        }
      } catch (err) {
        if (!vivo) return;
        clearInterval(timer);
        setClubpayError(err instanceof Error ? err.message : "Se perdió la conexión con ClubPay");
      }
    }, 2000);
    return () => { vivo = false; clearInterval(timer); };
  }, [chargeId]);

  // La grilla muestra lo que tiene stock, pero el lector busca en todo el
  // stock local: si el cajero tiene el producto en la mano, existe, aunque el
  // sistema lo tenga en cero.
  const sellable = useMemo(() => items.filter((i) => Number(i.quantity) > 0), [items]);

  // Taxonomía NexoB2B en cascada, derivada del stock del comercio.
  // Los productos sin taxonomía (cargas viejas) quedan bajo "Otros".
  const pasillos = useMemo(
    () => [...new Set(sellable.map((i) => i.pasillo_nombre ?? "Otros"))].sort(),
    [sellable]
  );
  const enPasillo = useMemo(
    () => (pasillo ? sellable.filter((i) => (i.pasillo_nombre ?? "Otros") === pasillo) : sellable),
    [sellable, pasillo]
  );
  const rubros = useMemo(
    () => (pasillo ? [...new Set(enPasillo.map((i) => i.rubro_nombre).filter((r): r is string => !!r))].sort() : []),
    [enPasillo, pasillo]
  );
  const enRubro = useMemo(
    () => (rubro ? enPasillo.filter((i) => i.rubro_nombre === rubro) : enPasillo),
    [enPasillo, rubro]
  );
  const subrubros = useMemo(
    () => (rubro ? [...new Set(enRubro.map((i) => i.subrubro_nombre).filter((s): s is string => !!s))].sort() : []),
    [enRubro, rubro]
  );

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return enRubro.filter((i) => {
      if (subrubro && i.subrubro_nombre !== subrubro) return false;
      if (!term) return true;
      // ean puede ser null: los productos propios no siempre tienen código
      return i.name.toLowerCase().includes(term) || (i.ean ?? "").includes(term) || (i.plu ?? "") === term;
    });
  }, [enRubro, subrubro, q]);

  function selectPasillo(p: string) {
    setPasillo(pasillo === p ? "" : p);
    setRubro("");
    setSubrubro("");
  }
  function selectRubro(r: string) {
    setRubro(rubro === r ? "" : r);
    setSubrubro("");
  }

  const customer = customers.find((c) => c.id === customerId);
  const total = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);

  /*
   * El beneficio de ClubPay no achica la venta: el total sigue siendo el
   * mismo y el descuento entra como forma de pago (cupón). Lo que cambia es
   * cuánto hay que cobrar por caja.
   */
  const descuentoClub = clubpayElegido?.descuento ?? 0;
  const aCobrar = Math.round((total - descuentoClub) * 100) / 100;

  // ── Vuelto (solo en efectivo) ──────────────────────────────────────────────
  const montoPagado = pagaCon === "" ? null : Number(pagaCon.replace(",", "."));
  const vuelto = montoPagado !== null && !isNaN(montoPagado) ? montoPagado - aCobrar : null;
  const faltaPlata = vuelto !== null && vuelto < 0;

  /**
   * Importes con los que suele pagar el cliente: el monto justo y los billetes
   * o redondeos inmediatamente superiores al total.
   */
  const sugerencias = useMemo(() => {
    const billetes = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const mayores = billetes.filter((b) => b > aCobrar).slice(0, 3);
    // Redondeo "de bolsillo" al siguiente mil, si no quedó ya en la lista
    const alMil = Math.ceil(aCobrar / 1000) * 1000;
    if (alMil > aCobrar && !mayores.includes(alMil)) mayores.unshift(alMil);
    return [...new Set(mayores)].sort((a, b) => a - b).slice(0, 4);
  }, [aCobrar]);

  // ── ClubPay ────────────────────────────────────────────────────────────────

  /**
   * Valida el QR del socio contra ClubPay. Se manda el total del ticket para
   * que la respuesta ya traiga el importe exacto de cada beneficio, con los
   * topes del acuerdo aplicados. El importe no se calcula acá: lo resuelve
   * ClubPay, que es quien conoce las condiciones.
   */
  async function validarSocio() {
    const token = qrSocio.trim();
    if (!token) return;
    setClubpayError("");
    setValidando(true);
    try {
      const val = await api<ClubPayValidacion>("/api/clubpay/validar", {
        method: "POST",
        body: JSON.stringify({ qrToken: token, total }),
      });
      setSocio(val);
      // El token no se guarda: vence a los 60 segundos y no se reutiliza
      setQrSocio("");
      // Si hay un único beneficio que aplica, se elige solo
      const aplicables = val.offers.filter((o) => o.aplica_hoy);
      if (aplicables.length === 1) elegirOferta(val, aplicables[0]);
    } catch (err) {
      // El mensaje viene escrito por ClubPay para leérselo al cliente
      setClubpayError(err instanceof Error ? err.message : "No se pudo validar el socio");
      setSocio(null);
      setClubpayElegido(null);
    } finally {
      setValidando(false);
    }
  }

  /**
   * Muestra en pantalla un QR con el comercio y el importe para que el socio
   * lo escanee con su teléfono. Es el camino que sirve en la mayoría de los
   * mostradores: el lector del comercio lee código de barras, no QR, y la PC
   * no suele tener cámara — pero el socio siempre tiene la suya.
   */
  async function mostrarQrCobro() {
    setClubpayError("");
    try {
      const c = await api<ClubPayCobro>("/api/clubpay/cobro", {
        method: "POST",
        body: JSON.stringify({ total }),
      });
      setCobro(c);
      setChargeId(c.charge_id);
      setCobroEstado(null);
    } catch (err) {
      setClubpayError(err instanceof Error ? err.message : "No se pudo generar el QR");
    }
  }

  async function cerrarQrCobro(cancelar = true) {
    const id = chargeId;
    setCobro(null);
    setChargeId(null);
    setCobroEstado(null);
    if (cancelar && id) {
      api(`/api/clubpay/cobro/${id}/cancelar`, { method: "POST" }).catch(() => {});
    }
  }

  function elegirOferta(val: ClubPayValidacion, oferta: ClubPayOferta) {
    setClubpayElegido({
      socio: val.member,
      oferta,
      // El importe lo calculó ClubPay para este ticket
      descuento: oferta.discount_cents !== undefined ? centavosAPesos(oferta.discount_cents) : 0,
    });
  }

  function quitarClubpay() {
    setSocio(null);
    setClubpayElegido(null);
    setClubpayError("");
    setQrSocio("");
    cerrarQrCobro();
  }

  // ── Armado del ticket ──────────────────────────────────────────────────────

  /**
   * @param cantidad  la que trae la etiqueta de balanza (kg); si no, suma 1
   * @param importe   total ya calculado por la balanza, si la etiqueta lo trae
   */
  function addLine(item: StockItem, cantidad?: number, importe?: number) {
    if (!item.sale_price && importe === undefined) {
      setError(`"${item.name}" no tiene precio de venta. Definilo en Stock.`);
      return;
    }
    setError("");
    setBuffer("");
    // Arrancó la venta siguiente: el vuelto anterior ya no corresponde
    setVueltoPendiente(null);

    // Etiqueta de balanza: la línea entra con el peso (o el importe) pesado,
    // no se acumula de a uno como un producto por unidad.
    if (cantidad !== undefined || importe !== undefined) {
      const precio = importe !== undefined ? importe : Number(item.sale_price);
      const qty = importe !== undefined ? 1 : cantidad!;
      setLines((prev) => [
        ...prev,
        {
          productId: item.product_id, name: item.name, quantity: qty,
          unitPrice: precio, basePrice: precio,
          available: Number(item.quantity), porPeso: item.venta_por_peso,
        },
      ]);
      setSelectedId(item.product_id);
      return;
    }

    setLines((prev) => {
      const existing = prev.find((l) => l.productId === item.product_id);
      if (existing) {
        setSelectedId(existing.productId);
        // Sumar sin tope: si el stock del sistema quedó corto, igual se vende
        // (queda en negativo y se ajusta después)
        return prev.map((l) =>
          l.productId === item.product_id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      setSelectedId(item.product_id);
      const price = Number(item.sale_price);
      return [...prev, {
        productId: item.product_id, name: item.name, quantity: 1,
        unitPrice: price, basePrice: price, available: Number(item.quantity),
      }];
    });
  }

  function onSearchEnter() {
    const term = q.trim();
    if (!term) return;

    // 1. ¿Es una etiqueta de balanza? Trae el producto y el peso adentro
    const lectura = leerCodigoBalanza(term, balanza);
    if (lectura) {
      const item = buscarPorPlu(items, lectura.plu);
      if (!item) {
        setError(
          `Etiqueta de balanza con código ${lectura.plu}, pero ningún producto tuyo lo tiene asignado. ` +
          `Cargalo en Stock → Crear producto propio.`
        );
        setQ("");
        searchRef.current?.focus();
        return;
      }
      addLine(item, lectura.peso, lectura.importe);
      setQ("");
      searchRef.current?.focus();
      return;
    }

    // 2. EAN común (buscado en todo el stock, con o sin existencias), o el
    //    único resultado que quedó a la vista
    const exact = items.find((i) => i.ean === term);
    const target = exact ?? (visible.length === 1 ? visible[0] : null);
    if (target) {
      addLine(target);
      setQ("");
    } else if (/^\d{8,14}$/.test(term)) {
      setError(`El código ${term} no está en tu stock. Cargalo desde Productos → Agregar producto.`);
    }
    searchRef.current?.focus();
  }

  // ── Numpad (opera sobre la línea seleccionada) ─────────────────────────────

  function applyBuffer(next: string) {
    setBuffer(next);
    if (selectedId === null) return;
    const value = parseFloat(next.replace(",", "."));
    setLines((prev) => prev.map((l) => {
      if (l.productId !== selectedId) return l;
      if (next === "" || isNaN(value)) return l;
      if (numpadMode === "qty") return { ...l, quantity: Math.max(0, value) };
      if (numpadMode === "pct") return { ...l, unitPrice: Math.max(0, l.basePrice * (1 - value / 100)) };
      return { ...l, unitPrice: Math.max(0, value) };
    }));
  }

  function numpadPress(key: string) {
    if (selectedId === null && key !== "back") return;
    setError("");
    if (key === "back") {
      if (buffer.length > 0) applyBuffer(buffer.slice(0, -1));
      else if (selectedId !== null) {
        // sin buffer: borrar la línea seleccionada
        setLines((prev) => prev.filter((l) => l.productId !== selectedId));
        setSelectedId(null);
      }
      return;
    }
    if (key === ",") {
      if (!buffer.includes(",")) applyBuffer(buffer === "" ? "0," : buffer + ",");
      return;
    }
    applyBuffer(buffer + key);
  }

  function selectLine(id: number) {
    setSelectedId(id);
    setBuffer("");
  }

  function changeMode(mode: NumpadMode) {
    setNumpadMode(mode);
    setBuffer("");
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  function anularVenta() {
    setLines([]);
    setVueltoPendiente(null);
    // La venta no se registró en ClubPay: se descarta el socio sin avisarles
    quitarClubpay();
    setSelectedId(null);
    setBuffer("");
    setCustomerId("");
    setShowActions(false);
    setNotice("Venta anulada.");
    setTimeout(() => setNotice(""), 2500);
    searchRef.current?.focus();
  }

  async function abrirReembolsos() {
    setShowActions(false);
    const sales = await api<Sale[]>("/api/sales");
    setRefundList(sales.filter((s) => !s.refund_of && !s.refunded_by && Number(s.total) > 0).slice(0, 15));
  }

  async function reembolsar(sale: Sale) {
    setError("");
    try {
      const r = await api<{ id: number; ticketNumber: number; total: number }>(`/api/sales/${sale.id}/refund`, { method: "POST" });
      setRefundList(null);
      setLastTicket(r);
      setNotice(`Reembolso del ticket #${sale.ticket_number} emitido (ticket #${r.ticketNumber}).`);
      loadStock();
      loadCustomers();
      setTimeout(() => setNotice(""), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al reembolsar");
    }
  }

  // ── Pago ───────────────────────────────────────────────────────────────────

  async function cobrar() {
    setError("");
    try {
      const sale = await api<{
        id: number; ticketNumber: number; total: number; vuelto: number | null;
        clubpay?: { descuento: number; aCobrar: number; recorteTexto: string | null; puntos: number } | null;
      }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: lines.filter((l) => l.quantity > 0).map((l) => ({
            productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice,
          })),
          paymentMethod,
          customerId: customerId || undefined,
          discount: 0,
          paidAmount: paymentMethod === "cash" && montoPagado ? montoPagado : undefined,
          // Solo el socio y el beneficio: el importe lo resuelve ClubPay al
          // registrar la transacción, que es la llamada que manda.
          clubpay: clubpayElegido && {
            // Si vino de un QR del comercio, alcanza con el id del cobro: el
            // backend le vuelve a preguntar el importe a ClubPay.
            ...(cobroEstado?.status === "applied"
              ? { chargeId: cobroEstado.charge_id }
              : {
                  membershipId: clubpayElegido.socio.membership_id,
                  offerId: clubpayElegido.oferta.id,
                }),
            memberName: clubpayElegido.socio.name,
            clubName: clubpayElegido.socio.club_name,
          },
        }),
      });
      setLastTicket({ ...sale, total });
      setVueltoPendiente(sale.vuelto ?? null);
      setLines([]);
      setSelectedId(null);
      setBuffer("");
      setCustomerId("");
      setPaymentMethod("cash");
      setPagaCon("");
      quitarClubpay();
      setView("order");
      if (sale.clubpay) {
        const extra = sale.clubpay.recorteTexto ? ` · ${sale.clubpay.recorteTexto}` : "";
        setNotice(`Beneficio ClubPay aplicado: ${money(sale.clubpay.descuento)}${extra}`);
        setTimeout(() => setNotice(""), 8000);
      }
      loadStock();
      loadCustomers();
      searchRef.current?.focus();
      // La impresión va después de limpiar la pantalla: la caja queda lista
      // para la próxima venta aunque la impresora tarde o falle.
      if (loadPrintSettings().autoPrint) imprimir(sale.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cobrar");
      // Puede haberse cerrado la caja desde otra pantalla: revalidar
      api<{ abierta: boolean }>("/api/caja")
        .then((d) => setCajaAbierta(d.abierta))
        .catch(() => {});
    }
  }

  /** Manda el ticket a la impresora; si falla, no rompe la venta ya cobrada. */
  async function imprimir(saleId: number) {
    try {
      await printTicket(saleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo imprimir el ticket");
    }
  }

  async function quickCreateCustomer() {
    if (!newCustomerName.trim()) return;
    const c = await api<Customer>("/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: newCustomerName.trim() }),
    });
    setNewCustomerName("");
    await loadCustomers();
    setCustomerId(Number(c.id));
    setShowCustomers(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Sin caja abierta no se vende: el POS queda bloqueado hasta abrirla
  if (cajaAbierta === false) {
    return (
      <div className="caja-cerrada-wrap">
        <div className="card caja-cerrada">
          <div style={{ fontSize: 56 }}>🔒</div>
          <h1 style={{ margin: "8px 0" }}>La caja está cerrada</h1>
          <p className="muted">
            Para vender hay que abrir la caja del turno y anotar con cuánto efectivo
            arrancás. Así, al cerrar, el sistema puede decirte cuánto tendría que haber
            en el cajón.
          </p>
          <Link href="/caja">
            <button style={{ padding: "14px 28px", fontSize: 16, marginTop: 12 }}>
              Abrir la caja
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-shell">
      {/* ══ Panel izquierdo: ticket ══ */}
      <div className="ticket-panel">
        <div className="ticket-top">
          <button
            className={`customer-btn ${customerId ? "has-customer" : ""}`}
            onClick={() => { setShowCustomers(!showCustomers); setShowActions(false); }}
          >
            👤 {customer ? customer.name : "Consumidor Final"}
          </button>
          <button className="secondary" onClick={() => { setShowActions(!showActions); setShowCustomers(false); }}>
            Acciones ▾
          </button>
        </div>

        {showActions && (
          <div className="actions-menu">
            <button onClick={anularVenta} disabled={lines.length === 0}>🗑 Anular venta</button>
            <button onClick={abrirReembolsos}>↩️ Reembolso</button>
          </div>
        )}

        {showCustomers && (
          <div className="actions-menu">
            <button onClick={() => { setCustomerId(""); setShowCustomers(false); }}>
              Consumidor Final
            </button>
            {customers.map((c) => (
              <button key={c.id} onClick={() => { setCustomerId(Number(c.id)); setShowCustomers(false); }}>
                {c.name}{Number(c.balance) > 0 && <span className="muted"> · debe {money(c.balance)}</span>}
              </button>
            ))}
            <div className="toolbar" style={{ padding: "6px 10px" }}>
              <input
                placeholder="Nuevo cliente…"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") quickCreateCustomer(); }}
                style={{ flex: 1 }}
              />
              <button className="small" onClick={quickCreateCustomer}>Crear</button>
            </div>
          </div>
        )}

        <div className="ticket-lines">
          {lines.map((l) => (
            <div
              key={l.productId}
              className={`ticket-line ${selectedId === l.productId ? "selected" : ""}`}
              onClick={() => selectLine(l.productId)}
            >
              <div className="tl-main">
                <span className="tl-name">{l.name}</span>
                <span className="tl-subtotal">{money(l.quantity * l.unitPrice)}</span>
              </div>
              <div className="tl-detail muted">
                <b>{l.quantity.toLocaleString("es-AR", { maximumFractionDigits: 3 })}{l.porPeso ? " kg" : ""}</b>
                {" x "}{money(l.unitPrice)}{l.porPeso ? "/kg" : ""}
                {l.unitPrice !== l.basePrice && <span className="badge warn" style={{ marginLeft: 6 }}>precio modificado</span>}
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>Escaneá un código o tocá un producto para empezar.</p>
          )}
        </div>

        <div className="ticket-total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>

        {error && <p className="error" style={{ margin: "4px 12px" }}>{error}</p>}
        {notice && <p className="badge ok" style={{ margin: "4px 12px" }}>{notice}</p>}
        {/*
          El vuelto queda a la vista mientras el cajero cuenta el cambio, pero
          se borra apenas arranca la venta siguiente: un vuelto viejo en
          pantalla se puede entregar dos veces.
        */}
        {vueltoPendiente != null && vueltoPendiente > 0 && (
          <div className="vuelto-aviso" style={{ margin: "4px 12px" }}>
            <span>Vuelto a entregar</span>
            <strong>{money(vueltoPendiente)}</strong>
            <button
              className="vuelto-listo"
              title="Ya entregué el vuelto"
              onClick={() => setVueltoPendiente(null)}
            >
              ✕
            </button>
          </div>
        )}
        {lastTicket && !notice && (
          <div style={{ margin: "4px 12px" }}>
            <span className="badge ok">
              Ticket #{lastTicket.ticketNumber} emitido —{" "}
              <a style={{ cursor: "pointer" }} onClick={() => imprimir(lastTicket.id)}>🖨 imprimir</a>
              {" · "}
              <a style={{ cursor: "pointer" }} onClick={() => openTicketPdf(lastTicket.id)}>PDF</a>
            </span>
          </div>
        )}

        <div className="numpad">
          {["1","2","3","qty","4","5","6","pct","7","8","9","price","+/-","0",",","back"].map((k) => {
            if (k === "qty" || k === "pct" || k === "price") {
              const labels = { qty: "Cant.", pct: "% Desc.", price: "Precio" } as const;
              return (
                <button
                  key={k}
                  className={`np-mode ${numpadMode === k ? "np-active" : ""}`}
                  onClick={() => changeMode(k as NumpadMode)}
                >
                  {labels[k as NumpadMode]}
                </button>
              );
            }
            if (k === "back") return <button key={k} className="np-back" onClick={() => numpadPress("back")}>⌫</button>;
            if (k === "+/-") {
              return (
                <button key={k} className="np-key" onClick={() => {
                  if (selectedId !== null) setLines((prev) => prev.filter((l) => l.productId !== selectedId));
                  setSelectedId(null);
                }}>
                  Quitar
                </button>
              );
            }
            return <button key={k} className="np-key" onClick={() => numpadPress(k)}>{k}</button>;
          })}
        </div>

        <button
          className="pay-btn"
          disabled={lines.length === 0 || total <= 0}
          onClick={() => {
            setView("payment");
            setShowActions(false);
            setShowCustomers(false);
            setPagaCon("");
            // El cajero suele arrancar tipeando con cuánto le pagan
            setTimeout(() => pagaConRef.current?.focus(), 50);
          }}
        >
          Pago · {money(total)}
        </button>
      </div>

      {/* ══ Panel derecho: productos o pago ══ */}
      {view === "order" ? (
        <div className="products-panel">
          <input
            ref={searchRef}
            type="search"
            className="pos-search"
            placeholder="🔍 Escaneá el código de barras o buscá por nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter(); }}
          />
          {/* Taxonomía NexoB2B: pasillo → rubro → subrubro */}
          <div className="cat-chips">
            <button className={`chip ${pasillo === "" ? "chip-active" : ""}`} onClick={() => selectPasillo("")}>
              Todos
            </button>
            {pasillos.map((p) => (
              <button key={p} className={`chip ${pasillo === p ? "chip-active" : ""}`} onClick={() => selectPasillo(p)}>
                {CATEGORY_EMOJI[p] ?? "🏷"} {p}
              </button>
            ))}
          </div>
          {rubros.length > 0 && (
            <div className="cat-chips cat-chips-sub">
              {rubros.map((r) => (
                <button key={r} className={`chip chip-sm ${rubro === r ? "chip-active" : ""}`} onClick={() => selectRubro(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {subrubros.length > 0 && (
            <div className="cat-chips cat-chips-sub">
              {subrubros.map((s) => (
                <button
                  key={s}
                  className={`chip chip-sm chip-outline ${subrubro === s ? "chip-active" : ""}`}
                  onClick={() => setSubrubro(subrubro === s ? "" : s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {sellable.length === 0 ? (
            <div className="empty-state" style={{ margin: 12 }}>
              <p><strong>Todavía no tenés productos en stock para vender.</strong></p>
              <ol className="muted">
                <li><Link href="/catalogo">Catálogo B2B</Link> → comprale a un mayorista y recibí la mercadería en <Link href="/compras">Compras</Link>.</li>
                <li><Link href="/productos">Stock</Link> → «Agregar producto del catálogo» para mercadería que ya tenés.</li>
                <li>Asignale precio de venta en <Link href="/productos">Stock</Link>.</li>
              </ol>
            </div>
          ) : (
            <div className="pos-cards">
              {visible.map((item) => {
                const inTicket = lines.find((l) => l.productId === item.product_id);
                return (
                  <button key={item.product_id} className="pos-card" onClick={() => addLine(item)}>
                    {inTicket && <span className="pos-card-qty">{inTicket.quantity}</span>}
                    <div className="pos-card-img">
                      <Foto
                        src={item.image_url}
                        fallback={CATEGORY_EMOJI[item.category ?? ""] ?? "📦"}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        fallbackStyle={{ fontSize: 40 }}
                      />
                    </div>
                    <div className="pos-card-name">{item.name}</div>
                    <div className="pos-card-footer">
                      <span className="pos-card-price">
                        {item.sale_price ? money(item.sale_price) : "sin precio"}
                        {item.venta_por_peso && <span style={{ fontSize: 11 }}>/kg</span>}
                      </span>
                      <span className="pos-card-stock">
                        {Number(item.quantity).toLocaleString("es-AR", { maximumFractionDigits: 3 })}
                        {item.venta_por_peso ? " kg" : ""}
                      </span>
                    </div>
                  </button>
                );
              })}
              {visible.length === 0 && <p className="muted" style={{ padding: 12 }}>Sin resultados para «{q}».</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="products-panel pay-screen">
          <div className="pay-header">
            <button className="secondary" onClick={() => setView("order")}>← Volver</button>
            <h1 style={{ margin: 0 }}>Cobrar {money(aCobrar)}</h1>
            {descuentoClub > 0 && (
              <span className="muted">
                Venta {money(total)} − beneficio {money(descuentoClub)}
              </span>
            )}
          </div>
          <p className="muted">
            Cliente: <strong>{customer ? customer.name : "Consumidor Final"}</strong>
            {customer && Number(customer.balance) > 0 && ` (debe ${money(customer.balance)})`}
          </p>

          {/* ── Socio ClubPay ── */}
          {clubpayDisponible && (
            <div className="clubpay-box">
              {!socio && !clubpayElegido ? (
                <>
                  <div className="toolbar" style={{ marginBottom: 6 }}>
                    <label style={{ fontWeight: 600 }}>🎫 Socio ClubPay</label>
                    <button onClick={mostrarQrCobro}>Mostrar QR al cliente</button>
                    <span className="muted">El socio lo escanea con su teléfono</span>
                  </div>
                  {/* Alternativa para el comercio que sí tiene lector 2D o cámara */}
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                      ¿Tenés lector de QR? Escaneá el del socio
                    </summary>
                    <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
                      <input
                        ref={qrRef}
                        value={qrSocio}
                        onChange={(e) => setQrSocio(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") validarSocio(); }}
                        placeholder="QR del socio…"
                        style={{ flex: 1, minWidth: 220 }}
                        disabled={validando}
                      />
                      <button className="secondary" onClick={validarSocio} disabled={validando || !qrSocio.trim()}>
                        {validando ? "Validando…" : "Validar"}
                      </button>
                    </div>
                  </details>
                </>
              ) : socio ? (
                <>
                  <div className="toolbar" style={{ marginBottom: 6 }}>
                    <strong>{socio.member.name}</strong>
                    <span className="badge info">{socio.member.club_name}</span>
                    <span className="muted">
                      Socio {socio.member.member_number}
                      {socio.member.points > 0 && ` · ${socio.member.points} puntos`}
                    </span>
                    <button className="small secondary" onClick={quitarClubpay}>Quitar</button>
                  </div>

                  {socio.offers.length === 0 && (
                    <p className="muted" style={{ margin: 0 }}>
                      El socio está al día, pero hoy no tiene beneficios en este comercio.
                    </p>
                  )}

                  {socio.offers.map((o) => {
                    const elegida = clubpayElegido?.oferta.id === o.id;
                    return (
                      <div
                        key={o.id}
                        className={`oferta ${o.aplica_hoy ? "" : "no-aplica"} ${elegida ? "elegida" : ""}`}
                        onClick={() => o.aplica_hoy && elegirOferta(socio, o)}
                      >
                        <div className="oferta-top">
                          <strong>{o.description}</strong>
                          {o.aplica_hoy && o.discount_cents !== undefined && (
                            <span className="oferta-monto">−{money(centavosAPesos(o.discount_cents))}</span>
                          )}
                        </div>
                        {/* El motivo lo escribe ClubPay para leérselo al cliente */}
                        {!o.aplica_hoy && o.motivo && (
                          <div className="oferta-motivo">{o.motivo}</div>
                        )}
                        {o.condiciones.length > 0 && (
                          <div className="oferta-condiciones">
                            {o.condiciones.map((c, i) => <span key={i}>{c}</span>)}
                          </div>
                        )}
                        {elegida && <div className="oferta-elegida">✓ Aplicado a esta venta</div>}
                      </div>
                    );
                  })}
                </>
              ) : clubpayElegido ? (
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  <strong>{clubpayElegido.socio.name}</strong>
                  <span className="badge info">{clubpayElegido.socio.club_name}</span>
                  <span className="muted">{clubpayElegido.oferta.description}</span>
                  <span className="oferta-monto">−{money(clubpayElegido.descuento)}</span>
                  <button className="small secondary" onClick={quitarClubpay}>Quitar</button>
                </div>
              ) : null}
              {clubpayError && <p className="error" style={{ marginBottom: 0 }}>{clubpayError}</p>}
            </div>
          )}
          <div className="pay-methods">
            {PAYMENT_METHODS.map((m) => {
              const disabled = m.id === "account" && !customerId;
              return (
                <button
                  key={m.id}
                  className={`pay-method ${paymentMethod === m.id ? "pm-active" : ""}`}
                  disabled={disabled}
                  onClick={() => setPaymentMethod(m.id)}
                >
                  <span className="pm-icon">{m.icon}</span>
                  {m.label}
                  {disabled && <span className="muted" style={{ fontSize: 11 }}>elegí un cliente</span>}
                </button>
              );
            })}
          </div>
          {/* Vuelto: solo tiene sentido cobrando en efectivo */}
          {paymentMethod === "cash" && (
            <div className="vuelto-box">
              <div className="toolbar" style={{ alignItems: "center" }}>
                <label style={{ fontWeight: 600 }}>Paga con</label>
                <input
                  ref={pagaConRef}
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={pagaCon}
                  onChange={(e) => setPagaCon(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !faltaPlata) cobrar(); }}
                  placeholder="Importe que entrega"
                  style={{ width: 180, fontSize: 20, padding: "10px 12px" }}
                />
                {sugerencias.map((s) => (
                  <button key={s} className="chip" onClick={() => setPagaCon(String(s))}>
                    {money(s)}
                  </button>
                ))}
                <button className="chip" onClick={() => setPagaCon(String(total))}>Justo</button>
                {pagaCon !== "" && (
                  <button className="chip" onClick={() => { setPagaCon(""); pagaConRef.current?.focus(); }}>
                    Borrar
                  </button>
                )}
              </div>

              {vuelto !== null && (
                faltaPlata ? (
                  <div className="vuelto-monto falta">
                    <span>Falta</span>
                    <strong>{money(Math.abs(vuelto))}</strong>
                  </div>
                ) : (
                  <div className="vuelto-monto">
                    <span>Vuelto</span>
                    <strong>{money(vuelto)}</strong>
                  </div>
                )
              )}
            </div>
          )}

          {paymentMethod === "account" && !customerId && (
            <p className="error">La cuenta corriente requiere un cliente: volvé y seleccionalo con el botón 👤.</p>
          )}
          {error && <p className="error">{error}</p>}
          <button
            className="pay-btn"
            style={{ maxWidth: 420 }}
            disabled={(paymentMethod === "account" && !customerId) || faltaPlata}
            onClick={cobrar}
          >
            ✓ Validar y emitir ticket
          </button>
        </div>
      )}

      {/* ══ QR del comercio: el socio lo escanea con su teléfono ══ */}
      {cobro && (
        <div className="modal-backdrop" onClick={() => cerrarQrCobro()}>
          <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
            {cobroEstado?.status === "applied" ? (
              <div className="qr-ok">
                <div style={{ fontSize: 52 }}>✓</div>
                <h2 style={{ margin: "6px 0" }}>Beneficio aplicado</h2>
                <p style={{ margin: 0 }}>
                  <strong>{cobroEstado.member?.name}</strong>
                  {cobroEstado.member?.club_name && ` · ${cobroEstado.member.club_name}`}
                </p>
                <div className="qr-descuento">−{money(cobroEstado.descuento ?? 0)}</div>
                {cobroEstado.recorteTexto && <p className="muted">{cobroEstado.recorteTexto}</p>}
              </div>
            ) : cobroEstado?.status === "rejected" ? (
              <div className="qr-ok">
                <div style={{ fontSize: 44 }}>🙁</div>
                <h2 style={{ margin: "6px 0" }}>Sin descuento</h2>
                {/* El motivo lo escribe ClubPay para leérselo al cliente */}
                <p>{cobroEstado.error ?? "Al socio no le corresponde beneficio en esta compra."}</p>
                <button className="secondary" onClick={() => cerrarQrCobro(false)}>Cobrar sin descuento</button>
              </div>
            ) : cobroEstado?.status === "expired" ? (
              <div className="qr-ok">
                <div style={{ fontSize: 44 }}>⏱</div>
                <h2 style={{ margin: "6px 0" }}>El código venció</h2>
                <p className="muted">Nadie lo escaneó a tiempo.</p>
                <div className="toolbar" style={{ justifyContent: "center" }}>
                  <button onClick={mostrarQrCobro}>Generar otro</button>
                  <button className="secondary" onClick={() => cerrarQrCobro(false)}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <h2 style={{ textAlign: "center" }}>Que el cliente escanee con ClubPay</h2>
                <div className="qr-lienzo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cobro.qr_data_url} alt="Código QR para escanear con ClubPay" />
                </div>
                <div className="qr-monto">{money(total)}</div>
                <p className="muted" style={{ textAlign: "center", margin: "6px 0 0" }}>
                  Esperando que confirme en su teléfono…
                </p>
                <div className="toolbar" style={{ justifyContent: "center", marginTop: 12 }}>
                  <button className="secondary" onClick={() => cerrarQrCobro()}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ Modal de reembolsos ══ */}
      {refundList && (
        <div className="modal-backdrop" onClick={() => setRefundList(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reembolsar un ticket</h2>
            <table>
              <thead>
                <tr><th>Ticket</th><th>Cliente</th><th>Pago</th><th className="num">Total</th><th></th></tr>
              </thead>
              <tbody>
                {refundList.map((s) => (
                  <tr key={s.id}>
                    <td>#{s.ticket_number}</td>
                    <td>{s.customer_name ?? "Consumidor Final"}</td>
                    <td>{METHOD_LABEL[s.payment_method] ?? s.payment_method}</td>
                    <td className="num">{money(s.total)}</td>
                    <td><button className="small danger" onClick={() => reembolsar(s)}>Reembolsar</button></td>
                  </tr>
                ))}
                {refundList.length === 0 && (
                  <tr><td colSpan={5} className="muted">No hay tickets reembolsables.</td></tr>
                )}
              </tbody>
            </table>
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="secondary" onClick={() => setRefundList(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
