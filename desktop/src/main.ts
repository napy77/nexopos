import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { print as imprimirPdf } from "pdf-to-printer";

/**
 * NexoPOS de escritorio: una ventana que muestra nexopos.app.
 *
 * A propósito NO lleva el frontend adentro. La app es el mismo sitio, servido
 * desde el mismo servidor: un deploy actualiza la web y todas las cajas a la
 * vez, y no hay dos versiones de la lógica que puedan divergir. Lo que la app
 * agrega es lo que un navegador no deja hacer: imprimir en la ticketera sin
 * diálogo y, más adelante, hablar con el hardware del mostrador.
 */

// NEXOPOS_URL existe para probar contra el frontend local (http://localhost:3000).
const BASE = (process.env.NEXOPOS_URL ?? "https://nexopos.app").replace(/\/$/, "");
const ORIGEN = new URL(BASE).origin;
// Directo a la caja: sin sesión, el layout del dashboard manda solo a /login.
// La raíz es el sitio institucional y no es lo que quiere ver quien abre la caja.
const INICIO = `${BASE}/ventas`;

let ventana: BrowserWindow | null = null;

const esDeLaApp = (url: string): boolean => {
  try {
    return new URL(url).origin === ORIGEN;
  } catch {
    return false;
  }
};

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  ventana.maximize();
  ventana.show();

  const contenido = ventana.webContents;

  // Lo que no es NexoPOS (WhatsApp de un mayorista, el perfil en NexoB2B) se
  // abre en el navegador de la PC: ahí el comerciante tiene sus sesiones, y la
  // ventana de la caja nunca queda parada en un sitio ajeno sin botón de volver.
  contenido.on("will-navigate", (evento, url) => {
    if (esDeLaApp(url) || url.startsWith("file:")) return;
    evento.preventDefault();
    abrirAfuera(url);
  });

  contenido.setWindowOpenHandler(({ url }) => {
    // El PDF del ticket se abre como blob: del propio sitio; ésa y las páginas
    // de NexoPOS (la documentación de la API) van a una ventana de la app.
    if (url.startsWith(`blob:${ORIGEN}`) || esDeLaApp(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    abrirAfuera(url);
    return { action: "deny" };
  });

  // Sin internet al abrir (o al recargar) el navegador mostraría su error en
  // inglés. -3 es una carga cancelada por otra navegación, no una falla.
  contenido.on("did-fail-load", (_e, codigo, _desc, url, esMarcoPrincipal) => {
    if (!esMarcoPrincipal || codigo === -3 || url.startsWith("file:")) return;
    void ventana?.loadFile(path.join(__dirname, "..", "offline.html"), {
      query: { destino: esDeLaApp(url) ? url : INICIO },
    });
  });

  ventana.on("closed", () => {
    ventana = null;
  });

  void ventana.loadURL(INICIO);
}

function abrirAfuera(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

/**
 * La página viene de la red, así que cada pedido se revisa: sólo el marco
 * principal, y sólo si está parado en NexoPOS. Un iframe o una página ajena
 * que llegara a cargarse en la ventana no puede mandar a imprimir.
 */
function vieneDeLaApp(evento: IpcMainInvokeEvent): boolean {
  const marco = evento.senderFrame;
  return !!marco && marco === evento.sender.mainFrame && esDeLaApp(marco.url);
}

// La versión instalada, para mostrarla en la caja: cuando algo falla, lo
// primero es saber si esa PC ya se actualizó.
ipcMain.handle("nexo:version", (evento) => (vieneDeLaApp(evento) ? app.getVersion() : ""));

ipcMain.handle("nexo:impresoras", async (evento) => {
  if (!vieneDeLaApp(evento)) return [];
  const lista = await evento.sender.getPrintersAsync();
  return lista.map((p) => ({ nombre: p.name, etiqueta: p.displayName || p.name }));
});

/** Ancho del rollo en mm. Lo que no es térmico va a la hoja de la impresora. */
const ROLLO_MM: Record<string, number> = { "80mm": 80, "58mm": 58 };

/**
 * Lo que de verdad se imprime de cada rollo: el ancho del contenido del
 * ticket (estilosImpresion en backend/src/modules/ticket-render.ts). La
 * ticketera no imprime de borde a borde y centra la hoja: un PDF de 80 mm en
 * los ~72 mm útiles perdía 4 mm de cada lado y se comía el comienzo de cada
 * línea.
 */
const UTIL_MM: Record<number, number> = { 80: 72, 58: 50 };

/**
 * Bloquea cualquier script del documento: el ticket es HTML armado por el
 * backend o por lib/print.ts y no tiene por qué correr nada. La ventana sí
 * necesita JavaScript prendido para que la app mida el alto (eso entra por
 * executeJavaScript, que no pasa por la CSP del documento).
 */
function sinScripts(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;
  // Antes del doctype pondría la página en modo quirks y cambiaría el diseño.
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + meta) : meta + html;
}

/**
 * El rollo térmico no se imprime con webContents.print: en Windows, la
 * impresión silenciosa de Electron a una ticketera sale en blanco (una OCOM
 * OCPP-812 pitaba tres veces y sacaba un papelito, con o sin tamaño de
 * página; es electron/electron#41741, abierto desde la 29). Con diálogo o
 * desde Chrome sale bien, porque pasa por la vista previa, que arma un PDF.
 *
 * Acá se hace lo mismo a mano: el ticket se pasa a PDF del ancho del rollo y
 * del alto del contenido, y lo manda a la impresora SumatraPDF (viene en
 * pdf-to-printer), que imprime por el driver como cualquier programa.
 */
async function imprimirEnRollo(hoja: BrowserWindow, rolloMm: number, impresora?: string): Promise<void> {
  // Lo que ocupa el body, no el scrollHeight: ése nunca baja del alto de la
  // ventana y un ticket corto saldría con papel de sobra.
  const altoPx = Number(
    await hoja.webContents.executeJavaScript(
      "document.body ? Math.ceil(document.body.getBoundingClientRect().bottom) : 0",
    ),
  );
  const pulgadas = (px: number) => px / 96;
  const pdf = await hoja.webContents.printToPDF({
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    pageSize: {
      width: (UTIL_MM[rolloMm] ?? rolloMm) / 25.4,
      // Unos milímetros de cola para que el corte no muerda la última línea.
      height: pulgadas(Number.isFinite(altoPx) && altoPx > 0 ? altoPx : 600) + 8 / 25.4,
    },
  });

  const archivo = path.join(os.tmpdir(), `nexopos-ticket-${randomUUID()}.pdf`);
  await writeFile(archivo, pdf);
  try {
    // noscale: el PDF ya mide lo que el rollo; achicarlo a la hoja del driver
    // lo dejaría ilegible.
    // portrait: un ticket corto queda más ancho que alto, y SumatraPDF lo
    // giraba para que entrara "mejor" en la hoja.
    await imprimirPdf(archivo, {
      printer: impresora || undefined,
      scale: "noscale",
      orientation: "portrait",
      silent: true,
    });
  } finally {
    await rm(archivo, { force: true });
  }
}

ipcMain.handle(
  "nexo:imprimir",
  async (
    evento,
    html: unknown,
    opciones: { impresora?: string; termica?: boolean; ancho?: string } = {},
  ) => {
    if (!vieneDeLaApp(evento)) throw new Error("Origen no permitido");
    if (typeof html !== "string" || html.length > 5_000_000) throw new Error("Documento inválido");

    // Un frontend viejo manda sólo `termica`: era siempre el rollo de 80.
    const rolloMm = opciones.ancho ? ROLLO_MM[opciones.ancho] : opciones.termica ? 80 : undefined;
    const hoja = new BrowserWindow({
      show: false,
      // Del ancho del rollo (96 px por pulgada), para que el alto medido sea
      // el mismo que va a tener impreso.
      width: rolloMm ? Math.ceil((rolloMm / 25.4) * 96) : 800,
      height: 600,
      webPreferences: { javascript: true, sandbox: true, contextIsolation: true },
    });
    try {
      await hoja.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(sinScripts(html))}`);

      if (rolloMm) {
        await imprimirEnRollo(hoja, rolloMm, opciones.impresora);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        hoja.webContents.print(
          {
            silent: true,
            printBackground: true,
            // Vacío = la predeterminada de Windows.
            deviceName: opciones.impresora || undefined,
            margins: { marginType: "default" },
          },
          (ok, motivo) => (ok ? resolve() : reject(new Error(motivo || "No se pudo imprimir"))),
        );
      });
    } finally {
      hoja.destroy();
    }
  },
);

// Dos cajas abiertas en la misma PC comparten sesión y carrito (localStorage):
// el segundo doble clic trae la ventana que ya está, no abre otra.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!ventana) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });

  void app.whenReady().then(() => {
    crearVentana();
    // Sólo instalada: en desarrollo no hay de dónde actualizar. Si el servidor
    // de descargas no responde, la caja abre igual.
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error("Actualización:", err));
    }
  });

  app.on("window-all-closed", () => app.quit());
}
