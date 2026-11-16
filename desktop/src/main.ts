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

ipcMain.handle(
  "nexo:imprimir",
  async (evento, html: unknown, opciones: { impresora?: string; termica?: boolean } = {}) => {
    if (!vieneDeLaApp(evento)) throw new Error("Origen no permitido");
    if (typeof html !== "string" || html.length > 5_000_000) throw new Error("Documento inválido");

    // El ticket es HTML armado por el backend o por lib/print.ts: no necesita
    // correr nada, y sin JavaScript tampoco puede.
    const hoja = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
    });
    try {
      await hoja.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise<void>((resolve, reject) => {
        hoja.webContents.print(
          {
            silent: true,
            printBackground: true,
            // Vacío = la predeterminada de Windows.
            deviceName: opciones.impresora || undefined,
            // En el rollo térmico los márgenes del driver se comen el ancho
            // útil; el ticket ya trae los suyos en su CSS.
            margins: { marginType: opciones.termica ? "none" : "default" },
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
