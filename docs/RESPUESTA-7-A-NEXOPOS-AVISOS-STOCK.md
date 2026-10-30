# Respuesta a NexoPOS: avisos de stock que no llegaban

**De:** Nexo B2B · **Para:** NexoPOS · **Fecha:** 29/10/2026
**Sobre:** su pedido del 28/10 («los avisos de stock nunca llegaron a NexoPOS»)

Gracias por el diagnóstico: estaba bien orientado y nos ahorró tiempo.

## Qué encontramos, punto por punto

### 1. Red: descartado

El servidor de B2B ya resuelve nexopos.app a la IP interna (`192.168.255.169`) por
`/etc/hosts`. `curl https://nexopos.app/health` → `200` en 25 ms.

### 2. El filtro: era esto, y ya está corregido

Tenían razón. El aviso sólo salía si existía una `nexo_api_key` activa de tipo
`nexopos` para el comercio. Después de la puerta única nadie tenía motivo para
crearla, así que el aviso no salía nunca y no quedaba rastro.

No sacamos la condición del todo, la cambiamos: ahora se avisa a los comercios
que **usan** NexoPOS, según una marca que B2B anota sola cada vez que ustedes
llaman a `/api/v1/pos/*` con el token del comercio. Así el `404` de «no conozco
este comercio» sigue sirviendo de alarma y nadie tiene que crear una key que no
hace nada.

### 3. El despliegue: correcto

El servidor tiene la puerta única y `NEXOPOS_PLATFORM_KEY`.

## Una aclaración sobre Rivera Hogar

En B2B hay dos comercios híbridos con el vínculo confirmado: **Rivera Hogar** y
**Supermercado Delfín** (`01M2NTX67PHJJRGZZ1NXN1AGWP`).

Con el filtro nuevo, el aviso sale a los comercios que usan NexoPOS, y eso lo
sabemos porque ustedes llaman a `/api/v1/pos/*` con el token del comercio.
**Rivera Hogar no registra ninguna llamada desde el 20/10**; Delfín registra una,
el 24/10. Si el mostrador de Rivera está vendiendo y bajando stock en B2B, entra
con otra cuenta. ¿Pueden fijarse con qué comercio se loguea esa caja? Si es la de
Rivera Hogar, a la primera venta queda anotado y los avisos empiezan a salir.

## Prueba de hoy: los avisos llegan, pero se aplican 0

Hoy Delfín subió su lista completa. Los avisos salieron y ustedes respondieron OK,
pero con 0 aplicados en todos:

```
[nexopos] stock 01M2NTX67PHJJRGZZ1NXN1AGWP (csv): 299 enviadas, 0 aplicadas
[nexopos] stock 01M2NTX67PHJJRGZZ1NXN1AGWP (csv): 288 enviadas, 0 aplicadas
[nexopos] stock 01M2NTX67PHJJRGZZ1NXN1AGWP (csv): 300 enviadas, 0 aplicadas
```

Lo que nos ayudaría saber:

1. **¿El interruptor de Delfín está prendido?** Si está apagado y por eso no
   aplican, ¿pueden mandar un `motivo` en la respuesta (por ejemplo
   `"interruptor_apagado"`)? Lo registramos tal cual, y así no tenemos que adivinar.
2. **Si está prendido**, ¿qué les llegó? Cada ítem trae `presentacion_id`,
   `pmp_id` y `stock`. Si no los encuentran, ¿devuelven `no_encontrados`? Hoy
   no lo vemos en la respuesta.
3. **Tamaño:** con la opción «stock completo», Delfín puso en 0 de una vez
   6.168 presentaciones y ese aviso salió en un solo pedido, que no llegó.
   Ya lo corregimos: ahora todo aviso sale en tandas de 300, una detrás de otra.

## Cómo seguimos

1. Nos confirman que el interruptor de Delfín está prendido.
2. Nosotros **reenviamos el stock actual completo de Delfín** (unas 7.400
   presentaciones, en tandas de 300, con `origen: "resync"`). Va el valor
   actual, no una diferencia: deja el POS igual a B2B sin importar qué avisos
   se perdieron.
3. Cambiamos el stock de un producto desde el portal y miramos juntos:
   nosotros la línea del log, ustedes el movimiento `NexoB2B (portal)`.
