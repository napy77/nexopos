import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";

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

ipcMain.handle("nexo:impresoras", async (evento) => {
  if (!vieneDeLaApp(evento)) return [];
  const lista = await evento.sender.getPrintersAsync();
  return lista.map((p) => ({ nombre: p.name, etiqueta: p.displayName || p.name }));
});

/** Ancho del rollo en mm. Lo que no es térmico va a la hoja de la impresora. */
const ROLLO_MM: Record<string, number> = { "80mm": 80, "58mm": 58 };

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

      // En el rollo se le dice a Chromium el tamaño exacto del papel. Sin eso,
      // la impresión silenciosa de Electron no toma el @page del ticket como
      // la vista previa de Chrome: con una OCOM OCPP-812 de 80 mm la
      // ticketera pitaba tres veces y sacaba unos centímetros en blanco,
      // mientras el mismo ticket desde Chrome salía bien.
      let pageSize: Electron.WebContentsPrintOptions["pageSize"];
      if (rolloMm) {
        const altoPx = Number(
          // Lo que ocupa el body, no el scrollHeight: ése nunca baja del alto
          // de la ventana y un ticket corto saldría con papel de sobra.
          await hoja.webContents.executeJavaScript(
            "document.body ? Math.ceil(document.body.getBoundingClientRect().bottom) : 0",
          ),
        );
        const micras = (px: number) => Math.ceil((px / 96) * 25_400);
        pageSize = {
          width: rolloMm * 1000,
          // Unos milímetros de cola para que el corte no muerda la última línea.
          height: micras(Number.isFinite(altoPx) && altoPx > 0 ? altoPx : 600) + 8_000,
        };
      }

      await new Promise<void>((resolve, reject) => {
        hoja.webContents.print(
          {
            silent: true,
            printBackground: true,
            // Vacío = la predeterminada de Windows.
            deviceName: opciones.impresora || undefined,
            // En el rollo térmico los márgenes del driver se comen el ancho
            // útil; el ticket ya trae los suyos en su CSS.
            margins: { marginType: rolloMm ? "none" : "default" },
            ...(pageSize ? { pageSize } : {}),
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
