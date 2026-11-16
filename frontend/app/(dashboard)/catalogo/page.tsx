"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { addToCart, loadCart } from "@/lib/cart";
import { Foto } from "@/lib/foto";
import type { B2BProducto, B2BListing, B2BPresentacion, B2BMayorista, B2BTaxonomia } from "@/lib/b2b-types";

/*
 * El catálogo de NexoB2B tal como lo ve el comerciante en el portal de B2B
 * (`/comercio/productos`): mismas vistas, mismos filtros y el mismo precio.
 * Comprar desde el mostrador o desde el portal tiene que sentirse igual.
 */

type Vista = "lista" | "grilla-chica" | "grilla-grande";
const VISTA_KEY = "nexopos_catalogo_vista";
const PAGE_SIZE = 50;

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

/** Lo que este comercio ve: final o neto, como decide B2B. Sin el campo, el neto. */
const precioVisible = (p: B2BPresentacion) => p.precio_mostrar ?? p.precio;
const etiquetaPrecio = (p: B2BPresentacion) => (p.muestra_precio === "neto" ? "+ IVA" : "final");

/**
 * «desde $X» entre todos los mayoristas. Se compara por el precio final: uno
 * puede mostrarse neto y otro final, y comparar un neto con un final elige mal.
 */
function mejorOferta(prod: B2BProducto): B2BPresentacion | null {
  let mejor: B2BPresentacion | null = null;
  for (const pr of prod.mayoristas.flatMap((m) => m.presentaciones)) {
    if (pr.precio == null) continue;
    if (!mejor || (pr.precio_final ?? pr.precio) < (mejor.precio_final ?? mejor.precio)) mejor = pr;
  }
  return mejor;
}

const cuantos = (n: number) => `${n} mayorista${n !== 1 ? "s" : ""}`;

export default function CatalogoPage() {
  // Lo que se ve en la caja y lo que se busca van separados: se busca 400 ms
  // después de la última tecla, o al instante con Enter (PEDIDO-A-NEXOPOS-BUSQUEDA.md).
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const pedidoActual = useRef(0);

  const [pasilloId, setPasilloId] = useState<string | null>(null);
  const [rubroId, setRubroId] = useState<string | null>(null);
  const [subrubroId, setSubrubroId] = useState<string | null>(null);
  const [mayoristaId, setMayoristaId] = useState<string | null>(null);
  // Destildado: al abrir se ven sólo los productos que alguien tiene en stock.
  const [mostrarSinStock, setMostrarSinStock] = useState(false);
  const [soloConAlta, setSoloConAlta] = useState(false);

  const [vista, setVista] = useState<Vista>("lista");
  const [taxonomia, setTaxonomia] = useState<B2BTaxonomia | null>(null);
  const [mayoristas, setMayoristas] = useState<B2BMayorista[]>([]);
  const [productos, setProductos] = useState<B2BProducto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [modal, setModal] = useState<B2BProducto | null>(null);
  const [enCarrito, setEnCarrito] = useState<Record<string, number>>({});
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // «Ver catálogo» desde Descubrí mayoristas llega con ?mayorista_id=.
    const id = new URLSearchParams(window.location.search).get("mayorista_id");
    if (id) setMayoristaId(id);
    try {
      const v = localStorage.getItem(VISTA_KEY) as Vista | null;
      if (v === "lista" || v === "grilla-chica" || v === "grilla-grande") setVista(v);
    } catch { /* sin almacenamiento: queda la lista */ }
    setEnCarrito(contarCarrito());
    api<B2BTaxonomia>("/api/catalog/taxonomia").then(setTaxonomia).catch(console.error);
    api<{ mayoristas: B2BMayorista[] }>("/api/mayoristas").then((d) => setMayoristas(d.mayoristas)).catch(console.error);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 400);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    if (!modal) return;
    const cerrar = (e: KeyboardEvent) => { if (e.key === "Escape") setModal(null); };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [modal]);

  function cambiarVista(v: Vista) {
    setVista(v);
    try { localStorage.setItem(VISTA_KEY, v); } catch { /* no importa */ }
  }

  const cargar = useCallback(async (pagina: number) => {
    // Numerado: una respuesta vieja que llega tarde no pisa la última.
    const nro = ++pedidoActual.current;
    if (pagina > 1) setCargandoMas(true); else setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(pagina), page_size: String(PAGE_SIZE) });
      if (q) params.set("q", q);
      if (pasilloId) params.set("pasillo_id", pasilloId);
      if (rubroId) params.set("rubro_id", rubroId);
      if (subrubroId) params.set("subrubro_id", subrubroId);
      if (mayoristaId) params.set("mayorista_id", mayoristaId);
      if (!mostrarSinStock) params.set("con_stock", "1");
      const data = await api<{ productos: B2BProducto[]; total: number; page: number; totalPages: number }>(
        `/api/catalog?${params}`);
      if (nro !== pedidoActual.current) return;
      setProductos((prev) => (pagina > 1 ? [...prev, ...data.productos] : data.productos));
      setTotal(data.total ?? data.productos.length);
      setPage(data.page ?? pagina);
      setTotalPages(data.totalPages ?? 1);
    } catch (err) {
      if (nro === pedidoActual.current) setError(err instanceof Error ? err.message : "No se pudo traer el catálogo");
    } finally {
      if (nro === pedidoActual.current) { setCargando(false); setCargandoMas(false); }
    }
  }, [q, pasilloId, rubroId, subrubroId, mayoristaId, mostrarSinStock]);

  useEffect(() => { cargar(1); }, [cargar]);

  function agregar(producto: B2BProducto, listing: B2BListing, pres: B2BPresentacion, cantidad: number) {
    addToCart({
      presentacionId: pres.id,
      presentacionMaestraId: pres.presentacion_id,
      mayoristaId: listing.mayorista_id,
      mayoristaNombre: listing.mayorista_nombre,
      cantidad,
      // El neto: la orden de compra se arma sin IVA, como en B2B.
      precio: pres.precio,
      meta: {
        productoNombre: producto.nombre,
        presentacionNombre: pres.nombre,
        ean: pres.ean_propio ?? producto.ean,
        descripcion: producto.descripcion ?? null,
        marca: producto.marca,
        pasilloId: producto.pasillo_id,
        pasilloNombre: producto.pasillo_nombre,
        rubroId: producto.rubro_id,
        rubroNombre: producto.rubro_nombre,
        subrubroId: producto.subrubro_id,
        subrubroNombre: producto.subrubro_nombre,
        imagenUrl: producto.imagen_url,
        alicuotaIva: producto.alicuota_iva,
        factor: pres.factor,
      },
    });
    setEnCarrito(contarCarrito());
    setMensaje(`${cantidad} × «${producto.nombre} — ${pres.nombre}» al carrito de ${listing.mayorista_nombre}.`);
    setTimeout(() => setMensaje(""), 3000);
  }

  const rubros = (taxonomia?.rubros ?? []).filter((r) => r.pasillo_id === pasilloId);
  const subrubros = (taxonomia?.subrubros ?? []).filter((s) => s.rubro_id === rubroId);
  const hayFiltros = !!(pasilloId || rubroId || subrubroId || soloConAlta);
  const mayorista = mayoristaId ? mayoristas.find((m) => m.id === mayoristaId) : null;
  // Igual que en B2B: «con alta» se filtra sobre lo que ya llegó.
  const mostrados = soloConAlta ? productos.filter((p) => p.mayoristas.some((m) => m.tiene_alta)) : productos;

  return (
    <div className="cat">
      <div className="cat-cabeza">
        <div className="cat-titulo">
          <h1>{mayorista ? mayorista.nombre : "Catálogo"}</h1>
          <span className="muted">{productos.length} de {total} productos</span>
        </div>
        <div className="cat-vistas" role="group" aria-label="Vista">
          <button className={vista === "lista" ? "activa" : ""} onClick={() => cambiarVista("lista")}>☰ Lista</button>
          <button className={vista === "grilla-chica" ? "activa" : ""} onClick={() => cambiarVista("grilla-chica")}>▦ Chica</button>
          <button className={vista === "grilla-grande" ? "activa" : ""} onClick={() => cambiarVista("grilla-grande")}>◼ Grande</button>
        </div>
      </div>

      {mayoristaId && (
        <div className="cat-mayorista">
          <span>Mostrando sólo {mayorista ? <strong>{mayorista.nombre}</strong> : "un mayorista"}</span>
          {mayorista?.contacto && mayorista.solicitud?.estado === "aceptado" && (
            <span className="muted">
              {mayorista.contacto.es_vendedor ? "Tu vendedor: " : "Contacto: "}
              <strong>{mayorista.contacto.nombre}</strong>
              {mayorista.contacto.celular && <> · <a href={`https://wa.me/${mayorista.contacto.celular.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a></>}
            </span>
          )}
          <button className="enlace primario" onClick={() => setMayoristaId(null)}>Ver todos los mayoristas</button>
        </div>
      )}

      <input
        className="cat-buscar"
        type="search"
        placeholder="🔍  Buscar por nombre, EAN, marca…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") setQ(texto.trim()); }}
      />

      {!mayoristaId && (taxonomia?.pasillos.length ?? 0) > 0 && (
        <div className="pildoras">
          <span className="muted pildoras-rotulo cat-rotulo">Pasillo</span>
          {taxonomia!.pasillos.map((p) => (
            <button key={p.id} className={`pildora pasillo${pasilloId === p.id ? " activa" : ""}`}
              onClick={() => { setPasilloId(pasilloId === p.id ? null : p.id); setRubroId(null); setSubrubroId(null); }}>
              {p.nombre}
            </button>
          ))}
        </div>
      )}
      {!mayoristaId && pasilloId && rubros.length > 0 && (
        <div className="pildoras cat-nivel-2">
          <span className="muted pildoras-rotulo cat-rotulo">Rubro</span>
          {rubros.map((r) => (
            <button key={r.id} className={`pildora${rubroId === r.id ? " activa" : ""}`}
              onClick={() => { setRubroId(rubroId === r.id ? null : r.id); setSubrubroId(null); }}>
              {r.nombre}
            </button>
          ))}
        </div>
      )}
      {rubroId && subrubros.length > 0 && (
        <div className="pildoras cat-nivel-3">
          <span className="muted pildoras-rotulo cat-rotulo">Subrubro</span>
          {subrubros.map((s) => (
            <button key={s.id} className={`pildora rubro${subrubroId === s.id ? " activa" : ""}`}
              onClick={() => setSubrubroId(subrubroId === s.id ? null : s.id)}>
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      <div className="pildoras cat-toggles">
        <button className={`pildora oscura${mostrarSinStock ? " activa" : ""}`} onClick={() => setMostrarSinStock((v) => !v)}>
          {mostrarSinStock ? "✓" : "○"} Mostrar sin stock
        </button>
        <button className={`pildora verde${soloConAlta ? " activa" : ""}`} onClick={() => setSoloConAlta((v) => !v)}>
          {soloConAlta ? "✓" : "○"} Solo mayoristas con alta aprobada
        </button>
        {hayFiltros && (
          <button className="enlace primario" style={{ marginLeft: "auto" }}
            onClick={() => { setPasilloId(null); setRubroId(null); setSubrubroId(null); setSoloConAlta(false); }}>
            Limpiar filtros
          </button>
        )}
      </div>

      {mensaje && <div className="aviso ok">{mensaje} <Link href="/compras">Ver carrito</Link></div>}
      {error && <div className="aviso err">{error}</div>}

      {cargando && productos.length === 0 ? (
        <p className="muted cat-vacio">Cargando catálogo…</p>
      ) : mostrados.length === 0 ? (
        <div className="cat-vacio">
          <div style={{ fontSize: 40 }}>🔍</div>
          <p className="muted">No hay productos disponibles.</p>
        </div>
      ) : vista === "lista" ? (
        <div className={`cat-lista${cargando ? " cargando" : ""}`}>
          {mostrados.map((p) => {
            const abierto = expandido === p.id;
            const oferta = mejorOferta(p);
            const conAlta = p.mayoristas.filter((m) => m.tiene_alta).length;
            return (
              <div key={p.id} className="cat-fila">
                <button className="cat-fila-cabeza" onClick={() => setExpandido(abierto ? null : p.id)}>
                  <div className="cat-foto chica"><Foto src={p.imagen_url} alt={p.nombre} /></div>
                  <div className="cat-fila-texto">
                    <strong>{p.nombre}</strong>
                    <span className="muted">
                      {[p.marca, p.ean && `EAN: ${p.ean}`, p.pasillo_nombre].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <div className="cat-fila-precio">
                    {oferta && <Precio pres={oferta} desde />}
                    <span className="muted">{cuantos(p.mayoristas.length)}{conAlta > 0 && ` · ${conAlta} con alta`}</span>
                  </div>
                  <span className="muted cat-flecha">{abierto ? "▲" : "▼"}</span>
                </button>
                {abierto && <Ofertas producto={p} enCarrito={enCarrito} onAgregar={agregar} />}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`cat-grilla ${vista === "grilla-chica" ? "chica" : "grande"}${cargando ? " cargando" : ""}`}>
          {mostrados.map((p) => {
            const oferta = mejorOferta(p);
            return (
              <button key={p.id} className="cat-tarjeta" onClick={() => setModal(p)}>
                <div className="cat-foto"><Foto src={p.imagen_url} alt={p.nombre} fallbackStyle={{ fontSize: 36 }} /></div>
                <div className="cat-tarjeta-texto">
                  <strong className="cat-dos-lineas">{p.nombre}</strong>
                  {p.marca && <span className="muted cat-una-linea">{p.marca}</span>}
                  {oferta ? <Precio pres={oferta} desde grande={vista === "grilla-grande"} />
                    : <span className="muted"><em>Consultar</em></span>}
                  <span className="muted">{cuantos(p.mayoristas.length)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!cargando && page < totalPages && (
        <div className="cat-mas">
          <button className="secondary" onClick={() => cargar(page + 1)} disabled={cargandoMas}>
            {cargandoMas ? "Cargando…" : "Cargar más productos"}
          </button>
        </div>
      )}

      {modal && (
        <div className="cat-modal-fondo" onClick={() => setModal(null)}>
          <div className="cat-modal" onClick={(e) => e.stopPropagation()}>
            {modal.imagen_url && <div className="cat-modal-foto"><Foto src={modal.imagen_url} alt={modal.nombre} /></div>}
            <div className="cat-modal-cuerpo">
              <div className="cat-modal-cabeza">
                <div>
                  <h2>{modal.nombre}</h2>
                  {modal.marca && <p className="muted">{modal.marca}</p>}
                  {modal.descripcion && <p className="cat-modal-desc">{modal.descripcion}</p>}
                </div>
                <button className="enlace" onClick={() => setModal(null)} aria-label="Cerrar">✕</button>
              </div>
              <Ofertas producto={modal} enCarrito={enCarrito} onAgregar={agregar} enTarjetas />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Unidades en el carrito por presentación del mayorista. */
function contarCarrito(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const l of loadCart()) r[l.presentacionId] = (r[l.presentacionId] ?? 0) + l.cantidad;
  return r;
}

function Precio({ pres, desde, grande }: { pres: B2BPresentacion; desde?: boolean; grande?: boolean }) {
  return (
    <span className={`cat-precio${grande ? " grande" : ""}`}>
      {desde && "desde "}{fmt(precioVisible(pres))} <small className="muted">{etiquetaPrecio(pres)}</small>
    </span>
  );
}

/** Los mayoristas que venden el producto, cada uno con sus presentaciones. */
function Ofertas({ producto, enCarrito, onAgregar, enTarjetas }: {
  producto: B2BProducto;
  enCarrito: Record<string, number>;
  onAgregar: (p: B2BProducto, l: B2BListing, pres: B2BPresentacion, cantidad: number) => void;
  enTarjetas?: boolean;
}) {
  return (
    <div className={enTarjetas ? "cat-ofertas tarjetas" : "cat-ofertas"}>
      {producto.mayoristas.map((m) => (
        <div key={m.listing_id} className="cat-oferta">
          <div className="cat-oferta-cabeza">
            <span className="cat-inicial">{m.mayorista_nombre.charAt(0)}</span>
            <strong>{m.mayorista_nombre}</strong>
            {m.tiene_alta
              ? <span className="badge ok">✓ Alta</span>
              : <span className="badge">Sin alta · <Link href="/mayoristas">pedila</Link></span>}
            {m.tiempo_entrega_dias != null && <span className="muted">🚚 {m.tiempo_entrega_dias}d</span>}
          </div>
          {m.presentaciones.map((pres) => (
            <FilaPresentacion key={pres.id} producto={producto} pres={pres} puede={m.tiene_alta}
              enCarrito={enCarrito[pres.id] ?? 0} onAgregar={(c) => onAgregar(producto, m, pres, c)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FilaPresentacion({ producto, pres, puede, enCarrito, onAgregar }: {
  producto: B2BProducto; pres: B2BPresentacion; puede: boolean; enCarrito: number; onAgregar: (cantidad: number) => void;
}) {
  const [cantidad, setCantidad] = useState(1);
  const sinStock = pres.stock === 0;
  // El de lista viene neto. Si B2B no manda su versión «a mostrar», tachar un
  // neto al lado de un final deja el tachado más barato que el precio.
  const lista = pres.precio_lista_mostrar ?? pres.precio_lista;
  const tachado = lista != null && lista > precioVisible(pres) ? lista : null;
  return (
    <div className="cat-pres">
      <div className="cat-pres-texto">
        <span>{pres.nombre}</span>
        <span className="muted">
          ×{pres.factor} {producto.unidad_base ?? "unidad"}{pres.ean_propio && ` · ${pres.ean_propio}`}
        </span>
        {tachado != null && <s className="muted">{fmt(tachado)}</s>}
        <Precio pres={pres} grande />
        {pres.stock != null && pres.stock > 0 && pres.stock < 10 && <span className="cat-ultimas">⚠️ Últimas {pres.stock} unidades</span>}
        {sinStock && <span className="cat-sin-stock">Sin stock</span>}
      </div>
      {puede && (
        <div className="cat-pres-acciones">
          {enCarrito > 0 && <span className="badge info">{enCarrito} en carrito</span>}
          <div className="cat-cantidad">
            <button onClick={() => setCantidad((c) => Math.max(1, c - 1))} aria-label="Uno menos">−</button>
            <span>{cantidad}</span>
            <button onClick={() => setCantidad((c) => c + 1)} aria-label="Uno más">+</button>
          </div>
          <button className="small" onClick={() => onAgregar(cantidad)} disabled={sinStock}>Agregar</button>
        </div>
      )}
    </div>
  );
}
