import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { Campo, FormPropio } from "@/components/form-propio";
import { Aviso, Boton, Chip, Hoja } from "@/components/ui";
import { api, leerNumero, mensaje, money } from "@/lib/api";
import { metaDe, opcionesDe, type B2BProductoMaestro } from "@/lib/b2b";
import { color, s } from "@/lib/tema";
import type { StockItem } from "@/lib/tipos";

type Filtro = "todos" | "bajo" | "sinPrecio";

/** Un código de barras leído por el lector, no un nombre tipeado */
const pareceEan = (t: string) => /^\d{8,14}$/.test(t);

const cantidadTexto = (i: StockItem) =>
  `${Number(i.quantity).toLocaleString("es-AR", { maximumFractionDigits: 3 })}${i.venta_por_peso ? " kg" : ""}`;

export default function Productos() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [items, setItems] = useState<StockItem[]>([]);
  const [sinPrecio, setSinPrecio] = useState(0);
  const [cargado, setCargado] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [editando, setEditando] = useState<StockItem | null>(null);
  // eanInicial: lo que leyó el lector y no está en el stock
  const [alta, setAlta] = useState<{ modo: "catalogo" | "propio"; ean?: string; producto?: B2BProductoMaestro } | null>(null);
  // Lo que coincide en NexoB2B y todavía no está en el stock
  const [catalogo, setCatalogo] = useState<{ termino: string; productos: B2BProductoMaestro[] }>({ termino: "", productos: [] });
  const buscador = useRef<TextInput>(null);
  const pedido = useRef(0);

  // Buscar en Productos es también buscar en el catálogo: el comerciante no
  // distingue "lo mío" de "lo de NexoB2B" hasta que lo tiene dado de alta.
  useEffect(() => {
    const t0 = q.trim();
    if (t0.length < 3 || filtro !== "todos") { setCatalogo({ termino: "", productos: [] }); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const d = await api<{ productos: B2BProductoMaestro[]; termino: string }>(
          `/api/catalog/maestro?termino=${encodeURIComponent(t0)}`);
        if (vivo && d.termino === t0) setCatalogo({ termino: t0, productos: d.productos.slice(0, 20) });
      } catch {
        // El stock propio se sigue viendo aunque NexoB2B no conteste
        if (vivo) setCatalogo({ termino: "", productos: [] });
      }
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, filtro]);

  const cargar = useCallback(async () => {
    const nro = ++pedido.current;
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (filtro === "bajo") params.set("lowOnly", "true");
      if (filtro === "sinPrecio") params.set("sinPrecio", "true");
      const lista = await api<StockItem[]>(`/api/stock?${params}`);
      // Tipeando rápido salen varias búsquedas: la que llega tarde no pisa a la última
      if (nro !== pedido.current) return;
      setItems(lista);
      setCargado(true);
      setError("");
    } catch (e) {
      if (nro === pedido.current) setError(mensaje(e));
    }
    api<{ sinPrecio: number }>("/api/stock/sin-precio").then((d) => setSinPrecio(d.sinPrecio)).catch(() => {});
  }, [q, filtro]);

  useEffect(() => {
    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
  }, [cargar]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  function avisar(m: string) {
    setAviso(m);
    setTimeout(() => setAviso(""), 4000);
  }

  /**
   * Enter del buscador. Con el lector: si el código está en el stock se abre
   * ese producto; si no, se ofrece darlo de alta con el código ya puesto.
   */
  async function onEnter(texto: string) {
    const term = texto.trim();
    if (!pareceEan(term)) return;
    buscador.current?.clear();
    setQ("");
    try {
      const lista = await api<StockItem[]>(`/api/stock?q=${encodeURIComponent(term)}`);
      const exacto = lista.find((i) => i.ean === term || i.plu === term);
      if (exacto) setEditando(exacto);
      else setAlta({ modo: "catalogo", ean: term });
    } catch (e) {
      setError(mensaje(e));
    }
  }

  const enStock = new Set(items.map((i) => i.ean).filter(Boolean));
  const delCatalogo = catalogo.termino && catalogo.termino === q.trim()
    ? catalogo.productos.filter((p) => !p.ean || !enStock.has(p.ean))
    : [];

  return (
    <View style={s.pantalla}>
      <View style={{ padding: 12, gap: 8, maxWidth: 900, width: "100%", alignSelf: "center" }}>
        <View style={s.fila}>
          <Boton style={{ flex: 1 }} onPress={() => setAlta({ modo: "catalogo" })}>+ Del catálogo</Boton>
          <Boton style={{ flex: 1 }} variante="secundario" onPress={() => setAlta({ modo: "propio" })}>+ Producto propio</Boton>
        </View>
        <TextInput
          ref={buscador}
          style={s.input}
          placeholder="Escaneá o buscá por nombre…"
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          submitBehavior="submit"
          onSubmitEditing={(e) => onEnter(e.nativeEvent.text)}
        />
        <View style={[s.fila, { flexWrap: "wrap" }]}>
          <Chip activo={filtro === "todos"} onPress={() => setFiltro("todos")}>Todos</Chip>
          <Chip activo={filtro === "bajo"} onPress={() => setFiltro("bajo")}>Stock bajo</Chip>
          <Chip activo={filtro === "sinPrecio"} onPress={() => setFiltro("sinPrecio")}>
            {`Sin precio${sinPrecio ? ` (${sinPrecio})` : ""}`}
          </Chip>
        </View>
        {sinPrecio > 0 && filtro !== "sinPrecio" && (
          <Aviso tipo="aviso">
            {sinPrecio === 1 ? "1 producto no tiene" : `${sinPrecio} productos no tienen`} precio de venta y no
            aparecen en el mostrador.
          </Aviso>
        )}
        {aviso ? <Aviso tipo="ok">{aviso}</Aviso> : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => String(i.product_id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6, maxWidth: 900, width: "100%", alignSelf: "center" }}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
        ListEmptyComponent={<Text style={[s.apagado, { textAlign: "center", marginTop: 24 }]}>
          {!cargado ? "Cargando…"
            : q.trim() ? (delCatalogo.length ? "No lo tenés en tu stock." : "Ningún producto coincide.")
            : "Todavía no hay productos. Escaneá uno para darlo de alta."}
        </Text>}
        ListFooterComponent={delCatalogo.length ? (
          <View style={{ gap: 6, marginTop: 12 }}>
            <Text style={s.subtitulo}>En el catálogo de NexoB2B</Text>
            <Text style={s.apagado}>Tocá uno para darlo de alta en tu stock.</Text>
            {delCatalogo.map((p) => (
              <Pressable key={p.id} onPress={() => setAlta({ modo: "catalogo", producto: p })}
                style={[s.tarjeta, s.entre, { padding: 12, borderStyle: "dashed" }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.texto} numberOfLines={2}>{p.nombre}</Text>
                  <Text style={s.apagado}>{[p.marca, p.ean, p.pasillo_nombre].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={{ color: color.primario, fontWeight: "700" }}>+ Alta</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        renderItem={({ item }) => {
          const bajo = item.low_stock || Number(item.quantity) <= 0;
          return (
            <Pressable onPress={() => setEditando(item)} style={[s.tarjeta, s.entre, { padding: 12 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.texto} numberOfLines={2}>{item.name}</Text>
                <Text style={s.apagado}>
                  {[item.origen === "propio" ? "Propio" : null, item.ean, item.plu && `Balanza ${item.plu}`].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={[s.texto, { fontWeight: "700" }, !item.sale_price && { color: color.aviso }]}>
                  {item.sale_price ? money(item.sale_price) : "Sin precio"}
                </Text>
                <Text style={[s.apagado, bajo && { color: color.error, fontWeight: "600" }]}>{cantidadTexto(item)}</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Hoja visible={!!editando} titulo="Producto" onCerrar={() => setEditando(null)}>
        {editando && (
          <EditorProducto
            key={editando.product_id}
            item={editando}
            onCambio={(m) => { avisar(m); cargar(); }}
            onReponer={() => {
              const termino = editando.ean || editando.name.split(" — ")[0];
              setEditando(null);
              router.push({ pathname: "/compras", params: { buscar: termino } });
            }}
          />
        )}
      </Hoja>

      <Hoja visible={!!alta} titulo={alta?.modo === "propio" ? "Producto propio" : "Alta desde el catálogo"} onCerrar={() => setAlta(null)}>
        {alta?.modo === "catalogo" && (
          <AltaCatalogo
            eanInicial={alta.ean}
            productoInicial={alta.producto}
            // Si vino de tocar un resultado de la lista, se vuelve a la lista;
            // si vino del botón o del lector, la hoja queda para escanear el siguiente
            onAlta={(m) => { if (alta.producto) setAlta(null); avisar(m); cargar(); }}
            onPropio={(ean) => setAlta({ modo: "propio", ean })}
          />
        )}
        {alta?.modo === "propio" && (
          <FormPropio eanInicial={alta.ean} onListo={(m) => { setAlta(null); avisar(m); cargar(); }} />
        )}
      </Hoja>
    </View>
  );
}

const MOTIVOS = ["Recuento", "Rotura o vencido", "Consumo interno", "Devolución a proveedor"];

function EditorProducto({ item, onCambio, onReponer }: {
  item: StockItem; onCambio: (mensaje: string) => void; onReponer: () => void;
}) {
  const [ficha, setFicha] = useState(false);
  const [precio, setPrecio] = useState(item.sale_price ? String(Number(item.sale_price)) : "");
  const [costo, setCosto] = useState(item.cost ? String(Number(item.cost)) : "");
  const [minimo, setMinimo] = useState(item.min_stock != null ? String(Number(item.min_stock)) : "");
  const [cantidad, setCantidad] = useState(Number(item.quantity));
  const [sentido, setSentido] = useState<"entra" | "sale">("entra");
  const [delta, setDelta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState<"" | "precio" | "stock">("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  if (ficha) {
    return <FormPropio inicial={item} onListo={(m) => { setFicha(false); onCambio(m); }} />;
  }

  async function guardarPrecios() {
    setError(""); setOk("");
    const cambios: Record<string, number> = {};
    const p = leerNumero(precio), c = leerNumero(costo), m = leerNumero(minimo);
    if (p != null && p !== Number(item.sale_price ?? -1)) cambios.salePrice = p;
    if (c != null && c !== Number(item.cost ?? -1)) cambios.cost = c;
    if (m != null && m !== Number(item.min_stock ?? -1)) cambios.minStock = m;
    if (!Object.keys(cambios).length) { setOk("No hay cambios."); return; }
    if (cambios.salePrice !== undefined && cambios.salePrice <= 0) { setError("El precio tiene que ser mayor a cero."); return; }
    setBusy("precio");
    try {
      await api(`/api/stock/${item.product_id}/precio`, { method: "PUT", body: cambios });
      setOk("Guardado.");
      onCambio(`«${item.name}» actualizado.`);
    } catch (e) {
      setError(mensaje(e, "No se pudo guardar"));
    } finally {
      setBusy("");
    }
  }

  async function ajustar() {
    setError(""); setOk("");
    const n = leerNumero(delta);
    if (!n || n <= 0) { setError("Poné cuántas unidades entran o salen."); return; }
    if (!motivo.trim()) { setError("Elegí o escribí el motivo: el ajuste queda registrado."); return; }
    const quantityDelta = sentido === "entra" ? n : -n;
    setBusy("stock");
    try {
      const r = await api<{ quantity: number }>("/api/stock/adjust", {
        body: { productId: item.product_id, quantityDelta, reason: motivo.trim() },
      });
      setCantidad(r.quantity);
      setDelta(""); setMotivo("");
      setOk(`Stock ajustado: quedan ${r.quantity.toLocaleString("es-AR")}.`);
      onCambio(`Stock de «${item.name}» ajustado.`);
    } catch (e) {
      setError(mensaje(e, "No se pudo ajustar"));
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 2 }}>
        <Text style={s.subtitulo}>{item.name}</Text>
        <Text style={s.apagado}>
          {[item.origen === "propio" ? "Producto propio" : "Catálogo NexoB2B", item.ean, item.plu && `Balanza ${item.plu}`]
            .filter(Boolean).join(" · ")}
        </Text>
      </View>

      <View style={[s.tarjeta, { gap: 10 }]}>
        <Text style={s.subtitulo}>Precio</Text>
        <View style={s.fila}>
          <View style={{ flex: 1 }}>
            <Campo etiqueta={item.venta_por_peso ? "Venta por kg" : "Venta"}>
              <TextInput style={s.input} value={precio} onChangeText={setPrecio} keyboardType="decimal-pad" />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo etiqueta="Costo">
              <TextInput style={s.input} value={costo} onChangeText={setCosto} keyboardType="decimal-pad" />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo etiqueta="Mínimo">
              <TextInput style={s.input} value={minimo} onChangeText={setMinimo} keyboardType="decimal-pad" />
            </Campo>
          </View>
        </View>
        <Boton cargando={busy === "precio"} onPress={guardarPrecios}>Guardar precio</Boton>
      </View>

      <View style={[s.tarjeta, { gap: 10 }]}>
        <View style={s.entre}>
          <Text style={s.subtitulo}>Stock</Text>
          <Text style={[s.subtitulo, cantidad <= 0 && { color: color.error }]}>
            {cantidad.toLocaleString("es-AR", { maximumFractionDigits: 3 })}{item.venta_por_peso ? " kg" : ""}
          </Text>
        </View>
        <View style={s.fila}>
          <Chip activo={sentido === "entra"} onPress={() => setSentido("entra")}>Entra</Chip>
          <Chip activo={sentido === "sale"} onPress={() => setSentido("sale")}>Sale</Chip>
          <TextInput style={[s.input, { flex: 1 }]} value={delta} onChangeText={setDelta} keyboardType="decimal-pad" placeholder="Cantidad" />
        </View>
        <View style={[s.fila, { flexWrap: "wrap" }]}>
          {MOTIVOS.map((m) => <Chip key={m} activo={motivo === m} onPress={() => setMotivo(m)}>{m}</Chip>)}
        </View>
        <TextInput style={s.input} value={motivo} onChangeText={setMotivo} placeholder="Motivo" />
        <Boton variante="secundario" cargando={busy === "stock"} onPress={ajustar}>Ajustar stock</Boton>
      </View>

      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : null}

      {item.origen === "propio"
        ? <Boton variante="secundario" onPress={() => setFicha(true)}>Editar ficha</Boton>
        : <Boton variante="secundario" onPress={onReponer}>Reponer con un mayorista</Boton>}
    </View>
  );
}

/**
 * Alta de mercadería que el comercio ya tiene en el local, buscándola en el
 * catálogo maestro de NexoB2B (la venda o no un mayorista). Pensada para
 * escanear uno atrás de otro: después de cada alta el buscador queda listo.
 */
function AltaCatalogo({ eanInicial, productoInicial, onAlta, onPropio }: {
  eanInicial?: string;
  productoInicial?: B2BProductoMaestro;
  onAlta: (mensaje: string) => void;
  onPropio: (ean?: string) => void;
}) {
  const [termino, setTermino] = useState(eanInicial ?? "");
  const [resultados, setResultados] = useState<B2BProductoMaestro[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState("");
  const [elegido, setElegido] = useState<{ producto: B2BProductoMaestro; idx: number } | null>(
    productoInicial ? { producto: productoInicial, idx: 0 } : null);
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [minimo, setMinimo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const buscador = useRef<TextInput>(null);

  useEffect(() => {
    const t0 = termino.trim();
    if (!t0) { setResultados([]); setBuscado(""); return; }
    setBuscando(true);
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const d = await api<{ productos: B2BProductoMaestro[]; termino: string }>(
          `/api/catalog/maestro?termino=${encodeURIComponent(t0)}`);
        // El backend devuelve el término: una respuesta vieja que llega tarde se descarta
        if (!vivo || d.termino !== t0) return;
        const productos = d.productos.slice(0, 15);
        setResultados(productos);
        setBuscado(t0);
        // Con el lector, el código encuentra uno solo: se abre directo
        const porEan = productos.find((p) => p.ean === t0 || p.presentaciones?.some((pr) => pr.ean_propio === t0));
        if (porEan) {
          const idx = opcionesDe(porEan).findIndex((o) => o.ean_propio === t0);
          elegir(porEan, idx >= 0 ? idx : 0);
        }
      } catch (e) {
        if (vivo) setError(mensaje(e));
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [termino]);

  function elegir(producto: B2BProductoMaestro, idx: number) {
    setElegido({ producto, idx });
    setCantidad(""); setCosto(""); setPrecio(""); setMinimo("");
    setError(""); setOk("");
  }

  async function confirmar() {
    if (!elegido) return;
    const salePrice = leerNumero(precio);
    if (salePrice != null && salePrice <= 0) { setError("El precio tiene que ser mayor a cero."); return; }
    const pres = opcionesDe(elegido.producto)[elegido.idx];
    setBusy(true); setError("");
    try {
      await api("/api/stock/add-from-catalog", {
        body: {
          presentacionId: pres.id,
          meta: metaDe(elegido.producto, pres),
          quantity: leerNumero(cantidad) ?? 0,
          cost: leerNumero(costo) ?? undefined,
          salePrice: salePrice ?? undefined,
          minStock: leerNumero(minimo) ?? undefined,
        },
      });
      const nombre = `${elegido.producto.nombre} — ${pres.nombre}`;
      setElegido(null);
      setTermino(""); setResultados([]); setBuscado("");
      setOk(`«${nombre}» dado de alta. Escaneá el siguiente…`);
      onAlta(`«${nombre}» dado de alta en tu stock.`);
      buscador.current?.focus();
    } catch (e) {
      setError(mensaje(e, "No se pudo dar de alta"));
    } finally {
      setBusy(false);
    }
  }

  if (elegido) {
    const opciones = opcionesDe(elegido.producto);
    const p = elegido.producto;
    return (
      <View style={{ gap: 12 }}>
        <Pressable onPress={() => setElegido(null)}><Text style={{ color: color.primario }}>← Volver a la búsqueda</Text></Pressable>
        <View style={{ gap: 2 }}>
          <Text style={s.subtitulo}>{p.nombre}</Text>
          <Text style={s.apagado}>{[p.marca, p.ean, p.rubro_nombre].filter(Boolean).join(" · ")}</Text>
        </View>
        <Campo etiqueta="Presentación">
          <View style={[s.fila, { flexWrap: "wrap" }]}>
            {opciones.map((o, i) => (
              <Chip key={o.id} activo={elegido.idx === i} onPress={() => setElegido({ producto: p, idx: i })}>
                {o.factor > 1 ? `${o.nombre} (×${o.factor})` : o.nombre}
              </Chip>
            ))}
          </View>
        </Campo>
        <View style={s.fila}>
          <View style={{ flex: 1 }}>
            <Campo etiqueta="Precio de venta">
              <TextInput style={s.input} value={precio} onChangeText={setPrecio} keyboardType="decimal-pad" autoFocus />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo etiqueta="Costo">
              <TextInput style={s.input} value={costo} onChangeText={setCosto} keyboardType="decimal-pad" />
            </Campo>
          </View>
        </View>
        <View style={s.fila}>
          <View style={{ flex: 1 }}>
            <Campo etiqueta="Cantidad que tenés">
              <TextInput style={s.input} value={cantidad} onChangeText={setCantidad} keyboardType="decimal-pad" placeholder="0" />
            </Campo>
          </View>
          <View style={{ flex: 1 }}>
            <Campo etiqueta="Stock mínimo">
              <TextInput style={s.input} value={minimo} onChangeText={setMinimo} keyboardType="decimal-pad" placeholder="0" />
            </Campo>
          </View>
        </View>
        {!leerNumero(precio) && (
          <Aviso tipo="aviso">Sin precio de venta el producto queda en el stock pero no aparece en el mostrador.</Aviso>
        )}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <Boton grande cargando={busy} onPress={confirmar}>Dar de alta</Boton>
      </View>
    );
  }

  const sinResultados = !buscando && !!buscado && resultados.length === 0;
  return (
    <View style={{ gap: 10 }}>
      <TextInput
        ref={buscador}
        style={s.input}
        placeholder="Escaneá el código o buscá por nombre o marca…"
        value={termino}
        onChangeText={(t) => { setTermino(t); setOk(""); }}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        submitBehavior="submit"
        // El lector manda Enter al final: el texto del evento ya es el código entero
        onSubmitEditing={(e) => setTermino(e.nativeEvent.text.trim())}
      />
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {buscando && <Text style={s.apagado}>Buscando en el catálogo de NexoB2B…</Text>}
      {resultados.map((p) => (
        <Pressable key={p.id} onPress={() => elegir(p, 0)} style={[s.tarjeta, { padding: 12, gap: 2 }]}>
          <Text style={s.texto}>{p.nombre}</Text>
          <Text style={s.apagado}>{[p.marca, p.ean && `EAN ${p.ean}`, p.pasillo_nombre].filter(Boolean).join(" · ")}</Text>
        </Pressable>
      ))}
      {sinResultados && (
        <View style={{ gap: 10 }}>
          <Aviso tipo="aviso">«{buscado}» no está en el catálogo de NexoB2B.</Aviso>
          <Boton variante="secundario" onPress={() => onPropio(pareceEan(buscado) ? buscado : undefined)}>
            Crearlo como producto propio
          </Boton>
        </View>
      )}
      {!termino.trim() && (
        <Text style={s.apagado}>
          Para cargar lo que ya tenés en el local. Si no está en el catálogo, se crea como producto propio.
        </Text>
      )}
    </View>
  );
}
