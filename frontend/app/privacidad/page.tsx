import type { Metadata } from "next";
import Link from "next/link";
import "../site.css";

export const metadata: Metadata = {
  title: "Política de privacidad · NexoPOS",
  description: "Qué datos usa NexoPOS, para qué y cómo pedir que se borren.",
};

// Google Play y el App Store piden esta URL pública y sin login. Lo que dice
// tiene que coincidir con lo que se declara en «Seguridad de los datos» de Play
// y en la etiqueta de privacidad de Apple (docs/PUBLICACION-TIENDAS.md): si la
// app empieza a juntar algo nuevo, se cambia acá y allá a la vez.
const CONTACTO = "soporte@nexopos.app";
const ACTUALIZADA = "22 de noviembre de 2026";

export default function Privacidad() {
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
          <h1>Política de privacidad</h1>
          <p className="site-legal-fecha">Última actualización: {ACTUALIZADA}</p>

          <p>
            NexoPOS es el punto de venta de Linware para comercios del ecosistema NexoB2B. Esta
            política explica qué datos usan el sitio <strong>nexopos.app</strong> y las apps de
            NexoPOS para Android, iOS y Windows, para qué, y cómo pedir que se borren.
          </p>

          <h2>Quién es el responsable</h2>
          <p>
            Linware, responsable de NexoPOS. Para cualquier consulta sobre tus datos escribinos a{" "}
            <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
          </p>

          <h2>Qué datos usamos</h2>
          <ul>
            <li>
              <strong>Tu cuenta.</strong> El email y la contraseña de NexoB2B, que se usan sólo para
              iniciar sesión. NexoPOS no crea cuentas propias: la cuenta se da de alta en NexoB2B.
            </li>
            <li>
              <strong>Los datos de tu comercio.</strong> Productos, precios, stock, ventas, cajas,
              compras a mayoristas y pedidos de tu tienda online.
            </li>
            <li>
              <strong>Los datos de tus clientes</strong> que vos cargás: nombre, teléfono, documento,
              email y dirección, y los movimientos de su cuenta corriente. Esos datos son de tu
              comercio; NexoPOS los guarda para que los uses vos.
            </li>
          </ul>
          <p>
            No usamos publicidad, no tenemos herramientas de seguimiento ni analítica de terceros y
            no vendemos datos a nadie.
          </p>

          <h2>Permisos de la app</h2>
          <ul>
            <li>
              <strong>Cámara:</strong> para leer códigos de barras. La imagen se procesa en el
              teléfono y no se guarda ni se envía.
            </li>
            <li>
              <strong>Bluetooth y red local:</strong> para imprimir en la ticketera y usar el lector
              o la balanza. En Android 11 o anteriores el sistema pide el permiso de ubicación para
              buscar dispositivos Bluetooth; NexoPOS no lee ni guarda tu ubicación.
            </li>
            <li>
              <strong>Huella o Face ID (opcional):</strong> si lo activás, tu email y contraseña se
              guardan cifrados en el teléfono, atados a tu huella o tu cara. Nunca salen del
              teléfono de esa forma ni nosotros vemos tus datos biométricos.
            </li>
          </ul>

          <h2>Con quién se comparten</h2>
          <p>Sólo con los servicios que hacen funcionar lo que vos usás:</p>
          <ul>
            <li>
              <strong>NexoB2B</strong> (Linware), para iniciar sesión, el catálogo y los pedidos a tus
              mayoristas.
            </li>
            <li>
              <strong>ClubPay</strong> (Linware), si tus clientes son socios: para aplicar su
              descuento y llevar su libreta.
            </li>
            <li>
              <strong>NexoTienda</strong> (Linware), si tenés tienda online.
            </li>
            <li>
              <strong>Mercado Pago</strong>, si cobrás con QR: recibe el importe y la descripción del
              cobro.
            </li>
            <li>
              <strong>WhatsApp</strong>, sólo cuando vos elegís mandarle el ticket a un cliente: se
              abre WhatsApp con el número y el link del ticket.
            </li>
          </ul>

          <h2>Dónde y cómo se guardan</h2>
          <p>
            En servidores propios de Linware. Todo viaja cifrado (HTTPS) y cada comercio ve sólo sus
            propios datos. Los guardamos mientras tu comercio use NexoPOS.
          </p>

          <h2 id="eliminar">Cómo borrar tus datos</h2>
          <p>
            Escribinos a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a> desde el email de tu cuenta
            y pedí la baja. Borramos los datos de tu comercio en NexoPOS dentro de los 30 días,
            salvo lo que la ley nos obligue a conservar. La cuenta de NexoB2B se da de baja en
            NexoB2B. Para desactivar el ingreso con huella alcanza con apagarlo en Ajustes o
            desinstalar la app.
          </p>
          <p>
            Si sos cliente de un comercio que usa NexoPOS y querés ver, corregir o borrar tus datos,
            pedíselo al comercio, o escribinos y lo gestionamos con él.
          </p>

          <h2>Menores</h2>
          <p>NexoPOS es una herramienta para comercios y no está dirigida a menores de 18 años.</p>

          <h2>Cambios</h2>
          <p>
            Si cambiamos esta política, actualizamos la fecha de arriba. Si el cambio es importante,
            lo avisamos dentro de la app.
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
            <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
