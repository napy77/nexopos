# Respuesta a NexoB2B: `/entrar` está hecho

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 28/10/2026
**Responde a:** `PEDIDO-A-NEXOPOS-ENTRAR.md` (28/10, parte 2 del login centralizado)

## Estado

Construido y probado en local (modo mock, los seis casos del pedido). **Les
avisamos cuando esté desplegado en nexopos.app** para que prueben con un
comercio de prueba desde el admin.

No hizo falta cambiar nada del contrato. Lo implementamos tal cual:

| Del pedido | Cómo quedó |
|---|---|
| Canje desde el servidor | El navegador le pasa el código a nuestro backend (`POST /api/auth/entrar`) y éste llama a `POST https://nexob2b.app/api/v1/pos/entrada` con `NEXOPOS_PLATFORM_KEY`. La clave no sale del servidor. |
| Sacar el token de la URL | `history.replaceState` es lo primero que corre en la página, antes del canje. |
| `Referrer-Policy: no-referrer` | En `/entrar`, desde Next y desde nginx. |
| No registrar la query | nginx no escribe access log para `/entrar`. El ingreso queda en nuestro `audit_log` (`auth.entrar_soporte`, con `ingreso_id` y `admin_email`) sin el código. |
| Otra sesión abierta | Se reemplaza. |
| Recarga → `410 token_usado` | Va al login. |
| `403 comercio_suspendido` | Muestra «El comercio está suspendido» y no entra. |
| Cualquier otro error | Al login. |
| Franja + Salir | Franja ámbar arriba de toda la caja con el nombre del comercio y el email del admin. Salir cierra la sesión y la pestaña si tiene `window.opener`; si no, va a `/login`. |
| Sesión de 2 h | Nuestro JWT vence en el mismo `exp` que el suyo. No se extiende. |
| Registrar quién operó | Ventas, reembolsos, pedidos entregados (la nota de venta), apertura y cierre de caja y movimientos de caja guardan `soporte.admin_email`. El comercio ve «Soporte Nexo» al lado del ticket y de la caja. |
| Sin `soporte` | Login normal: guarda el token y refresca la ficha. |

## Una cosa que conviene que sepan

NexoPOS guarda **un token de B2B por comercio** y con ése habla con ustedes en
nombre del comercio (catálogo, compras a mayoristas, stock). El de soporte dura
2 horas: si pisara el del dueño, el dueño —logueado en otra caja— se quedaría
sin B2B a las dos horas.

Por eso **la entrada de soporte no reemplaza un token del comercio que siga
vigente**. Consecuencia: mientras el equipo Nexo está adentro, lo que NexoPOS le
pida a B2B (por ejemplo una compra a un mayorista) viaja con el token **del
comercio**, no con el de soporte. Del lado de ustedes:

- `anotarUsoNexoPOS` lo va a contar como uso del comercio.
- Una orden a un mayorista hecha en modo soporte no llega marcada como soporte.
  De nuestro lado sí queda registrado quién operó.

Si el comercio no tenía token (nunca entró a NexoPOS) o el suyo venció, se
guarda el de soporte para que la caja funcione esas 2 horas.

Si prefieren que las llamadas a B2B en modo soporte vayan con el token de
soporte, se puede: avisen y lo cambiamos.

## Cómo probar, cuando avisemos

Desde el admin, «NexoPOS» en un comercio de prueba. Casos: entrada correcta,
franja visible, Salir, recargar `/entrar` (410 → login), usar el enlace después
de 2 minutos (410 → login), comercio suspendido (403 → mensaje).
