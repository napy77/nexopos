"use client";

import { useEffect, useState } from "react";

/**
 * La sección de la app de Windows en el sitio.
 *
 * Aparece sólo si el instalador está publicado: lee `/descargas/latest.yml`,
 * el mismo archivo que usa la app para actualizarse. Así el sitio no anuncia
 * una descarga que todavía no existe (regla del sitio: ver docs/CURRENT_STATE.md),
 * y el día que se publica (deploy/03-publicar-instalador.sh) aparece sola,
 * siempre con el link a la última versión, sin tocar el código.
 */
interface Instalador {
  version: string;
  archivo: string;
  megas: number | null;
}

/**
 * latest.yml lo escribe electron-builder con forma fija. Se leen tres campos
 * con expresiones y no con un parser de YAML: no vale la pena sumar una
 * dependencia al sitio por esto.
 */
function leerLatest(texto: string): Instalador | null {
  const version = texto.match(/^version:\s*'?([\w.-]+)'?\s*$/m)?.[1];
  const archivo = texto.match(/^path:\s*'?([^'\n]+?)'?\s*$/m)?.[1];
  const bytes = Number(texto.match(/^\s+size:\s*(\d+)\s*$/m)?.[1]);
  // El nombre va en una URL: si no es un .exe con nombre simple, algo raro
  // se publicó y es mejor no mostrar nada que un link roto.
  if (!version || !archivo || !/^[\w.-]+\.exe$/.test(archivo)) return null;
  return { version, archivo, megas: bytes > 0 ? Math.round(bytes / 1_000_000) : null };
}

export default function DescargaWindows() {
  const [inst, setInst] = useState<Instalador | null>(null);

  useEffect(() => {
    fetch("/descargas/latest.yml", { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => setInst(t ? leerLatest(t) : null))
      .catch(() => setInst(null));
  }, []);

  if (!inst) return null;

  return (
    <section id="windows" className="site-section site-alt">
      <div className="site-container site-windows-in">
        <div>
          <h2>NexoPOS para Windows</h2>
          <p className="site-windows-lead">
            La misma caja, en su propia ventana y con el ícono en el escritorio. Entrás con tu
            cuenta de siempre y ves lo mismo que en el navegador.
          </p>
          <ul className="site-windows-lista">
            <li>
              <strong>Ticket directo a la ticketera</strong>, sin confirmar cada impresión.
            </li>
            <li>
              <strong>Si se corta internet, seguís cobrando en efectivo.</strong> Sale un
              comprobante provisorio y la venta se registra sola cuando vuelve la conexión.
            </li>
            <li>
              <strong>Se actualiza sola</strong>: siempre tenés la última versión.
            </li>
          </ul>
        </div>
        <div className="site-windows-caja">
          <a
            href={`/descargas/${inst.archivo}`}
            className="site-btn site-btn-primary site-btn-lg"
            download
          >
            Descargar para Windows
          </a>
          <p className="site-windows-meta">
            Versión {inst.version}
            {inst.megas ? ` · ${inst.megas} MB` : ""} · Windows 10 y 11
          </p>
          <p className="site-windows-nota">
            Al instalar, Windows puede avisar que la aplicación no es conocida. Tocá{" "}
            <strong>Más información</strong> y después <strong>Ejecutar de todas formas</strong>.
          </p>
        </div>
      </div>
    </section>
  );
}
