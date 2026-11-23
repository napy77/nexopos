import { contextBridge, ipcRenderer } from "electron";

/**
 * Lo único que la página ve de la app de escritorio. El frontend pregunta por
 * `window.nexoDesktop`: si existe, imprime por acá; si no, está en un navegador
 * y sigue con el diálogo de siempre. El contrato está tipado del otro lado en
 * frontend/lib/desktop.ts — si cambia acá, cambia allá.
 */
contextBridge.exposeInMainWorld("nexoDesktop", {
  version: () => ipcRenderer.invoke("nexo:version"),
  impresoras: () => ipcRenderer.invoke("nexo:impresoras"),
  imprimir: (html: string, opciones: { impresora?: string; termica?: boolean; ancho?: string }) =>
    ipcRenderer.invoke("nexo:imprimir", html, opciones),
});
