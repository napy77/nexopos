# NexoPOS para Windows

Una ventana de Electron que muestra `nexopos.app`. **No lleva el frontend
adentro**: es el mismo sitio, así que un deploy actualiza la web y todas las
cajas a la vez. El instalador sólo hay que regenerarlo cuando cambia algo de
esta carpeta.

## Qué agrega sobre el navegador

- Ventana propia, ícono en el escritorio, una sola instancia por PC.
- **Impresión directa**: los tickets salen sin diálogo a la impresora elegida
  en Configuración → Impresión de tickets (el selector sólo aparece en la app).
- Pantalla propia cuando no hay internet al abrir; reintenta sola.
- Los enlaces que no son NexoPOS (WhatsApp, NexoB2B) abren en el navegador.

## Cómo se habla con el frontend

`src/preload.ts` expone `window.nexoDesktop`; el frontend lo usa a través de
`frontend/lib/desktop.ts`. Si no existe, está en un navegador y se comporta
como siempre. **El contrato vive en esos dos archivos y se cambian juntos.**
Una app ya instalada tiene el preload viejo: lo nuevo del frontend tiene que
tolerar que falte un método.

## Comandos

```bash
npm install
npm start                                   # contra https://nexopos.app
NEXOPOS_URL=http://localhost:3000 npm start # contra el frontend local
npm run dist                                # release/NexoPOS Setup x.y.z.exe
```

`npm run dist` funciona desde la Mac (verificado el 16/11/2026).

## Pendiente

- **Probar el instalador en una PC con Windows y una ticketera real.** Hasta
  ahora se probó la app en Mac: puente, lista de impresoras, pantalla sin
  conexión. La impresión silenciosa en papel térmico no se vio salir.
- **Ícono**: sale con el de Electron. Falta `build/icon.png` (512×512 o más).
- **Firma de código**: sin certificado, SmartScreen avisa al instalar.
- **Publicar** (`bash /Users/german/ClaudeCode/nexo-pos/desktop/publicar.sh usuario@servidor`, ver
  `docs/DEPLOYMENT.md`): todavía no se hizo. Hasta entonces el sitio no muestra
  la sección de descarga y la app no tiene de dónde actualizarse (si no
  encuentra `latest.yml`, abre igual). Antes hay que agregar el bloque
  `/descargas/` a la config de nginx del servidor, que se aplica a mano.
- **Vender sin conexión**: si se corta con la caja abierta, el frontend avisa,
  apaga el menú y el cobro, y los recupera solo (`frontend/lib/conexion.ts`;
  sirve igual en el navegador). **Dentro de la app** se puede cobrar en
  efectivo: la venta va a una cola local (`frontend/lib/ventas-offline.ts`),
  imprime un comprobante provisorio y se registra sola al volver. Que sea sólo
  en la app es a propósito: en un navegador, borrar los datos de navegación se
  lleva la cola.
- **Etapa B, sin hacer**: abrir la app sin internet (hoy sólo se vende si la
  pantalla ya estaba abierta al cortarse) y copiar la cola a un archivo en
  disco desde `main.ts`, para que no dependa sólo del almacenamiento de la
  ventana.
