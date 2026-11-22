import type { Metadata } from "next";
import Link from "next/link";
import "../site.css";

export const metadata: Metadata = {
  title: "Eliminar mi cuenta · NexoPOS",
  description: "Cómo pedir la baja de tu comercio en NexoPOS y qué datos se borran.",
};

// Es la URL que se declara en «Seguridad de los datos» de Google Play. Sigue la
// misma forma que nexob2b.app/eliminar-cuenta para que el comerciante encuentre
// lo mismo en los dos lados. No hay baja desde la app: la cuenta es de NexoB2B y
// el alta no ocurre en NexoPOS, así que la baja de los datos del POS es por mail.
const CONTACTO = "soporte@nexopos.app";
const BAJA_NEXOB2B = "https://nexob2b.app/eliminar-cuenta/";

export default function EliminarCuenta() {
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-container site-header-in">
          <Link href="/" className="site-logo">
            Nexo<span>POS</span>
          </Link>
        </div>
      </header>

      <main className="site-section">
        <div className="site-container site-angosto site-legal">
          <h1>Eliminar mi cuenta de NexoPOS</h1>
          <p className="site-legal-fecha">NexoPOS, de Linware</p>

          <p>
            NexoPOS no tiene cuentas propias: entrás con la cuenta de tu comercio en NexoB2B. Por eso
            hay dos bajas posibles, y podés pedir una o las dos.
          </p>

          <h2>Borrar los datos de tu comercio en NexoPOS</h2>
          <ol>
            <li>
              Escribinos a <a href={`mailto:${CONTACTO}?subject=Eliminar%20mi%20cuenta`}>{CONTACTO}</a>{" "}
              desde el email con el que entrás a NexoPOS, con el asunto <strong>«Eliminar mi
              cuenta»</strong>.
            </li>
            <li>Indicá el nombre del comercio y su CUIT.</li>
            <li>Te confirmamos por mail cuando los datos quedaron borrados, dentro de los 30 días.</li>
          </ol>
          <p>
            Si sos parte del equipo de un comercio, la baja la pide el dueño de la cuenta.
          </p>

          <h2>Dar de baja la cuenta de NexoB2B</h2>
          <p>
            Es la cuenta con la que entrás. Al darla de baja ya no podés ingresar a NexoPOS. Se hace
            desde NexoB2B: <a href={BAJA_NEXOB2B}>nexob2b.app/eliminar-cuenta</a>.
          </p>

          <h2>Qué se borra</h2>
          <ul>
            <li>Productos propios, precios, stock y márgenes.</li>
            <li>Los clientes que cargaste y sus cuentas corrientes.</li>
            <li>Cajas, campañas, configuración de la tienda online y claves de la API.</li>
          </ul>

          <h2>Qué se conserva</h2>
          <p>
            Las ventas y sus comprobantes, por el plazo que exigen las normas fiscales y comerciales,
            sin usarlos para ningún otro fin.
          </p>

          <h2>Ingreso con huella o Face ID</h2>
          <p>
            Esos datos están sólo en tu teléfono. Para borrarlos, apagalo en Ajustes de la app o
            desinstalala.
          </p>

          <p>
            Más detalle en la <Link href="/privacidad">política de privacidad</Link>.
          </p>
        </div>
      </main>

      <footer className="site-footer">
        <div className="site-container site-footer-in">
          <span>
            Nexo<strong>POS</strong> · un producto de Linware
          </span>
          <nav>
            <Link href="/">Inicio</Link>
            <Link href="/privacidad">Privacidad</Link>
            <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
