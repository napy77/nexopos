import type { Metadata } from "next";
import Link from "next/link";
import Acceso from "./acceso";
import { NEXOB2B_REGISTRO_URL } from "@/lib/sitio";
import "./site.css";

export const metadata: Metadata = {
  title: "NexoPOS — Punto de venta gratis para tu comercio",
  description:
    "El punto de venta gratuito que conecta tu almacén con mayoristas: vendé en el mostrador, controlá el stock, llevá la libreta de tus clientes y reponé sin salir de la caja.",
};

// Todo lo que se promete acá tiene que estar andando (ver docs/CURRENT_STATE.md).
// Un sitio que anuncia lo que todavía no hay le vende humo al comercio.
const FUNCIONES = [
  {
    icono: "🧾",
    titulo: "Mostrador y caja",
    texto:
      "Vendé desde cualquier computadora o tablet. Tickets en la ticketera, productos por peso, reembolsos y arqueo de caja por forma de pago.",
  },
  {
    icono: "📦",
    titulo: "Stock al día",
    texto:
      "Sumá productos desde el catálogo unificado de NexoB2B, sin tipearlos. Recepción de compras, ajustes, productos propios con foto e importación de tu catálogo con costo y stock.",
  },
  {
    icono: "🚚",
    titulo: "Reponé con tus mayoristas",
    texto:
      "Compralé la reposición a tus mayoristas de NexoB2B sin salir de la caja, con la lista de precios que te corresponde.",
  },
  {
    icono: "📈",
    titulo: "Márgenes automáticos",
    texto:
      "Precios calculados desde el costo por producto, rubro o pasillo, con el IVA sumado y redondeo hacia arriba. Lo que ponés a mano no se pisa.",
  },
  {
    icono: "📒",
    titulo: "Cuenta corriente",
    texto:
      "La libreta de tus clientes: cierre y vencimiento, límite de crédito, pagos imputados del más viejo al más nuevo y resúmenes.",
  },
  {
    icono: "🛒",
    titulo: "Tienda online",
    texto:
      "Tu tienda en NexoTienda con los mismos productos, precios y stock del mostrador. Los pedidos te llegan al panel.",
  },
  {
    icono: "💳",
    titulo: "Cobros y beneficios",
    texto:
      "Cobro con Mercado Pago por QR y descuentos para socios de clubes con ClubPay, aplicados en el mostrador.",
  },
  {
    icono: "🔌",
    titulo: "Conectado a tu ERP",
    texto:
      "Una API documentada para que tu sistema de gestión lea y actualice productos, con claves propias para cada comercio.",
  },
];

const PASOS = [
  {
    titulo: "Creá tu cuenta en NexoB2B",
    texto: "Cargás los datos de tu comercio. Es gratis y es la misma cuenta con la que vas a comprarles a los mayoristas.",
  },
  {
    titulo: "Esperá la aprobación",
    texto: "Revisamos la solicitud y te avisamos por email cuando tu cuenta está activa.",
  },
  {
    titulo: "Activá NexoPOS",
    texto: "En tu perfil de NexoB2B, en Integraciones, tocás «Activar cuenta» en la tarjeta de NexoPOS.",
  },
  {
    titulo: "Ingresá y vendé",
    texto: "Entrás a NexoPOS con el mismo email y contraseña y sumás tus productos desde el catálogo.",
  },
];

const PREGUNTAS = [
  {
    p: "¿Cuánto cuesta?",
    r: "Nada. NexoPOS es gratis para los comercios dados de alta en NexoB2B.",
  },
  {
    p: "¿Por qué tengo que crear la cuenta en NexoB2B?",
    r: "Porque NexoPOS no tiene alta propia: tu comercio, tu catálogo y tus mayoristas viven en NexoB2B. Una sola cuenta te sirve para vender en el mostrador y para comprar la reposición.",
  },
  {
    p: "¿Qué necesito para usarlo?",
    r: "Una computadora o tablet con navegador e internet. Si querés imprimir tickets, una ticketera de 80 mm o 58 mm.",
  },
  {
    p: "Ya tengo cuenta en NexoB2B. ¿Qué hago?",
    r: "Tocá «Ingresar» arriba y usá el mismo email y contraseña de NexoB2B.",
  },
];

export default function Sitio() {
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-container site-header-in">
          <Link href="/" className="site-logo">
            Nexo<span>POS</span>
          </Link>
          <nav className="site-nav">
            <a href="#funciones">Funciones</a>
            <a href="#como-empezar">Cómo empezar</a>
            <a href="#preguntas">Preguntas</a>
          </nav>
          <Acceso />
        </div>
      </header>

      <main>
        <section className="site-hero">
          <div className="site-container">
            <p className="site-tag">Gratis para comercios de NexoB2B</p>
            <h1>El punto de venta que conecta tu comercio con tus mayoristas</h1>
            <p className="site-lead">
              Vendé en el mostrador, controlá el stock, llevá la libreta de tus clientes y reponé
              mercadería sin salir de la caja. Todo desde el navegador.
            </p>
            <Acceso grande />
            <p className="site-nota">
              ¿Ya tenés cuenta en NexoB2B? Ingresá con el mismo email y contraseña.
            </p>
          </div>
        </section>

        <section id="funciones" className="site-section">
          <div className="site-container">
            <h2>Todo lo que necesita el mostrador</h2>
            <p className="site-sub">Pensado para almacenes, autoservicios y comercios de barrio.</p>
            <div className="site-grid">
              {FUNCIONES.map((f) => (
                <article key={f.titulo} className="site-card">
                  <span className="site-icono" aria-hidden>
                    {f.icono}
                  </span>
                  <h3>{f.titulo}</h3>
                  <p>{f.texto}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section site-ecosistema">
          <div className="site-container site-eco-in">
            <div>
              <h2>Parte del ecosistema Nexo</h2>
              <p>
                NexoPOS trabaja con <strong>NexoB2B</strong>, el marketplace donde los comercios les
                compran a los mayoristas con un catálogo unificado. Lo que comprás entra a tu stock y
                lo que vendés en el mostrador o en tu tienda online sale del mismo lugar.
              </p>
            </div>
            <ul className="site-eco-lista">
              <li><strong>NexoB2B</strong> — tu cuenta, tu catálogo y tus mayoristas.</li>
              <li><strong>NexoPOS</strong> — el mostrador, el stock y la libreta.</li>
              <li><strong>NexoTienda</strong> — tu tienda online.</li>
              <li><strong>ClubPay</strong> — beneficios para socios de clubes.</li>
            </ul>
          </div>
        </section>

        <section id="como-empezar" className="site-section">
          <div className="site-container">
            <h2>Cómo empezar</h2>
            <p className="site-sub">La cuenta se crea en NexoB2B y desde ahí se activa NexoPOS.</p>
            <ol className="site-pasos">
              {PASOS.map((p, i) => (
                <li key={p.titulo}>
                  <span className="site-paso-n">{i + 1}</span>
                  <h3>{p.titulo}</h3>
                  <p>{p.texto}</p>
                </li>
              ))}
            </ol>
            <div className="site-centro">
              <a href={NEXOB2B_REGISTRO_URL} className="site-btn site-btn-primary site-btn-lg">
                Crear mi cuenta en NexoB2B
              </a>
            </div>
          </div>
        </section>

        <section id="preguntas" className="site-section site-alt">
          <div className="site-container site-angosto">
            <h2>Preguntas frecuentes</h2>
            {PREGUNTAS.map((q) => (
              <details key={q.p} className="site-faq">
                <summary>{q.p}</summary>
                <p>{q.r}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="site-cta">
          <div className="site-container">
            <h2>Abrí la caja hoy</h2>
            <p>Creá tu cuenta gratis en NexoB2B y activá NexoPOS desde tu perfil.</p>
            <Acceso grande />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-container site-footer-in">
          <span>
            Nexo<strong>POS</strong> · un producto de Linware
          </span>
          <nav>
            <Link href="/login">Ingresar</Link>
            <a href={NEXOB2B_REGISTRO_URL}>Crear cuenta</a>
            <a href="https://nexob2b.app">NexoB2B</a>
            <Link href="/docs/api">API para ERP</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
