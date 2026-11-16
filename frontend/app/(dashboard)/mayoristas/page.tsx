"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Foto } from "@/lib/foto";
import type { B2BMayorista } from "@/lib/b2b-types";

/*
 * «Descubrí mayoristas», igual que en el portal del comercio de NexoB2B
 * (PARA-NEXOPOS-DESCUBRIR-MAYORISTAS.md): el comerciante tiene que ver los
 * mismos mayoristas, en el mismo orden y con la misma cara en los dos lados.
 * Las equivalencias de rubros y el resguardo sin rubros los hace el backend.
 */

const ESTADO_SOLICITUD: Record<string, { label: string; cls: string }> = {
  aceptado: { label: "Habilitado", cls: "ok" },
  pendiente: { label: "Solicitud pendiente", cls: "warn" },
  rechazado: { label: "Rechazado", cls: "err" },
};

const RADIOS = [
  { value: 25, label: "25 km" },
  { value: 50, label: "50 km" },
  { value: 100, label: "100 km" },
  { value: 200, label: "200 km" },
  { value: 9999, label: "Todo el país" },
];

type Orden = "cercania" | "productos" | "nombre";

type Meta = {
  tieneUbicacion: boolean;
  radioKm: number;
  rubros: string[];
  rubrosSugeridos: string[];
  sinDeSusRubros: boolean;
  rubrosDisponibles: string[];
  perfilUrl: string;
};

const mismos = (a: string[], b: string[]) => [...a].sort().join("|") === [...b].sort().join("|");

export default function MayoristasPage() {
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [radioKm, setRadioKm] = useState(50);
  // null = todavía no eligió: el backend aplica los de su tipo de comercio.
  const [rubros, setRubros] = useState<string[] | null>(null);
  const [orden, setOrden] = useState<Orden>("cercania");
  const [mayoristas, setMayoristas] = useState<B2BMayorista[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [solicitando, setSolicitando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const pedidoActual = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(texto.trim()), 400);
    return () => clearTimeout(t);
  }, [texto]);

  const load = useCallback(async () => {
    // Numerado: una respuesta vieja que llega tarde no pisa la última.
    const nro = ++pedidoActual.current;
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams({ radio_km: String(radioKm) });
      if (rubros !== null) params.set("rubros", rubros.join(","));
      if (busqueda) params.set("busqueda", busqueda);
      const data = await api<{ mayoristas: B2BMayorista[]; meta: Meta }>(`/api/mayoristas/descubrir?${params}`);
      if (nro !== pedidoActual.current) return;
      setMayoristas(data.mayoristas);
      setMeta(data.meta);
    } catch (err) {
      if (nro === pedidoActual.current) setError(err instanceof Error ? err.message : "No se pudieron traer los mayoristas");
    } finally {
      if (nro === pedidoActual.current) setCargando(false);
    }
  }, [radioKm, rubros, busqueda]);

  useEffect(() => { load(); }, [load]);

  const activos = rubros ?? meta?.rubros ?? [];
  const sugeridos = meta?.rubrosSugeridos ?? [];

  function toggleRubro(r: string) {
    setRubros(activos.includes(r) ? activos.filter((x) => x !== r) : [...activos, r]);
  }

  async function pedirAlta(m: B2BMayorista) {
    setError("");
    setSolicitando(m.id);
    try {
      await api("/api/mayoristas/solicitudes", {
        method: "POST",
        body: JSON.stringify({ mayoristaId: m.id, mensaje: "" }),
      });
      setOk(`Le pediste el alta a ${m.nombre}. Te avisan cuando la acepte.`);
      setTimeout(() => setOk(""), 5000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo pedir el alta");
    } finally {
      setSolicitando(null);
    }
  }

  const ordenar = (lista: B2BMayorista[]) =>
    orden === "productos" ? [...lista].sort((a, b) => (b.productos_count ?? 0) - (a.productos_count ?? 0))
      : orden === "nombre" ? [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        : lista; // «Más cerca» es el orden en que los manda B2B
  const conDistancia = ordenar(mayoristas.filter((m) => m.distancia_km != null));
  const sinDistancia = ordenar(mayoristas.filter((m) => m.distancia_km == null));
  const zona = radioKm === 9999 ? "todo el país" : `${radioKm} km`;
  const tarjeta = (m: B2BMayorista) => (
    <TarjetaMayorista key={m.id} m={m} onPedirAlta={() => pedirAlta(m)} pidiendo={solicitando === m.id} />
  );

  return (
    <div className="descubrir">
      <div className="descubrir-titulo">
        <div>
          <h1>Descubrí mayoristas</h1>
          <p className="muted">Proveedores de la red Nexo B2B. Mirá su catálogo y pedí el alta para comprarles.</p>
        </div>
        {!cargando && <span className="muted">{mayoristas.length} encontrados</span>}
      </div>

      <div className="descubrir-buscador">
        <input
          type="search"
          placeholder="🔍  Buscar por nombre, rubro o ciudad…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setBusqueda(texto.trim()); }}
        />
        <label className="muted">
          Ordenar
          <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
            <option value="cercania">Más cerca</option>
            <option value="productos">Más productos</option>
            <option value="nombre">A a Z</option>
          </select>
        </label>
      </div>

      {meta && (
        <>
          <div className="pildoras">
            {meta.tieneUbicacion ? (
              <>
                <span className="pildora ubicacion">📍 Cerca tuyo</span>
                {RADIOS.map((r) => (
                  <button key={r.value} className={`pildora${radioKm === r.value ? " activa" : ""}`}
                    onClick={() => setRadioKm(r.value)}>
                    {r.label}
                  </button>
                ))}
              </>
            ) : (
              <a className="pildora sin-ubicacion" href={meta.perfilUrl} target="_blank" rel="noreferrer">
                ⚠️ Configurar ubicación
              </a>
            )}
          </div>

          <div className="pildoras">
            <span className="muted pildoras-rotulo">Qué vende:</span>
            {meta.rubrosDisponibles.map((r) => (
              <button key={r} className={`pildora rubro${activos.includes(r) ? " activa" : ""}`} onClick={() => toggleRubro(r)}>
                {r}{activos.includes(r) ? " ✓" : ""}
              </button>
            ))}
            {activos.length > 0 && (
              <button className="enlace" onClick={() => setRubros([])}>Todos los rubros</button>
            )}
            {sugeridos.length > 0 && !mismos(activos, sugeridos) && (
              <button className="enlace primario" onClick={() => setRubros(sugeridos)}>Volver a mis rubros</button>
            )}
          </div>

          {meta.sinDeSusRubros && !cargando && (
            <div className="aviso warn">
              No encontramos mayoristas de tus rubros en {zona}. Te mostramos todos los de la zona.
            </div>
          )}
          {!meta.tieneUbicacion && (
            <div className="aviso warn">
              <strong>📍 Configurá tu ubicación para ver mayoristas cerca tuyo.</strong>{" "}
              Se carga en <a href={meta.perfilUrl} target="_blank" rel="noreferrer">tu perfil de NexoB2B</a>,
              sección «Ubicación en el mapa».
            </div>
          )}
        </>
      )}

      {ok && <div className="aviso ok">{ok}</div>}
      {error && <div className="aviso err">{error}</div>}

      {cargando && mayoristas.length === 0 ? (
        <div className="descubrir-grilla">
          {[1, 2, 3].map((i) => <div key={i} className="tarjeta-may esqueleto" />)}
        </div>
      ) : mayoristas.length === 0 && !error ? (
        <div className="descubrir-vacio">
          <div style={{ fontSize: 40 }}>🏭</div>
          <h3>No hay mayoristas en esta búsqueda</h3>
          <p className="muted">
            {meta?.tieneUbicacion
              ? `Ningún mayorista en ${zona}${activos.length ? " con los rubros elegidos" : ""}.`
              : "Todavía no hay mayoristas con estos filtros."}
          </p>
          {meta?.tieneUbicacion && radioKm < 9999 && (
            <button onClick={() => setRadioKm(RADIOS.find((r) => r.value > radioKm)?.value ?? 9999)}>
              Ampliar radio de búsqueda →
            </button>
          )}
        </div>
      ) : (
        <div className={`descubrir-grilla${cargando ? " cargando" : ""}`}>
          {conDistancia.map(tarjeta)}
          {conDistancia.length > 0 && sinDistancia.length > 0 && (
            <div className="descubrir-corte"><span>Sin ubicación cargada</span></div>
          )}
          {sinDistancia.map(tarjeta)}
        </div>
      )}
    </div>
  );
}

/** Un color fijo por mayorista para la cabecera cuando no subió portada. */
const FONDOS = [
  "linear-gradient(90deg, #3b82f6, #6366f1)",
  "linear-gradient(90deg, #10b981, #0d9488)",
  "linear-gradient(90deg, #f59e0b, #f97316)",
  "linear-gradient(90deg, #ec4899, #f43f5e)",
  "linear-gradient(90deg, #8b5cf6, #a855f7)",
  "linear-gradient(90deg, #06b6d4, #0ea5e9)",
];
function fondoDe(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FONDOS[h % FONDOS.length];
}

function distancia(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`;
}

function TarjetaMayorista({ m, onPedirAlta, pidiendo }: {
  m: B2BMayorista; onPedirAlta: () => void; pidiendo: boolean;
}) {
  const [sinPortada, setSinPortada] = useState(false);
  const estado = m.solicitud ? ESTADO_SOLICITUD[m.solicitud.estado] : null;
  const muestras = m.muestras ?? [];
  const lugar = [m.ciudad, m.provincia].filter(Boolean).join(", ");
  const catalogo = `/catalogo?mayorista_id=${encodeURIComponent(m.id)}`;
  const puedePedir = !m.solicitud || m.solicitud.estado === "rechazado";

  return (
    <div className="tarjeta-may">
      <div className="tarjeta-may-portada" style={{ background: fondoDe(m.id) }}>
        {m.portada_url && !sinPortada && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.portada_url} alt="" onError={() => setSinPortada(true)} />
        )}
        {m.distancia_km != null && <span className="tarjeta-may-distancia">📍 {distancia(m.distancia_km)}</span>}
        <div className="tarjeta-may-logo">
          <Foto src={m.logo_url} alt={m.nombre} fallback={m.nombre.trim().charAt(0).toUpperCase() || "?"}
            fallbackStyle={{ fontSize: 26, fontWeight: 700, color: "var(--text)" }} />
        </div>
      </div>

      <div className="tarjeta-may-cuerpo">
        <div className="tarjeta-may-cabeza">
          <Link href={catalogo} className="tarjeta-may-nombre">{m.nombre}</Link>
          {estado && <span className={`badge ${estado.cls}`}>{estado.label}</span>}
        </div>
        <p className="muted tarjeta-may-sub">{[m.rubros[0], lugar].filter(Boolean).join(" · ")}</p>
        {(m.productos_count ?? 0) > 0 && (
          <p className="muted tarjeta-may-productos">{m.productos_count} productos publicados</p>
        )}

        {muestras.length > 0 ? (
          <div className="tarjeta-may-muestras">
            {muestras.slice(0, 3).map((f) => (
              <div key={f.imagen_url} title={f.nombre}>
                <Foto src={f.imagen_url} alt={f.nombre} />
              </div>
            ))}
          </div>
        ) : m.descripcion ? (
          <p className="muted tarjeta-may-descripcion">{m.descripcion}</p>
        ) : null}

        {/* Lo que el portal no muestra y el mostrador sí necesita: a quién
            llamar para un pedido, una vez que ya puede comprarle. */}
        {m.solicitud?.estado === "aceptado" && m.contacto && (
          <p className="muted tarjeta-may-contacto">
            {m.contacto.es_vendedor ? "Vendedor: " : "Contacto: "}
            <strong>{m.contacto.nombre}</strong>
            {m.contacto.celular && <> · <a href={`https://wa.me/${m.contacto.celular.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{m.contacto.celular}</a></>}
          </p>
        )}

        <div className="tarjeta-may-acciones">
          <Link href={catalogo} className="boton secundario">Ver catálogo</Link>
          {puedePedir && (
            <button onClick={onPedirAlta} disabled={pidiendo}>{pidiendo ? "Pidiendo…" : "Pedir alta"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
