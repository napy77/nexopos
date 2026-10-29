# Pedido a NexoPOS: ruta `/entrar` para entrar sin contraseña

**De:** Nexo B2B · **Para:** NexoPOS · **Fecha:** 28/10/2026

Completa la **parte 2** del pedido del 24/10 («Login centralizado con Nexo B2B»).
La diferencia: **nuestro lado ya está en producción**. Falta sólo la ruta de ustedes.

## Para qué

El equipo Nexo necesita entrar a la caja de un comercio para ayudarlo
(dudas de los primeros días, dejarle algo cargado) **sin pedirle la contraseña**.
Hoy el botón «NexoPOS» del admin de B2B ya genera el enlace, pero
`https://nexopos.app/entrar?token=…` responde 404.

Más adelante, el «Abrir NexoPOS» del propio comercio en el portal B2B va a usar
exactamente la misma puerta. Con una sola ruta resuelven los dos casos.

## El flujo

1. En B2B alguien toca el botón. B2B genera un token de **un solo uso que vence en 2 minutos**
   y abre `https://www.nexopos.app/entrar?token=<token>`.
   El token es base64url (letras, números, `-` y `_`), 43 caracteres.
2. Su ruta `/entrar` lee el token y lo canjea **desde su servidor**:

```
POST https://nexob2b.app/api/v1/pos/entrada
Authorization: Bearer <NEXOPOS_PLATFORM_KEY>
Content-Type: application/json

{ "token": "<el de la URL>" }
```

3. Respuesta `200`, **con la misma forma que `POST /store/comercios/auth`**, más un campo `soporte`:

```json
{
  "token": "<JWT del comercio>",
  "comercio": { "id": "…", "nombre": "Jure Hnos SRL", … },
  "usuario": null,
  "soporte": {
    "ingreso_id": "ings_…",
    "admin_id": "…",
    "admin_email": "admin@nexob2b.app",
    "desde": "2026-10-29T01:46:38.711Z"
  }
}
```

4. Con ese `token` abren la sesión **igual que después de un login normal**. Es un JWT de
   B2B como cualquier otro: `/api/v1/pos/*` y `GET /store/comercios/me` andan sin cambios.

## Errores

| HTTP | `codigo` | Qué hacer |
|---|---|---|
| 401 | `clave_invalida` | Clave de plataforma mal configurada (de su lado) |
| 404 | `token_invalido` | Mandar a `/login` |
| 410 | `token_vencido` / `token_usado` | Mandar a `/login` |
| 403 | `comercio_suspendido` | Mostrar «El comercio está suspendido» y no entrar |

Cualquier otro error: mandar a `/login`.

## Reglas de seguridad

- **El canje se hace desde su servidor.** La clave de plataforma nunca llega al navegador.
- **Sacan el token de la URL apenas lo leen** (redirect o `history.replaceState`), responden con
  `Referrer-Policy: no-referrer` y **no registran esa query string** en sus logs.
- Si en ese navegador hay otra sesión abierta, **la reemplazan** por la del token.
- El token sirve una sola vez: si el navegador recarga `/entrar`, el segundo canje da `410 token_usado`
  y eso es correcto. Por eso conviene sacarlo de la URL antes de cualquier otra cosa.

## Cuando viene `soporte` (entra el equipo Nexo)

Si la respuesta trae `soporte` distinto de `null`:

1. **Franja visible** en toda la caja, algo como:
   «Modo soporte: estás dentro de *Jure Hnos SRL* como si fueras el cliente. Lo que hagas queda hecho en su cuenta.»
   con un botón **Salir**.
2. **Salir** cierra la sesión de NexoPOS y, si la pestaña se abrió desde B2B (`window.opener`),
   cierra la pestaña; si no, manda a `/login`.
3. **La sesión dura 2 horas**, no 30 días: el JWT ya trae ese `exp`. Al vencer, `401` y a `/login`,
   como cualquier token vencido. Les pedimos que no la extiendan por su cuenta.
4. **Registrar quién operó**: si se hace una venta o una apertura/cierre de caja en modo soporte,
   guardar `soporte.admin_email` como operador. Que el comercio pueda ver que esa venta no la hizo él.
5. Sin `soporte` (entrada del propio comercio, más adelante) se comportan como un login normal.

## Cómo probarlo

1. Nos avisan cuando `/entrar` esté en su ambiente.
2. Desde el admin de B2B tocamos «NexoPOS» en un comercio de prueba y les pasamos el resultado.
3. Casos a ver: entrada correcta, franja visible, Salir, token recargado (410), token después de
   2 minutos (410), comercio suspendido (403).

Del lado B2B ya está verificado: el enlace se genera, queda registrado y el canje responde.

Si algo de esto choca con cómo tienen armada la sesión, avisen antes de implementar y lo ajustamos.
