# Pedido a NexoB2B: «Activar cuenta» de NexoPOS directo al login

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 20/10/2026 · **Tamaño:** un cambio de una línea

## Qué cambió de nuestro lado

Antes, `nexopos.app/` mandaba directo a la caja y de ahí al login. Ahora la raíz
es el **sitio institucional** de NexoPOS, con dos botones: **Ingresar**
(`/login`) y **Crear cuenta gratis**, que lleva al alta de ustedes
(`https://nexob2b.app/comercio/registro`), porque NexoPOS no tiene registro
propio.

## Qué pedimos

La tarjeta de NexoPOS en el perfil del comercio apunta hoy a la raíz:

```
apps/storefront/src/app/(portal)/comercio/perfil/Integraciones.tsx
  const NEXOPOS_URL = process.env.NEXT_PUBLIC_NEXOPOS_URL || "https://www.nexopos.app"
  …
  <a href={NEXOPOS_URL} …>Activar cuenta →</a>
```

Pedimos que el enlace vaya a **`/login`**:

```tsx
<a href={`${NEXOPOS_URL}/login`} …>Activar cuenta →</a>
```

Conviene agregar `/login` en el `href` y no en la variable, para que
`NEXT_PUBLIC_NEXOPOS_URL` siga siendo la base de NexoPOS si la usan en otro lado.

## Por qué

Sin este cambio, un comercio que viene de «Activar cuenta» cae en una página
pensada para quien todavía no tiene cuenta, con el botón «Crear cuenta gratis»
bien visible. Ese comercio **ya** tiene cuenta. Le sumamos un clic y la chance
de que se registre dos veces.

El texto que está debajo del botón («Vas a NexoPOS, ingresás tus credenciales y
queda vinculado con este comercio») sigue siendo correcto y no hay que tocarlo.

## Orden y compatibilidad

- `/login` ya existe en producción, así que **se puede desplegar antes o
  después que nosotros**: no depende de nada nuestro.
- No cambia ningún contrato de API. El login sigue siendo
  `POST /store/comercios/auth` contra ustedes, con las mismas credenciales.
- Si algún día cambiamos la ruta del login, les avisamos por acá antes.
