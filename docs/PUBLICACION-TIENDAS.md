# Publicar la app en Google Play y en el App Store

Las respuestas de cada formulario, listas para copiar. Sirven para las dos
tiendas: la parte de Apple está al final y repite lo que ya está acá.

**Si la app empieza a juntar un dato nuevo** (fotos de productos, ubicación,
avisos push), hay que cambiar a la vez la «Seguridad de los datos» de Play, la
«Privacidad de la app» de Apple y `frontend/app/privacidad/page.tsx`. Si no
coinciden, las tiendas rechazan o bajan la app.

## Archivos

Todos en `/Users/german/ClaudeCode/nexo-pos/mobile/assets/tienda/`:

| Archivo | Para qué |
|---|---|
| `play/icono-512.png` | Ícono de la ficha de Play (512 × 512) |
| `play/grafico-1024x500.png` | Gráfico de funciones de Play |
| `play/capturas/1..5-*.png` | Capturas de teléfono para Play (1080 × 1920) |
| `apple/capturas/1..5-*.png` | Capturas para iPhone de 6,9" (1320 × 2868) |
| `fuentes/*.svg` | El ícono en vector, para rehacer cualquier tamaño |

El ícono de la app (`mobile/assets/images/`) ya es el nuevo. **Entra con la
próxima compilación**: el AAB 1.0.0 (código 4) todavía tiene el de la plantilla.

Las capturas salieron del simulador contra el backend de prueba, con productos
y clientes inventados. No hay marcas reales a la vista.

---

## Google Play · Contenido de la app

### Política de privacidad
`https://nexopos.app/privacidad`. Se publica con el próximo deploy del frontend.

### Detalles de acceso
**«Todas o algunas funciones de la app están restringidas»** → agregar
instrucciones:

- Nombre: `Cuenta de revisión`
- Usuario: el email del comercio de prueba
- Contraseña: la de ese comercio
- Instrucciones:
  > NexoPOS es un punto de venta para comercios. Ingresá con el email y la
  > contraseña de arriba. En «Vender» tocá un producto para sumarlo al ticket y
  > «Cobrar» para registrar la venta en efectivo. La impresión requiere una
  > ticketera Bluetooth o de red; sin ella, «Enviar» muestra el ticket con un QR.

**Falta crear ese comercio** en NexoB2B de producción, con NexoPOS activado,
algunos productos con precio y la caja abierta. Apple pide lo mismo. Si sus
ventas de prueba no deben mezclarse con nada, alcanza con que sea un comercio
aparte.

### Anuncios
Ya está: **No**.

### Clasificación de contenido
- Categoría: **Todas las demás categorías / Utilidad, productividad,
  comunicación u otro**.
- Responder **No** a todo: violencia, sexo, lenguaje, drogas, apuestas,
  contenido generado por usuarios que se comparte, interacción entre usuarios,
  ubicación compartida, compras digitales.
- Resultado esperado: apta para todo público (PEGI 3 / ESRB Everyone).

### Público objetivo
- Edad: **18 años o más**, sólo esa franja.
- ¿Puede atraer a niños? **No**.

### Seguridad de los datos
1. ¿Recopila o comparte datos del usuario? **Sí**.
2. ¿Todos los datos se encriptan en tránsito? **Sí** (HTTPS).
3. Formas de cuenta: **«Mi app no permite crear cuentas»**: el alta es en
   NexoB2B. El login usa usuario y contraseña de NexoB2B.
4. ¿Ofrecen una forma de pedir que se borren los datos? **Sí**:
   `https://nexopos.app/privacidad#eliminar`.

Datos recopilados. En todos: **no se comparten**, el procesamiento **no es
efímero**, la recopilación es **obligatoria** salvo que se diga otra cosa, y
el propósito es **Funcionalidad de la app** y **Administración de la cuenta**.

| Tipo de datos (Play) | Qué es en NexoPOS |
|---|---|
| Información personal → **Nombre** | Nombre de los clientes del comercio |
| Información personal → **Dirección de correo electrónico** | Email de la cuenta y de los clientes |
| Información personal → **Dirección** | Domicilio de entrega de los pedidos |
| Información personal → **Número de teléfono** | Teléfono de los clientes |
| Información personal → **Otra información** | Documento de los clientes (opcional) |
| Información financiera → **Historial de compras** | Ventas y cuenta corriente de los clientes |

**No se declara:**
- **Ubicación.** El permiso existe sólo para buscar Bluetooth hasta Android 11 y
  nunca se lee.
- **Fotos y cámara.** El código de barras se lee en el teléfono y no se manda.
- **Datos biométricos.** La huella la valida el sistema; la app no la ve.
- **Identificadores del dispositivo.** No hay publicidad ni analítica. El
  permiso AD_ID tampoco está en el manifiesto.

«Compartir» en Play significa mandar datos a otra empresa. NexoB2B, ClubPay y
NexoTienda son de Linware. Mercado Pago recibe sólo el importe del cobro, y
WhatsApp lo abre el cajero a pedido. Por eso no se declara nada como compartido.
*Si Linware y alguno de esos productos fueran empresas distintas*, ese dato
pasa a «compartido».

### Apps gubernamentales
**No**.

### Funciones financieras
**«Mi app no ofrece funciones financieras»**. NexoPOS registra ventas. El cobro
con QR lo procesa Mercado Pago en su propia app, y NexoPOS no presta, no guarda
ni mueve dinero.

### Salud
**No** a todo.

---

## Google Play · Ficha de la tienda

### Categoría y contacto
- Tipo: **App**. Categoría: **Empresa**.
- Email: `soporte@nexopos.app` (**hay que crear la casilla** o el reenvío).
- Sitio web: `https://nexopos.app`.
- Teléfono: opcional, se puede dejar vacío.

### Textos
**Nombre** (30 máx.):
```
NexoPOS
```

**Descripción breve** (80 máx.):
```
Punto de venta para tu comercio: ventas, caja, stock y pedidos a mayoristas.
```

**Descripción completa**:
```
NexoPOS es el punto de venta de los comercios de NexoB2B, ahora en el celular y la tablet. Es gratis para los comercios dados de alta en NexoB2B: entrás con el mismo email y contraseña.

VENDÉ EN SEGUNDOS
• Buscá o escaneá productos con el lector Bluetooth o con la cámara.
• Productos por peso, con balanza.
• Cobrá en efectivo, tarjeta, billetera, transferencia, Mercado Pago con QR o cuenta corriente.
• Descuentos para socios de ClubPay.
• Imprimí el ticket en tu ticketera Bluetooth o de red, o mandalo por WhatsApp.

LA CAJA EN ORDEN
• Apertura con fondo inicial, retiros e ingresos de efectivo.
• Cierre con arqueo: cuánto tiene que haber en el cajón.
• Reembolsos y el historial de ventas a mano.

CLIENTES Y CUENTA CORRIENTE
• La libreta de tus clientes: quién debe y cuánto.
• Cobros de cuenta corriente desde el mostrador.

STOCK Y COMPRAS
• Alta de productos desde el catálogo de NexoB2B, escaneando el código.
• Ajustes de stock y precios.
• Descubrí mayoristas de tu zona, mirá sus catálogos y hacé tus pedidos.

TU TIENDA ONLINE
• Recibí los pedidos de NexoTienda y avisá cuándo están listos.

Ingresá con tu huella o Face ID, sin escribir la contraseña.

Todo queda sincronizado con NexoPOS en la web: lo que vendés en el celular aparece en la computadora, y al revés.
```

### Gráficos
- Ícono: `play/icono-512.png`.
- Gráfico de funciones: `play/grafico-1024x500.png`.
- Capturas de teléfono: las cinco de `play/capturas/`, en orden.
- Tablet: opcional. Sin capturas de tablet, Play no destaca la app en tablets,
  pero se instala igual.

---

## Antes de pasar a producción en Play

Una cuenta personal de Play creada después de noviembre de 2023 tiene que hacer
una **prueba cerrada con 12 testers durante 14 días** antes de pedir acceso a
producción. Con una cuenta de organización, no. Se ve en Panel → «Pasar a
producción».

---

## App Store (Apple) · lo mismo, con sus nombres

| Apple | Respuesta |
|---|---|
| Privacy Policy URL | `https://nexopos.app/privacidad` |
| Support URL | `https://nexopos.app` |
| Categoría | Business (secundaria: Productivity) |
| Clasificación por edad | 4+ (todo «None») |
| Sign-in required | Sí: la misma cuenta de revisión de Play, con las mismas notas |
| Exportación de cifrado | Ya declarado en `app.json` (`ITSAppUsesNonExemptEncryption: false`) |

**App Privacy** (la etiqueta de privacidad):
- Tracking: **No**.
- Data Linked to You, todo con propósito **App Functionality**:
  - Contact Info → Name, Email Address, Phone Number, Physical Address
  - Purchases → Purchase History
  - Identifiers → User ID (la cuenta de NexoB2B)
- No se declara Location, Photos, Health, Usage Data ni Diagnostics.

**Textos:** nombre `NexoPOS`. Subtítulo (30 máx.): `Ventas, caja y stock`.
Descripción: la misma que en Play. Palabras clave (100 máx.):
`punto de venta,pos,caja,stock,almacén,kiosco,ticket,ventas,comercio,mayoristas,cuenta corriente`.

**Capturas:** `apple/capturas/` (6,9"). Apple las escala para los iPhone más
chicos. `supportsTablet` está en `true`, así que **también pide capturas de
iPad de 13"** (2064 × 2752). Faltan: salen del simulador de iPad con la misma
receta.
