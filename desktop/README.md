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
- **Actualización automática**: la app busca `latest.yml` en
  `https://nexopos.app/descargas/`, que todavía no existe (si no responde, abre
  igual). Para prenderla hay que servir ahí el contenido de `release/`
  (`.exe`, `.blockmap`, `latest.yml`) desde nginx.
- **Vender sin conexión**: si se corta con la caja abierta, el frontend avisa,
  apaga el menú y el cobro, y los recupera solo (`frontend/lib/conexion.ts`;
  sirve igual en el navegador). Todavía **no se puede cobrar** sin internet:
  la venta se registra en el servidor. La venta en curso sí sobrevive a cerrar
  la ventana (`frontend/lib/venta-en-curso.ts`).
