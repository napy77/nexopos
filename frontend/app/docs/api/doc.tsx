"use client";

import { useEffect, useState } from "react";
import "./docs.css";

/**
 * Escrita para que alguien la lea de arriba abajo una vez y después vuelva a
 * buscar cosas sueltas. Por eso: arranque que funciona en dos minutos primero,
 * referencia después, y la trampa del stock con su propio lugar —es la única
 * parte donde equivocarse cuesta plata, y un párrafo más entre otros veinte no
 * la iba a salvar—.
 */

const BASE = "https://nexopos.app/api/erp/v1";

function Codigo({ children, lang = "bash" }: { children: string; lang?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="bloque">
      <button
        className="copiar"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1800);
          } catch {
            window.prompt("Copiá:", children);
          }
        }}
      >
        {copiado ? "✓ copiado" : "copiar"}
      </button>
      <pre data-lang={lang}><code>{children}</code></pre>
    </div>
  );
}

const SECCIONES = [
  ["empezar", "Empezar"],
  ["clave", "La clave"],
  ["convenciones", "Convenciones"],
  ["productos", "Leer el catálogo"],
  ["precios", "Escribir precios"],
  ["stock", "Escribir stock"],
  ["ventas", "Leer las ventas"],
  ["errores", "Errores"],
  ["falta", "Lo que todavía no hay"],
] as const;

export function Doc() {
  const [activa, setActiva] = useState<string>("empezar");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entradas) => {
        const visible = entradas.filter((e) => e.isIntersecting)[0];
        if (visible) setActiva(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    for (const [id] of SECCIONES) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  return (
    <div className="doc">
      <header>
        <div className="marca">Nexo<span>POS</span></div>
        <div className="sub">Documentación de la API</div>
      </header>

      <div className="cuerpo">
        <nav>
          {SECCIONES.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={activa === id ? "activa" : ""}>
              {label}
            </a>
          ))}
          <div className="nota">
            ¿Dudas? Escribinos a <a href="mailto:soporte@nexopos.app">soporte@nexopos.app</a>
          </div>
        </nav>

        <main>
          <h1>Conectá tu sistema con NexoPOS</h1>
          <p className="entrada">
            Si el comercio usa un ERP, Odoo o un sistema propio, puede leer su catálogo,
            escribir precios y stock, y leer lo que se vendió en el mostrador — sin que
            nadie tenga que cargar nada a mano en la pantalla del POS.
          </p>

          <section id="empezar">
            <h2>Empezar</h2>
            <p>
              Tres pasos. El primero lo hace el comerciante; los otros dos, quien programe.
            </p>
            <ol className="pasos">
              <li>
                <strong>El comerciante genera una clave</strong> en NexoPOS →
                Configuración → <em>Conectar tu sistema</em>. Le pone un nombre para
                saber cuál es y la copia. Se muestra una sola vez.
              </li>
              <li>
                <strong>Probá que llega.</strong> Si esto devuelve tus productos, está todo
                bien:
              </li>
            </ol>
            <Codigo>{`curl -s "${BASE}/productos" \\
  -H "Authorization: Bearer npos_TU_CLAVE"`}</Codigo>
            <ol className="pasos" start={3}>
              <li>
                <strong>Escribí un precio</strong> y miralo en el POS. Con eso ya sabés que
                el circuito completo funciona.
              </li>
            </ol>
            <Codigo>{`curl -s -X PUT "${BASE}/precios" \\
  -H "Authorization: Bearer npos_TU_CLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"precios":[{"ean":"7798042240180","precio_centavos":5200000}]}'`}</Codigo>
            <p className="muted">
              Base de todas las llamadas: <code>{BASE}</code>
            </p>
          </section>

          <section id="clave">
            <h2>La clave</h2>
            <Codigo>{`Authorization: Bearer npos_xxxxxxxxxxxxxxxxxxxxxxxx`}</Codigo>
            <p>
              Es <strong>de un comercio</strong>: abre ese y ninguno más. Si se filtra, el
              alcance del daño es ese negocio y no la plataforma.
            </p>
            <p>
              <strong>Se muestra una sola vez.</strong> De nuestra base sale solo un hash,
              así que no hay forma de recuperarla — ni nosotros podemos. Si se pierde, el
              comerciante genera otra y revoca la anterior.
            </p>
            <p className="aparte">
              Es incómodo a propósito. Una clave que se puede recuperar es una clave que
              alguien puede ir a buscar a un backup, a un dump o a una consulta de soporte.
            </p>
            <p>
              El comerciante ve cuándo se usó cada clave por última vez y puede revocarla
              cuando quiera. Revocada, la siguiente llamada devuelve <code>401</code>.
            </p>
          </section>

          <section id="convenciones">
            <h2>Convenciones</h2>
            <h3>Los importes van en centavos, enteros</h3>
            <p>
              <code>$52.000</code> es <code>5200000</code>. Nunca decimales: un float
              arrastrando medio centavo por 3000 productos termina en una diferencia que
              después nadie encuentra.
            </p>

            <h3>Cómo se identifica un producto</h3>
            <p>Cada línea que escribís lleva <strong>una</strong> de estas tres:</p>
            <table>
              <tbody>
                <tr><td><code>ean</code></td><td>El código de barras. Es lo normal.</td></tr>
                <tr><td><code>sku</code></td><td>El código de balanza, si el comercio lo usa.</td></tr>
                <tr><td><code>id</code></td><td>El id de NexoPOS, que sale de <code>GET /productos</code>.</td></tr>
              </tbody>
            </table>
            <p>
              Si un EAN aparece en dos productos del mismo comercio, esa línea{" "}
              <strong>no se aplica</strong> y vuelve en <code>no_encontrados</code>. No
              adivinamos cuál era.
            </p>

            <h3>Nada se cachea</h3>
            <p>
              El stock cambia con cada venta del mostrador. Un catálogo de hace cinco
              minutos vende lo que ya no está.
            </p>
          </section>

          <section id="productos">
            <h2>Leer el catálogo</h2>
            <p className="firma"><span className="verbo get">GET</span> /productos</p>
            <p>Todo lo que el comercio tiene, paginado de a 500.</p>
            <Codigo lang="json">{`{
  "productos": [{
    "id": "184",
    "ean": "7798042240180",
    "sku": null,
    "nombre": "Silla Plástica Voss 2000 — unidad",
    "unidad": "unidad",
    "precio_centavos": 5200000,
    "costo_centavos": 3000000,
    "stock": 17,
    "stock_minimo": 0,
    "es_insumo": false,
    "publicado_en_tienda": true,
    "actualizado": "2026-09-15T03:28:00.000Z"
  }],
  "page": 1, "pageSize": 500, "total": 3
}`}</Codigo>
            <p>
              <code>precio_centavos: null</code> es un producto <strong>sin precio de
              venta</strong>: no se puede cobrar en el mostrador ni aparece en la tienda
              online hasta que tenga uno. Es lo que pasa, por ejemplo, con un catálogo
              recién importado.
            </p>
          </section>

          <section id="precios">
            <h2>Escribir precios</h2>
            <p className="firma"><span className="verbo put">PUT</span> /precios</p>
            <p>Hasta 1000 por llamada.</p>
            <Codigo lang="json">{`{
  "precios": [
    { "ean": "7798042240180", "precio_centavos": 5200000, "costo_centavos": 3000000 }
  ]
}`}</Codigo>
            <Codigo lang="json">{`{ "aplicados": 1, "no_encontrados": [] }`}</Codigo>
            <p>
              El costo es opcional: si no va, queda el que estaba. El precio de venta es el
              único número que tu sistema puede pisar sin pensarlo, porque no hay nadie más
              escribiéndolo. Con el stock no pasa lo mismo.
            </p>
          </section>

          <section id="stock">
            <h2>Escribir stock</h2>
            <p className="firma"><span className="verbo put">PUT</span> /stock</p>
            <Codigo lang="json">{`{
  "modo": "ajuste",
  "stock": [ { "ean": "7798042240180", "cantidad": 5 } ]
}`}</Codigo>
            <table>
              <thead><tr><th>modo</th><th>Qué hace</th></tr></thead>
              <tbody>
                <tr>
                  <td><code>ajuste</code> <span className="chip">default</span></td>
                  <td>Suma o resta. <code>-2</code> saca dos.</td>
                </tr>
                <tr>
                  <td><code>absoluto</code></td>
                  <td>Deja el stock en ese número.</td>
                </tr>
              </tbody>
            </table>

            <div className="alerta">
              <h3>Elegir mal acá cuesta plata. Mirá el ejemplo.</h3>
              <p>
                Tu sistema sincroniza a las 14:00 y ve <strong>12 unidades</strong>. A las
                14:30 el cajero vende 3 y quedan <strong>9</strong>. A las 15:00 volvés a
                sincronizar con el número que vos tenés:
              </p>
              <table className="comparacion">
                <tbody>
                  <tr>
                    <td><code>absoluto</code> → «dejalo en 12»</td>
                    <td className="mal">el stock vuelve a 12</td>
                  </tr>
                  <tr>
                    <td><code>ajuste</code> → «sumá 0»</td>
                    <td className="bien">el stock queda en 9</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Con <code>absoluto</code> <strong>reaparecieron tres unidades que ya no
                están</strong>. El mostrador las va a vender de nuevo y no van a estar en
                el depósito. Con <code>ajuste</code> eso no puede pasar, porque no
                reescribe: acumula sobre lo que haya.
              </p>
            </div>

            <h3>Cuándo usar cada uno</h3>
            <ul>
              <li>
                <strong><code>ajuste</code> para el día a día.</strong> Entró mercadería,
                sumás lo que entró. Es el único seguro cuando el mostrador también vende.
              </li>
              <li>
                <strong><code>absoluto</code> solo cuando tu número es la verdad
                completa</strong>: justo después de un inventario físico, o si el POS no
                vende nada de ese producto.
              </li>
            </ul>
            <p>
              Y si tu sistema quiere llevar el stock él mismo,{" "}
              <a href="#ventas">tiene que leer las ventas del mostrador</a>. La venta del
              cajero no pasa por tu ERP: pasa por acá.
            </p>
            <p className="muted">
              Cada escritura deja un movimiento de tipo <code>erp</code> con{" "}
              <strong>lo que cambió</strong>, no con lo que quedó, así la suma de los
              movimientos sigue dando el stock.
            </p>
          </section>

          <section id="ventas">
            <h2>Leer las ventas</h2>
            <p className="firma"><span className="verbo get">GET</span> /ventas?desde=</p>
            <Codigo>{`curl -s "${BASE}/ventas?desde=2026-09-15T00:00:00Z" \\
  -H "Authorization: Bearer npos_TU_CLAVE"`}</Codigo>
            <Codigo lang="json">{`{
  "ventas": [{
    "id": "1", "ticket": 1,
    "fecha": "2026-09-15T03:28:32.005Z",
    "total_centavos": 10400000,
    "medio_pago": "cash",
    "es_reembolso": false,
    "lineas": [{
      "producto_id": 184, "ean": "7798042240180", "sku": null,
      "nombre": "Silla Plástica Voss 2000 — unidad",
      "cantidad": "2.000", "precio_centavos": 5200000
    }]
  }],
  "hasta": "2026-09-15T03:28:32.005Z",
  "hay_mas": false
}`}</Codigo>
            <h3>Cómo paginar</h3>
            <p>
              Guardá el <code>hasta</code> y mandalo como <code>desde</code> en la próxima
              llamada. Mientras <code>hay_mas</code> sea <code>true</code>, seguí pidiendo.
            </p>
            <p>
              Incluye los pedidos de la tienda online entregados, porque terminan como nota
              de venta igual que una venta del mostrador. Un reembolso viene con{" "}
              <code>es_reembolso: true</code> y cantidades negativas: es una venta al revés,
              no un registro aparte que haya que interpretar.
            </p>
          </section>

          <section id="errores">
            <h2>Errores</h2>
            <table>
              <tbody>
                <tr><td><code>401</code></td><td>Clave ausente, inválida o revocada.</td></tr>
                <tr><td><code>400</code></td><td>Faltan datos, o el cuerpo no tiene la forma esperada.</td></tr>
                <tr><td><code>409</code></td><td>La operación choca con el estado actual.</td></tr>
              </tbody>
            </table>
            <p>
              El cuerpo trae <code>{`{ "error": "…" }`}</code> con un mensaje escrito para
              leerse: dice qué falta. Si lo vas a mostrar en tu sistema, mostralo tal cual —
              está pensado para que lo entienda quien tiene que arreglarlo.
            </p>
          </section>

          <section id="falta">
            <h2>Lo que todavía no hay</h2>
            <p>
              Lo decimos para que no lo busques: no está, no es que lo estés haciendo mal.
            </p>
            <ul>
              <li>
                <strong>Crear productos desde la API.</strong> Hoy entran desde el catálogo
                de Nexo B2B o se crean en el POS.
              </li>
              <li>
                <strong>Webhooks hacia tu sistema.</strong> Hoy tenés que preguntar por{" "}
                <code>/ventas</code>.
              </li>
            </ul>
            <p>
              Si necesitás alguna de las dos, escribinos: las dos son el paso siguiente
              natural y saber que hacen falta cambia el orden.
            </p>
          </section>

          <footer>
            NexoPOS · <a href="https://nexopos.app">nexopos.app</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
