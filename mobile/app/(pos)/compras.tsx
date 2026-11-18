import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Mayoristas } from "@/components/mayoristas";
import { CampoBusqueda } from "@/components/escaner";
import { Aviso, Boton, Chip, Fila, Hoja } from "@/components/ui";
import { api, mensaje, money } from "@/lib/api";
import {
  ESTADO_ORDEN, etiquetaPrecio, mejorOferta, metaDe, ordenCancelada, ordenEntregada, precioVisible,
  type B2BListing, type B2BMayorista, type B2BMedioPago, type B2BPresentacion, type B2BProducto, type OrdenCompra,
} from "@/lib/b2b";
import { useCarrito, type LineaCarrito } from "@/lib/carrito";
import { useTaxonomia } from "@/lib/taxonomia";
import { color, s } from "@/lib/tema";
import { fechaHora } from "@/lib/tipos";

type Vista = "catalogo" | "carrito" | "pedidos" | "mayoristas";
const PAGINA = 50;

/**
 * Compras a mayoristas por NexoB2B: el mismo catálogo y el mismo precio que
 * ve el comercio en el portal de B2B, el carrito (una orden por mayorista) y
 * las órdenes, donde la mercadería entregada se ingresa al stock.
 */
export default function Compras() {
  const { buscar } = useLocalSearchParams<{ buscar?: string }>();
  const [vista, setVista] = useState<Vista>("catalogo");
  // «Ver catálogo» de un mayorista: el catálogo filtrado a lo que vende él
  const [mayorista, setMayorista] = useState<{ id: string; nombre: string } | null>(null);
  const lineas = useCarrito((c) => c.lineas);
  const cargarCarrito = useCarrito((c) => c.cargar);
  const unidades = lineas.length;

  useEffect(() => { cargarCarrito(); }, [cargarCarrito]);
  // «Reponer con un mayorista» desde Productos llega con el producto a buscar
  useEffect(() => { if (buscar) { setMayorista(null); setVista("catalogo"); } }, [buscar]);

  return (
    <View style={s.pantalla}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ gap: 8, padding: 12, paddingBottom: 2, alignItems: "center" }}>
        <Chip activo={vista === "catalogo"} onPress={() => setVista("catalogo")}>Catálogo</Chip>
        <Chip activo={vista === "carrito"} onPress={() => setVista("carrito")}>
          {`Carrito${unidades ? ` (${unidades})` : ""}`}
        </Chip>
        <Chip activo={vista === "pedidos"} onPress={() => setVista("pedidos")}>Órdenes</Chip>
        <Chip activo={vista === "mayoristas"} onPress={() => setVista("mayoristas")}>Mayoristas</Chip>
      </ScrollView>
      {vista === "catalogo" && (
        // El catálogo de un mayorista arranca de cero: sin la búsqueda que haya
        // quedado de «Reponer»
        <Catalogo key={mayorista?.id ?? "todos"} buscarInicial={mayorista ? undefined : buscar} mayorista={mayorista} onQuitarMayorista={() => setMayorista(null)}
          onVerCarrito={() => setVista("carrito")} />
      )}
      {vista === "mayoristas" && (
        <Mayoristas onVerCatalogo={(m: B2BMayorista) => { setMayorista({ id: m.id, nombre: m.nombre }); setVista("catalogo"); }} />
      )}
      {vista === "carrito" && <Carrito onConfirmada={() => setVista("pedidos")} />}
      {vista === "pedidos" && <Ordenes />}
    </View>
  );
}

function Catalogo({ buscarInicial, mayorista, onQuitarMayorista, onVerCarrito }: {
  buscarInicial?: string;
  mayorista: { id: string; nombre: string } | null;
  onQuitarMayorista: () => void;
  onVerCarrito: () => void;
}) {
  const tax = useTaxonomia();
  const [texto, setTexto] = useState(buscarInicial ?? "");
  const [q, setQ] = useState(buscarInicial ?? "");
  const [pasilloId, setPasilloId] = useState<string | null>(null);
  const [sinStock, setSinStock] = useState(false);
  const [soloAlta, setSoloAlta] = useState(false);
  const [productos, setProductos] = useState<B2BProducto[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [abierto, setAbierto] = useState<B2BProducto | null>(null);
  const pedido = useRef(0);

  useEffect(() => { if (buscarInicial) { setTexto(buscarInicial); setQ(buscarInicial); } }, [buscarInicial]);
  // Se busca 400 ms después de la última tecla, o al instante con Enter
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 400);
    return () => clearTimeout(t);
  }, [texto]);

  const cargar = useCallback(async (n: number) => {
    const nro = ++pedido.current;
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(n), page_size: String(PAGINA) });
      if (q) params.set("q", q);
      if (pasilloId) params.set("pasillo_id", pasilloId);
      if (mayorista) params.set("mayorista_id", mayorista.id);
      if (!sinStock) params.set("con_stock", "1");
      const d = await api<{ productos: B2BProducto[]; total: number; page: number; totalPages: number }>(`/api/catalog?${params}`);
      if (nro !== pedido.current) return;
      setProductos((prev) => (n > 1 ? [...prev, ...d.productos] : d.productos));
      setTotal(d.total ?? d.productos.length);
      setPagina(d.page ?? n);
      setPaginas(d.totalPages ?? 1);
    } catch (e) {
      if (nro === pedido.current) setError(mensaje(e, "No se pudo traer el catálogo"));
    } finally {
      if (nro === pedido.current) setCargando(false);
    }
  }, [q, pasilloId, sinStock, mayorista]);

  useEffect(() => { cargar(1); }, [cargar]);

  // Igual que en B2B: «con alta» se filtra sobre lo que ya llegó
  const mostrados = soloAlta ? productos.filter((p) => p.mayoristas.some((m) => m.tiene_alta)) : productos;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8, maxWidth: 900, width: "100%", alignSelf: "center" }}>
        <CampoBusqueda
          onEscaneo={(codigo) => { setTexto(codigo); setQ(codigo); }}
          placeholder="Escaneá o buscá por nombre, EAN, marca…"
          value={texto}
          onChangeText={setTexto}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={(e) => setQ(e.nativeEvent.text.trim())}
        />
        {(tax?.pasillos.length ?? 0) > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {tax!.pasillos.map((p) => (
              <Chip key={p.id} activo={pasilloId === p.id} onPress={() => setPasilloId(pasilloId === p.id ? null : p.id)}>{p.nombre}</Chip>
            ))}
          </ScrollView>
        )}
        <View style={[s.fila, { flexWrap: "wrap" }]}>
          {mayorista && <Chip activo onPress={onQuitarMayorista}>{`${mayorista.nombre}  ✕`}</Chip>}
          <Chip activo={soloAlta} onPress={() => setSoloAlta((v) => !v)}>{soloAlta ? "✓ " : ""}Sólo con alta</Chip>
          <Chip activo={sinStock} onPress={() => setSinStock((v) => !v)}>{sinStock ? "✓ " : ""}Mostrar sin stock</Chip>
        </View>
        {aviso ? (
          <Pressable onPress={onVerCarrito}><Aviso tipo="ok">{`${aviso} Tocá para ver el carrito.`}</Aviso></Pressable>
        ) : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <Text style={s.apagado}>{productos.length} de {total} productos</Text>
      </View>

      <FlatList
        data={mostrados}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16, gap: 6, maxWidth: 900, width: "100%", alignSelf: "center" }}
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (!cargando && pagina < paginas) cargar(pagina + 1); }}
        ListFooterComponent={cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        ListEmptyComponent={!cargando ? <Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>No hay productos disponibles.</Text> : null}
        renderItem={({ item: p }) => {
          const oferta = mejorOferta(p);
          const conAlta = p.mayoristas.filter((m) => m.tiene_alta).length;
          return (
            <Pressable onPress={() => setAbierto(p)} style={[s.tarjeta, s.entre, { padding: 12 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.texto} numberOfLines={2}>{p.nombre}</Text>
                <Text style={s.apagado} numberOfLines={1}>{[p.marca, p.ean, p.pasillo_nombre].filter(Boolean).join(" · ")}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                {oferta
                  ? <Text style={[s.texto, { fontWeight: "700" }]}>desde {money(precioVisible(oferta))}</Text>
                  : <Text style={s.apagado}>Consultar</Text>}
                <Text style={s.apagado}>
                  {p.mayoristas.length} mayorista{p.mayoristas.length !== 1 ? "s" : ""}{conAlta ? ` · ${conAlta} con alta` : ""}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Hoja visible={!!abierto} titulo="Comprar" onCerrar={() => setAbierto(null)}>
        {abierto && (
          <Ofertas producto={abierto} onAgregado={(m) => { setAviso(m); setTimeout(() => setAviso(""), 4000); }} />
        )}
      </Hoja>
    </View>
  );
}

function Ofertas({ producto, onAgregado }: { producto: B2BProducto; onAgregado: (mensaje: string) => void }) {
  const agregar = useCarrito((c) => c.agregar);
  const lineas = useCarrito((c) => c.lineas);
  const [ok, setOk] = useState("");

  function sumar(listing: B2BListing, pres: B2BPresentacion, cantidad: number) {
    agregar({
      presentacionId: pres.id,
      presentacionMaestraId: pres.presentacion_id,
      mayoristaId: listing.mayorista_id,
      mayoristaNombre: listing.mayorista_nombre,
      cantidad,
      precio: pres.precio,
      meta: metaDe(producto, pres),
    });
    const m = `${cantidad} × ${pres.nombre} al carrito de ${listing.mayorista_nombre}.`;
    setOk(m);
    onAgregado(m);
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text style={s.subtitulo}>{producto.nombre}</Text>
        <Text style={s.apagado}>{[producto.marca, producto.ean && `EAN ${producto.ean}`].filter(Boolean).join(" · ")}</Text>
      </View>
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
      {producto.mayoristas.length === 0 && <Aviso tipo="aviso">Ningún mayorista lo vende por NexoB2B todavía.</Aviso>}
      {producto.mayoristas.map((m) => (
        <View key={m.listing_id} style={[s.tarjeta, { gap: 10 }]}>
          <View style={s.entre}>
            <Text style={[s.subtitulo, { flex: 1 }]}>{m.mayorista_nombre}</Text>
            {m.tiene_alta
              ? <Text style={{ color: color.ok, fontWeight: "600" }}>✓ Alta</Text>
              : <Text style={s.apagado}>Sin alta</Text>}
          </View>
          {!m.tiene_alta && (
            <Text style={s.apagado}>Para comprarle, pedí el alta desde Mayoristas en nexopos.app.</Text>
          )}
          {m.tiempo_entrega_dias != null && <Text style={s.apagado}>Entrega en {m.tiempo_entrega_dias} días</Text>}
          {m.presentaciones.map((pres) => (
            <FilaPresentacion
              key={pres.id}
              pres={pres}
              puede={m.tiene_alta}
              enCarrito={lineas.find((l) => l.presentacionId === pres.id)?.cantidad ?? 0}
              onAgregar={(c) => sumar(m, pres, c)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function FilaPresentacion({ pres, puede, enCarrito, onAgregar }: {
  pres: B2BPresentacion; puede: boolean; enCarrito: number; onAgregar: (cantidad: number) => void;
}) {
  const [cantidad, setCantidad] = useState(1);
  const sinStock = pres.stock === 0;
  // El de lista viene neto: tacharlo al lado de un final dejaría el tachado más barato
  const lista = pres.precio_lista_mostrar ?? pres.precio_lista;
  const tachado = lista != null && lista > precioVisible(pres) ? lista : null;
  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderColor: color.borde, paddingTop: 10 }}>
      <View style={s.entre}>
        <Text style={s.texto}>{pres.nombre}{pres.factor > 1 ? ` (×${pres.factor})` : ""}</Text>
        <View style={{ alignItems: "flex-end" }}>
          {tachado != null && <Text style={[s.apagado, { textDecorationLine: "line-through" }]}>{money(tachado)}</Text>}
          <Text style={[s.texto, { fontWeight: "700" }]}>
            {money(precioVisible(pres))} <Text style={s.apagado}>{etiquetaPrecio(pres)}</Text>
          </Text>
        </View>
      </View>
      {sinStock && <Text style={{ color: color.error }}>Sin stock</Text>}
      {pres.stock != null && pres.stock > 0 && pres.stock < 10 && <Text style={{ color: color.aviso }}>Últimas {pres.stock} unidades</Text>}
      {puede && (
        <View style={s.entre}>
          <Text style={s.apagado}>{enCarrito ? `${enCarrito} en el carrito` : " "}</Text>
          <View style={s.fila}>
            <Paso onPress={() => setCantidad((c) => Math.max(1, c - 1))}>−</Paso>
            <Text style={[s.subtitulo, { minWidth: 28, textAlign: "center" }]}>{cantidad}</Text>
            <Paso onPress={() => setCantidad((c) => c + 1)}>+</Paso>
            <Boton desactivado={sinStock} onPress={() => { onAgregar(cantidad); setCantidad(1); }}>Agregar</Boton>
          </View>
        </View>
      )}
    </View>
  );
}

function Paso({ children, onPress }: { children: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}
      style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: color.borde, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
      <Text style={{ fontSize: 20, color: color.texto }}>{children}</Text>
    </Pressable>
  );
}

function Carrito({ onConfirmada }: { onConfirmada: () => void }) {
  const lineas = useCarrito((c) => c.lineas);
  const [ok, setOk] = useState("");
  const grupos = useMemo(() => {
    const g: Record<string, LineaCarrito[]> = {};
    for (const l of lineas) (g[l.mayoristaId] ??= []).push(l);
    return Object.entries(g);
  }, [lineas]);

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, maxWidth: 900, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
      {grupos.length === 0 && (
        <Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>
          El carrito está vacío. Agregá productos desde el Catálogo.
        </Text>
      )}
      {grupos.map(([mayoristaId, ls]) => (
        <GrupoMayorista key={mayoristaId} mayoristaId={mayoristaId} lineas={ls}
          onConfirmada={(numero) => {
            setOk(`Orden ${numero} enviada a ${ls[0].mayoristaNombre}.`);
            if (grupos.length === 1) setTimeout(onConfirmada, 1200);
          }} />
      ))}
    </ScrollView>
  );
}

function GrupoMayorista({ mayoristaId, lineas, onConfirmada }: {
  mayoristaId: string; lineas: LineaCarrito[]; onConfirmada: (numero: string) => void;
}) {
  const cambiar = useCarrito((c) => c.cantidad);
  const quitar = useCarrito((c) => c.quitar);
  const vaciar = useCarrito((c) => c.vaciarMayorista);
  const [medios, setMedios] = useState<B2BMedioPago[]>([]);
  const [medioId, setMedioId] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ mediosPago: B2BMedioPago[] }>(`/api/mayoristas/${mayoristaId}/medios-pago`)
      .then((d) => { setMedios(d.mediosPago); if (d.mediosPago[0]) setMedioId(d.mediosPago[0].id); })
      .catch((e) => setError(mensaje(e, "No se pudieron traer los medios de pago")));
  }, [mayoristaId]);

  const subtotal = lineas.reduce((a, l) => a + l.cantidad * l.precio, 0);
  const medio = medios.find((m) => m.id === medioId);
  const recargo = medio ? (subtotal * medio.porcentaje_costo) / 100 : 0;

  async function confirmar() {
    setBusy(true); setError("");
    try {
      const r = await api<{ numero: string }>("/api/purchases", {
        body: {
          mayoristaId,
          mayoristaNombre: lineas[0]?.mayoristaNombre,
          medioPagoId: medioId,
          notas: notas.trim() || undefined,
          items: lineas.map((l) => ({
            presentacionId: l.presentacionId,
            presentacionMaestraId: l.presentacionMaestraId,
            cantidad: l.cantidad,
            meta: l.meta,
          })),
        },
      });
      vaciar(mayoristaId);
      onConfirmada(r.numero);
    } catch (e) {
      setError(mensaje(e, "No se pudo confirmar la orden"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.tarjeta, { gap: 10 }]}>
      <Text style={s.subtitulo}>{lineas[0].mayoristaNombre}</Text>
      {lineas.map((l) => (
        <View key={l.presentacionId} style={{ gap: 6, borderTopWidth: 1, borderColor: color.borde, paddingTop: 8 }}>
          <Text style={s.texto}>{l.meta.productoNombre}</Text>
          <View style={s.entre}>
            <Text style={s.apagado}>{l.meta.presentacionNombre} · {money(l.precio)} + IVA</Text>
            <Text style={[s.texto, { fontWeight: "600" }]}>{money(l.cantidad * l.precio)}</Text>
          </View>
          <View style={s.entre}>
            <View style={s.fila}>
              <Paso onPress={() => cambiar(l.presentacionId, l.cantidad - 1)}>−</Paso>
              <Text style={[s.subtitulo, { minWidth: 28, textAlign: "center" }]}>{l.cantidad}</Text>
              <Paso onPress={() => cambiar(l.presentacionId, l.cantidad + 1)}>+</Paso>
            </View>
            <Pressable onPress={() => quitar(l.presentacionId)} hitSlop={8}><Text style={{ color: color.error }}>Quitar</Text></Pressable>
          </View>
        </View>
      ))}
      <View style={[s.fila, { flexWrap: "wrap" }]}>
        {medios.map((m) => (
          <Chip key={m.id} activo={medioId === m.id} onPress={() => setMedioId(m.id)}>
            {`${m.icono ? `${m.icono} ` : ""}${m.nombre}${m.porcentaje_costo > 0 ? ` (+${m.porcentaje_costo}%)` : ""}`}
          </Chip>
        ))}
      </View>
      <TextInput style={s.input} value={notas} onChangeText={setNotas} placeholder="Notas para el mayorista (opcional)" />
      <Fila etiqueta="Subtotal sin IVA" valor={money(subtotal)} fuerte />
      {recargo > 0 && <Fila etiqueta="Recargo del medio de pago" valor={money(recargo)} />}
      <Text style={s.apagado}>El total final con IVA lo calcula NexoB2B.</Text>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      <Boton grande cargando={busy} desactivado={!medioId} onPress={confirmar}>Confirmar orden</Boton>
    </View>
  );
}

function Ordenes() {
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [sync, setSync] = useState<{ ok: boolean; importadas: number; mensaje?: string } | null>(null);
  const [cargado, setCargado] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      const d = await api<{ ordenes: OrdenCompra[]; sync: typeof sync }>("/api/purchases");
      setOrdenes(d.ordenes);
      setSync(d.sync);
      setError("");
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setCargado(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  function ingresar(o: OrdenCompra) {
    Alert.alert(
      "Ingresar al stock",
      `Se suma al stock todo lo de la orden ${o.numero ?? o.id} de ${o.wholesaler_name}, con su costo. ¿Ya llegó la mercadería?`,
      [
        { text: "Todavía no", style: "cancel" },
        {
          text: "Ingresar", onPress: async () => {
            setBusy(o.id); setError(""); setOk("");
            try {
              const r = await api<{ itemsReceived: number }>(`/api/purchases/${o.id}/receive`, { method: "POST" });
              setOk(`Orden ${o.numero ?? o.id} ingresada: ${r.itemsReceived} productos al stock.`);
              await cargar();
            } catch (e) {
              setError(mensaje(e, "No se pudo ingresar"));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  }

  function cancelar(o: OrdenCompra) {
    Alert.alert("Cancelar orden", `¿Cancelar la orden ${o.numero ?? o.id} a ${o.wholesaler_name}?`, [
      { text: "No", style: "cancel" },
      {
        text: "Cancelar orden", style: "destructive", onPress: async () => {
          setBusy(o.id); setError(""); setOk("");
          try {
            await api(`/api/purchases/${o.id}/cancel`, { method: "POST" });
            setOk(`Orden ${o.numero ?? o.id} cancelada.`);
            await cargar();
          } catch (e) {
            setError(mensaje(e, "No se pudo cancelar"));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <FlatList
      data={ordenes}
      keyExtractor={(o) => String(o.id)}
      contentContainerStyle={{ padding: 12, gap: 8, maxWidth: 900, width: "100%", alignSelf: "center" }}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          {sync && !sync.ok && (
            <Aviso tipo="aviso">{`No se pudo sincronizar con NexoB2B (${sync.mensaje}). Puede faltar alguna compra hecha desde la web o la app.`}</Aviso>
          )}
          {sync?.ok && sync.importadas > 0 && (
            <Aviso tipo="ok">{`Se ${sync.importadas === 1 ? "trajo 1 compra" : `trajeron ${sync.importadas} compras`} hechas desde NexoB2B.`}</Aviso>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>
        {cargado ? "Sin compras todavía." : "Cargando…"}
      </Text>}
      renderItem={({ item: o }) => {
        const estado = o.estado_b2b ? ESTADO_ORDEN[o.estado_b2b] ?? { label: o.estado_b2b, tono: "info" as const } : null;
        const ingresada = o.status === "received";
        const recibible = !ingresada && o.status !== "cancelled" && !ordenCancelada(o.estado_b2b);
        // Entregada y todavía fuera del stock: es lo que el comercio tiene pendiente
        const faltaIngresar = recibible && ordenEntregada(o.estado_b2b);
        const cancelable = o.estado_b2b === "cargada" && !o.is_facturada && !ingresada;
        const tono = estado ? { info: color.primario, aviso: color.aviso, ok: color.ok, error: color.error }[estado.tono] : color.apagado;
        return (
          <View style={[s.tarjeta, { gap: 8 }]}>
            <View style={s.entre}>
              <Text style={s.subtitulo}>{o.numero ?? `#${o.id}`}</Text>
              <Text style={[s.subtitulo]}>{money(o.total)}</Text>
            </View>
            <Text style={s.texto}>{o.wholesaler_name || "Mayorista"}</Text>
            <View style={[s.fila, { flexWrap: "wrap" }]}>
              {estado && <Text style={{ color: tono, fontWeight: "600" }}>{estado.label}</Text>}
              <Text style={s.apagado}>{fechaHora(o.created_at)}{o.medio_pago ? ` · ${o.medio_pago}` : ""}</Text>
            </View>
            {ingresada && <Text style={{ color: color.ok, fontWeight: "600" }}>✓ Ingresada al stock</Text>}
            {faltaIngresar && <Text style={{ color: color.aviso, fontWeight: "600" }}>Falta ingresar al stock</Text>}
            {(recibible || cancelable) && (
              <View style={s.fila}>
                {recibible && (
                  <Boton style={{ flex: 1 }} variante={faltaIngresar ? "primario" : "secundario"} cargando={busy === o.id} onPress={() => ingresar(o)}>
                    Ingresar al stock
                  </Boton>
                )}
                {cancelable && <Boton variante="peligro" desactivado={busy === o.id} onPress={() => cancelar(o)}>Cancelar</Boton>}
              </View>
            )}
          </View>
        );
      }}
    />
  );
}
