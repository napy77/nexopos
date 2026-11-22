# NexoPOS para Android y iOS

App nativa del mostrador para tablet y celular. **No muestra la web**: habla
directo con la API del backend (`/api/*`), con el mismo login de NexoB2B y el
mismo JWT que la web.

Mismo stack que la app de ClubPay: Expo SDK 54, React Native 0.81, Expo Router
6, zustand, EAS Build/Submit. Sin actualizaciones por aire (`expo-updates`):
cada cambio pasa por las tiendas.

## Qué hace (etapa 1: el mostrador)

- **Vender** — buscador que recibe el lector Bluetooth, grilla por pasillo,
  etiquetas de balanza, editar cantidad / % / precio del renglón, cliente,
  cobro en efectivo con vuelto, billetera, tarjeta, transferencia, cuenta
  corriente, **Mercado Pago por QR** y **descuento ClubPay** (QR del comercio
  o QR del socio). Mismos resguardos que la web: el QR vivo de Mercado Pago se
  da de baja antes de cobrar de otra forma, y si cancelar llega tarde se cierra
  la venta con ese pago.
- **Caja** — abrir con fondo, retiros e ingresos, arqueo en vivo, cierre con
  efectivo contado, imprimir cierre o resumen parcial, cierres anteriores.
- **Pedidos** — los de NexoTienda, con globito en la pestaña de los que esperan
  aceptación (se consulta cada 20 s con la app abierta, como la web). Aceptar
  diciendo para cuándo, listo, salió, entregado, cancelar con un motivo que lee
  el cliente. Los marcados para revisar piden un toque más.
- **Ventas** — historial, reimprimir, reembolsar.
- **Ticket sin ticketera** — «Enviar», en Vender y en Ventas: por WhatsApp al
  número que se tipea (o el de la ficha del cliente) o con un QR en pantalla
  que el cliente escanea con su cámara. Los dos abren el PDF del ticket con un
  link firmado por el backend, sin sesión. Sin ticketera elegida, la app no
  intenta imprimir al cobrar. El QR de contacto de WhatsApp no sirve para esto:
  no trae el número ni deja mandar un mensaje armado.
- **Clientes** — saldo, movimientos y cobro de la cuenta corriente.
- **Productos** (en la barra dice «Stock»: con siete pestañas no entra) — stock con filtros de stock bajo y sin precio, precio, costo
  y mínimo, ajuste de stock con motivo. El buscador trae lo tuyo y, debajo, lo
  que coincide en NexoB2B y todavía no tenés, con un toque para darlo de alta. Alta **desde el catálogo maestro de
  NexoB2B** escaneando uno atrás de otro (si el código no está en el stock se
  abre el alta con el código puesto; si tampoco está en el catálogo, se ofrece
  crearlo como propio) y **producto propio** (fraccionados, elaboración
  propia, venta por peso con código de balanza).
- **Compras** — el catálogo de los mayoristas con el precio que ve el comercio
  en B2B, carrito con una orden por mayorista (medio de pago y notas), órdenes
  con su estado, **Ingresar al stock** y cancelar. El carrito se guarda en el
  dispositivo (`lib/carrito.ts`), como la web lo guarda en el navegador.
  **Mayoristas**: descubrir por zona y rubro, pedir el alta, el contacto por
  WhatsApp y el catálogo de cada uno.
- **Ajustes** (⚙️ arriba a la derecha) — ticketera del dispositivo, ingreso con huella o Face ID, cerrar sesión.
- **Huella o Face ID** — se ofrece después de entrar con la contraseña, o se
  activa en Ajustes. El JWT dura 12 h y no hay token de renovación: lo que se
  guarda es el email y la contraseña, en el Keychain / Keystore atados a la
  biometría (`lib/biometria.ts`). Al ingresar se hace el login de siempre.
  Si cambian las huellas del teléfono o la contraseña en NexoB2B, se borra y
  se vuelve a la contraseña. El simulador de iOS no hace cumplir la
  biometría: probarlo en un teléfono.

Márgenes, campañas, fotos de productos y configuración siguen en nexopos.app.

**Siempre online.** No hay cobro sin conexión en la app: un fallo de red es un
error que ve el cajero.

## Lector de códigos

Los lectores Bluetooth se emparejan como **teclado**: tipean el código y mandan
Enter. No necesitan nada de la app; el buscador del mostrador tiene el foco y
recibe la lectura. Con el teclado físico conectado, Android e iOS esconden el
teclado de pantalla solos.

Sin lector, la **cámara**: cada buscador de productos (Vender, Stock, alta del
catálogo, Compras, el código de barras del producto propio) tiene el ícono de
código de barras a la derecha. Lo leído entra igual que si lo hubiera tipeado
el lector. El campo del QR del socio de ClubPay lee QR. Pide sólo el permiso
de cámara, sin micrófono (`expo-camera`, `components/escaner.tsx`).

## Ticketeras

| Conexión | Android | iOS |
|---|---|---|
| Red (puerto 9100) | Sí | Sí |
| Bluetooth BLE | Sí | Sí |
| Bluetooth clásico (SPP) | Sí | **No** — Apple sólo deja hablarle a accesorios MFi |

El ticket y el cierre de caja **los arma el backend** en ESC/POS
(`backend/src/modules/ticket-escpos.ts`, endpoints `…/ticket.escpos` y
`…/resumen.escpos`): la app sólo manda los bytes. Así el formato cambia con un
deploy y no con una versión nueva en las tiendas. La app arma por su cuenta
sólo la hoja de prueba y el QR de un cobro en papel (`lib/impresora/bytes.ts`).

Página de códigos PC850 (acentos y ñ). La configuración es por dispositivo.

## Comandos

```bash
npm install
npx expo run:ios       # compila y abre en el simulador (necesita Xcode)
npx expo run:android   # compila y abre en el emulador o un Android por USB
npx tsc --noEmit
npx expo lint
```

No anda en **Expo Go**: Bluetooth y TCP son módulos nativos y piden una
compilación propia (`expo-dev-client`). `ios/` y `android/` se generan solas
(`expo prebuild`) y no se versionan.

Para probar contra un backend local, `.env.local` (no se versiona):

```
EXPO_PUBLIC_API_URL=http://localhost:4100
```

En un Android físico, `localhost` es el teléfono: usar la IP de la Mac en la red.

## Publicar

```bash
eas build --platform all --profile production
eas submit --platform all
```

El perfil `production` da un AAB para Google Play con el número de versión
(`versionCode`) que lleva EAS y sube solo. La **primera** subida a Play
Console se hace a mano: `eas submit` necesita que la app ya exista allá y una
cuenta de servicio de Google con permiso para subir.

Android e iOS salen del mismo commit y con la misma versión, como ClubPay.

## Regla para el backend

Hay apps instaladas que no se actualizan el día del deploy. **Un cambio en
`/api/*` no puede romper lo que espera la versión anterior de la app**: campos
nuevos sí, campos que cambian de nombre o de tipo no. Ver regla 9 en
`CLAUDE.md`.

## Pendiente

- Probar en un Android y un iPad reales con una térmica de red, una BLE y una
  clásica, y con un lector Bluetooth.
- `react-native-tcp-socket` y `react-native-bluetooth-classic` no están
  marcados como probados en la Nueva Arquitectura (avisa `expo-doctor`). Andan
  por la capa de compatibilidad; confirmarlo en los dispositivos.
- Ícono y pantalla de inicio propios (hoy son los de la plantilla de Expo).
- Identificador `com.linware.nexopos`, con la misma lógica que
  `com.linware.clubpay` y `com.linware.nexob2b`. Una vez subida la app ya no
  se puede cambiar.
- La venta en curso no se guarda si se cierra la app (la web sí la guarda).
- Un pedido de la tienda se ve sólo con la app abierta: avisar con la app
  cerrada pide notificaciones push (`expo-notifications`, otra compilación y un
  envío desde el backend).
- Fotos de productos: sacarlas con la cámara del celular pide
  `expo-image-picker`, otro módulo nativo y otra compilación (el permiso de
  cámara ya está, por el escáner).
- `lib/b2b.ts` es copia de `frontend/lib/b2b-types.ts`: si cambia uno, el otro.
