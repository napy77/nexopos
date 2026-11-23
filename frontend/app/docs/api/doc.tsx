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
  ["alta", "Dar de alta productos"],
  ["precios", "Escribir precios"],
  ["stock", "Escribir stock"],
  ["ventas", "Leer las ventas"],
  ["pedidos", "Pedidos de la tienda"],
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
            Si el comercio usa un ERP, Odoo o un sistema propio, puede dar de alta sus
            productos de a miles, leer su catálogo, escribir precios y stock, leer lo que
            se vendió en el mostrador y atender los pedidos de su tienda online — sin que
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

          <section id="alta">
            <h2>Dar de alta productos</h2>
            <p className="firma"><span className="verbo post">POST</span> /productos</p>
            <p>
              Hasta 5000 por llamada. Es lo mismo que subir un CSV desde NexoPOS
              (Productos → Integración API): los dos usan el mismo motor y terminan igual.
            </p>
            <Codigo lang="json">{`{
  "productos": [
    { "ean": "7790070507341", "precio_centavos": 399900, "costo_centavos": 199950,
      "stock": 12, "stock_minimo": 2 },
    { "nombre": "Tarta de verdura", "precio_centavos": 550000, "stock": 4 }
  ]
}`}</Codigo>
            <p>Cada producto termina en una de estas cosas:</p>
            <ul>
              <li><strong>Ya lo tenés</strong> (mismo EAN; sin EAN, mismo nombre): se le
                cambian precio, costo y stock.</li>
              <li><strong>Está en el catálogo de Nexo B2B</strong>: entra con su ficha —nombre,
                foto, rubro—. El nombre que mandes no se usa.</li>
              <li><strong>No está en ningún lado</strong>: se crea como producto propio del
                comercio con el <code>nombre</code> que mandaste, sin foto.</li>
              <li><strong>Error</strong>: un EAN que no está en Nexo B2B y sin nombre, un número
                que no se entiende, o el mismo producto dos veces en la misma llamada.</li>
            </ul>
            <p>
              Hace falta <code>ean</code> o <code>nombre</code>; lo demás es opcional, y lo que
              no mandes <strong>no se borra</strong>: queda lo que había. El{" "}
              <code>stock</code> <strong>reemplaza</strong> (es la carga inicial: lo que hay),
              así que mandar lo mismo dos veces no duplica nada. Para el día a día, usá{" "}
              <a href="#stock"><code>PUT /stock</code></a> con <code>ajuste</code>.
            </p>
            <p>
              <code>precio_centavos</code> es el precio de venta y nunca se calcula: sin él, el
              producto se carga pero no se vende ni sale en la tienda online.
            </p>

            <h3>Contesta enseguida y sigue en segundo plano</h3>
            <p>
              Buscar miles de fichas en Nexo B2B tarda unos minutos, más de lo que una conexión
              aguanta abierta. Por eso la respuesta es un <code>202</code> con un número:
            </p>
            <Codigo lang="json">{`{ "importacion_id": "41", "estado": "analizando" }`}</Codigo>
            <p className="firma"><span className="verbo get">GET</span> /importaciones/:id</p>
            <Codigo lang="json">{`{
  "importacion_id": "41",
  "estado": "aplicada",
  "total": 2000, "procesadas": 2000,
  "resumen": { "actualizar": 3, "vincular": 0, "crear_b2b": 1850,
               "crear_propio": 120, "error": 27, "sinPrecio": 0 },
  "error": null,
  "errores": [ { "fila": 14, "ean": "7799999999998", "nombre": "",
                 "motivo": "El EAN 7799999999998 no está en el catálogo de NexoB2B y la fila no tiene nombre para darlo de alta como propio." } ]
}`}</Codigo>
            <p>
              Preguntá cada unos segundos hasta que <code>estado</code> sea{" "}
              <code>aplicada</code> o <code>error</code>. Antes de eso no se escribió nada, y
              se aplica <strong>todo junto</strong>: no hay importaciones a medias. Las filas
              con error se saltean y vienen en <code>errores</code>, con el número de fila (la
              posición en tu lista, empezando en 1).
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
    "pedido_code": null,
    "lineas": [{
      "producto_id": 184, "ean": "7798042240180", "sku": null,
      "nombre": "Silla Plástica Voss 2000 — unidad",
      "cantidad": 2, "precio_centavos": 5200000
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
              de venta igual que una venta del mostrador. Esas traen{" "}
              <code>pedido_code</code> con el código del pedido; las del mostrador,{" "}
              <code>null</code>. Si tu sistema ya registró el pedido (ver{" "}
              <a href="#pedidos">Pedidos de la tienda</a>), salteá las ventas con{" "}
              <code>pedido_code</code> o las vas a contar dos veces.
            </p>
            <p>
              Un reembolso viene con <code>es_reembolso: true</code> y cantidades negativas:
              es una venta al revés, no un registro aparte que haya que interpretar. Si
              revierte la nota de un pedido, trae el <code>pedido_code</code> de ese pedido.
            </p>
            <p className="muted">
              Guardá las ventas por <code>id</code>: la última de una página puede volver
              a venir al principio de la siguiente.
            </p>
          </section>

          <section id="pedidos">
            <h2>Pedidos de la tienda</h2>
            <p>
              Para el comercio que atiende los pedidos de su tienda online (NexoTienda)
              desde la caja de su propio sistema. El pedido sigue viviendo en NexoPOS: tu
              sistema lo lee y lo mueve con la misma clave, y cada paso hace exactamente lo
              mismo que en la pantalla de Pedidos — descuenta el stock al aceptar, lo
              devuelve al cancelar, devuelve el pago de Mercado Pago, le avisa a la tienda y,
              al entregarlo, emite la nota de venta.
            </p>

            <p className="firma"><span className="verbo get">GET</span> /pedidos?actualizados_desde=</p>
            <Codigo>{`curl -s "${BASE}/pedidos?actualizados_desde=2026-11-23T00:00:00Z" \\
  -H "Authorization: Bearer npos_TU_CLAVE"`}</Codigo>
            <Codigo lang="json">{`{
  "pedidos": [{
    "code": "P-0962559F",
    "status": "recibido",
    "creado": "2026-11-23T20:41:00.123Z",
    "actualizado": "2026-11-23T20:41:00.123456Z",
    "retiro": { "tipo": "retiro", "franja": "Hoy 18 a 20 h", "direccion": null },
    "pago": { "medio": "efectivo_entrega", "estado": "no_aplica", "id": null },
    "contacto": { "nombre": "Ana Pérez", "telefono": "3515550000", "email": null },
    "cuenta_id": null,
    "notas": null,
    "listo_para": null,
    "motivo_cancelacion": null,
    "cancelado_por": null,
    "revision": null,
    "venta": null,
    "lineas": [{
      "producto_id": "5404", "ean": "7790580109882", "sku": null,
      "nombre": "Tableta Chocolate Extra Fino Aguila x 150 Grs — unidad",
      "unidad": "unidad", "cantidad": 1, "precio_centavos": 500000
    }],
    "subtotal_centavos": 500000,
    "cargo_centavos": 0,
    "total_centavos": 500000
  }],
  "hasta": "2026-11-23T20:39:00.000000Z",
  "hay_mas": false
}`}</Codigo>
            <ul>
              <li>Con <code>actualizados_desde</code>: los que cambiaron después de esa fecha,
                en <strong>cualquier estado</strong>, ordenados por <code>actualizado</code>, de
                a 200. Sin él: los que están en curso (<code>recibido</code>,{" "}
                <code>aceptado</code>, <code>listo</code>, <code>en_camino</code>), para la
                primera lectura.</li>
              <li>Guardá el <code>hasta</code> y mandalo como <code>actualizados_desde</code>{" "}
                la próxima vez. Queda <strong>dos minutos atrás</strong> a propósito, así que
                un pedido puede volver a venir: actualizalo por <code>code</code>, no lo
                agregues de nuevo. Sin ese margen, un cambio que todavía se estaba guardando
                cuando preguntaste se perdía.</li>
              <li><code>producto_id</code> es el <code>id</code> de{" "}
                <code>GET /productos</code>.</li>
              <li><code>status</code>: <code>recibido</code> → <code>aceptado</code> →{" "}
                <code>listo</code> → (<code>en_camino</code>, sólo reparto) →{" "}
                <code>entregado</code>. Se puede <code>cancelado</code> desde cualquiera
                antes de entregado.</li>
              <li><code>revision</code> viene mientras está <code>recibido</code> y el pedido
                pide que alguien lo mire antes de aceptarlo:{" "}
                <code>{`{ "motivo": "cuenta_nueva_monto_alto" }`}</code> (primer pedido de esa
                persona y grande: llamala antes de armarlo) o{" "}
                <code>identidad_no_disponible</code> (no se pudo comprobar su cuenta: confirmá
                con ella). No bloquea nada: mostralo y pedí confirmación antes de aceptar,
                como hace la pantalla.</li>
              <li><code>cuenta_id</code> (<code>CLI-…</code>) viene cuando compró con su
                cuenta; el <code>contacto</code> viene siempre que lo tengamos.{" "}
                <code>venta</code> es la nota de venta que salió al entregarlo.</li>
            </ul>

            <p className="firma"><span className="verbo get">GET</span> /pedidos/:code</p>
            <p>Uno solo, con la misma forma.</p>

            <h3>Mover un pedido</h3>
            <table>
              <thead><tr><th>Llamada</th><th>Cuerpo</th></tr></thead>
              <tbody>
                <tr><td><code>POST /pedidos/:code/aceptar</code></td><td><code>{`{ "listo_para": "30 minutos" }`}</code> — obligatorio: es lo que ve el comprador.</td></tr>
                <tr><td><code>POST /pedidos/:code/listo</code></td><td>—</td></tr>
                <tr><td><code>POST /pedidos/:code/en-camino</code></td><td>— (sólo reparto, después de listo)</td></tr>
                <tr><td><code>POST /pedidos/:code/entregado</code></td><td>— (después de listo o en camino)</td></tr>
                <tr><td><code>POST /pedidos/:code/cancelar</code></td><td><code>{`{ "motivo": "…" }`}</code> — texto libre, lo lee el comprador.</td></tr>
              </tbody>
            </table>
            <Codigo>{`curl -s -X POST "${BASE}/pedidos/P-0962559F/aceptar" \\
  -H "Authorization: Bearer npos_TU_CLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"listo_para":"30 minutos"}'`}</Codigo>
            <p>
              Contesta el pedido completo, con la misma forma que <code>GET /pedidos</code>.
            </p>
            <h3>Repetir no rompe nada</h3>
            <p>
              Si el pedido <strong>ya está</strong> en el estado que pedís, contesta{" "}
              <code>200</code> con el pedido y no hace nada más: no descuenta el stock dos
              veces ni avisa dos veces. Así podés reintentar tranquilo cuando se corta la
              red. Si el paso no corresponde (entregar uno cancelado, por ejemplo), es un{" "}
              <code>409</code> con el estado actual al lado:
            </p>
            <Codigo lang="json">{`{ "error": "Este pedido ya está entregado.", "code": "paso_invalido", "status": "entregado" }`}</Codigo>
          </section>

          <section id="errores">
            <h2>Errores</h2>
            <table>
              <tbody>
                <tr><td><code>401</code></td><td>Clave ausente, inválida o revocada.</td></tr>
                <tr><td><code>400</code></td><td>Faltan datos, o el cuerpo no tiene la forma esperada.</td></tr>
                <tr><td><code>404</code></td><td>Ese pedido no es de este comercio, o no existe.</td></tr>
                <tr><td><code>409</code></td><td>La operación choca con el estado actual. En pedidos trae <code>status</code>.</td></tr>
              </tbody>
            </table>
            <p>
              El cuerpo trae <code>{`{ "error": "…" }`}</code> con un mensaje escrito para
              leerse: dice qué falta. Si lo vas a mostrar en tu sistema, mostralo tal cual —
              está pensado para que lo entienda quien tiene que arreglarlo. Para decidir
              algo, usá el <code>code</code> cuando venga, no el texto: el texto lo podemos
              mejorar.
            </p>
          </section>

          <section id="falta">
            <h2>Lo que todavía no hay</h2>
            <p>
              Lo decimos para que no lo busques: no está, no es que lo estés haciendo mal.
            </p>
            <ul>
              <li>
                <strong>Webhooks hacia tu sistema.</strong> Hoy tenés que preguntar por{" "}
                <code>/ventas</code> y <code>/pedidos</code>. Para pedidos, una vez por minuto
                alcanza.
              </li>
            </ul>
            <p>
              Si lo necesitás, escribinos: es el paso siguiente natural y saber que hace
              falta cambia el orden.
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
