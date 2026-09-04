# ClubPay · QR mostrado por el comercio

> **Este documento ya cumplió su función.** Era la especificación que le
> pedimos a ClubPay; ellos la implementaron y el contrato vigente es el de
> ellos, en `clubapp/docs/nexopos-cobro-qr.md`. Ante cualquier diferencia,
> manda ese. Queda acá el porqué del diseño, que sigue siendo el mismo.

Especificación de los endpoints que NexoPOS necesita para invertir el flujo del
descuento. **Para el equipo de ClubPay.**

## Por qué hace falta

El flujo actual (`POST /pos/qr/validate`) asume que el comercio escanea el QR
que muestra el socio. En el mostrador real eso casi nunca se puede hacer:

- El comercio tiene un **lector láser de código de barras**, que lee 1D
  (EAN-13). Un QR es 2D y necesita un lector con cámara (*imager*), que es otro
  equipo y bastante más caro.
- La PC del mostrador normalmente no tiene cámara, y si la tiene apunta al
  cajero, no al cliente.

En cambio **el socio siempre tiene cámara**: es su teléfono, y ya tiene ClubPay
instalado. Es el mismo esquema que usan Mercado Pago y MODO, y tiene una
ventaja adicional: el socio confirma la operación en su propio teléfono, viendo
el comercio y el importe antes de aceptar.

Los dos flujos conviven. El comercio que tenga lector 2D o tablet con cámara
puede seguir usando el actual; el resto necesita este.

## Flujo propuesto

```
1. El cajero termina el ticket             → NexoPOS: POST /pos/charges
2. NexoPOS muestra el QR en pantalla       ← charge_id + qr_payload
3. El socio escanea con ClubPay
4. ClubPay le muestra: comercio, importe, su descuento → el socio confirma
5. ClubPay registra la transacción
6. NexoPOS se entera                       → GET /pos/charges/{id} (polling)
7. El cajero cobra el neto y emite el ticket
```

---

## 1. Crear la intención de cobro

```
POST /pos/charges
X-API-Key: pos_...
Content-Type: application/json

{
  "ticket_total_cents": 10000000,
  "external_reference": "nexopos-7-9f3a1c2b"
}
```

`external_reference` lo genera NexoPOS y es único por operación. Sirve para que
un reintento por corte de red no cree dos cobros: si llega dos veces el mismo,
devolver el que ya existe en lugar de uno nuevo.

**Respuesta 201:**

```json
{
  "charge_id": "chg_01J8XYZ",
  "qr_payload": "clubpay://charge/chg_01J8XYZ",
  "expires_at": "2026-09-02T14:32:00Z",
  "status": "pending"
}
```

- **`qr_payload`** es el texto que NexoPOS codifica en el QR que muestra en
  pantalla. Puede ser una URL, un deep link o lo que la app sepa interpretar;
  del lado del POS es opaco.
- **`expires_at`**: sugerimos entre 2 y 5 minutos. Más que el QR del socio
  (60 s) porque acá el que tiene que reaccionar es el cliente sacando el
  teléfono del bolsillo, y el cajero está esperando frente a él.

## 2. Consultar el estado

```
GET /pos/charges/{charge_id}
X-API-Key: pos_...
```

NexoPOS consulta cada ~2 segundos mientras muestra el QR.

**Respuesta 200:**

```json
{
  "charge_id": "chg_01J8XYZ",
  "status": "applied",
  "member": {
    "membership_id": 1,
    "name": "Pedro Gómez",
    "member_number": "CU-00001",
    "club_id": 1,
    "club_name": "Club Unión"
  },
  "offer": {
    "id": 7,
    "description": "20% con tope de $8.000",
    "discount_percent": 20,
    "condiciones": ["Hasta $8.000 por compra"]
  },
  "transaction_id": 8,
  "ticket_total_cents": 10000000,
  "discount_cents": 800000,
  "neto_cents": 9200000,
  "recorte": "por_compra",
  "points_earned": 0
}
```

`status` puede ser:

| Estado | Significa | Qué hace el POS |
|---|---|---|
| `pending` | Todavía nadie escaneó | Sigue mostrando el QR |
| `applied` | El socio confirmó y la transacción quedó registrada | Aplica el descuento y cobra el neto |
| `rejected` | El socio escaneó pero no le corresponde beneficio | Muestra `error` y cobra sin descuento |
| `expired` | Venció sin que nadie lo usara | Ofrece generar otro |
| `cancelled` | Lo canceló el cajero | Cierra la pantalla |

Cuando `status` sea `rejected`, mandar el motivo en `error`, con el mismo
criterio que los demás: escrito en castellano rioplatense para que el cajero se
lo lea al cliente («Este beneficio corre solo los miércoles», «Ya usaste todo
el descuento de este mes»).

Con `applied`, la transacción **ya está registrada**: no hace falta que el POS
llame después a `POST /pos/transactions`. Los importes de esta respuesta son
los definitivos para el comprobante.

## 3. Cancelar

```
POST /pos/charges/{charge_id}/cancel
X-API-Key: pos_...
```

Si el cajero cierra la pantalla o el cliente se arrepiente. Devuelve el charge
con `status: "cancelled"`. Un charge ya aplicado no se puede cancelar por acá
(sigue faltando el endpoint de anulación de transacciones, que es otro tema
pendiente).

---

## Detalle que conviene resolver del lado de ClubPay

**El importe puede cambiar después de generado el QR.** Si el cajero agrega un
producto más mientras el cliente busca el teléfono, el total ya no es el del
charge. NexoPOS lo resuelve cancelando el charge y generando uno nuevo con el
importe actualizado, pero conviene que ClubPay valide contra el
`ticket_total_cents` del charge y no permita aplicar un descuento calculado
sobre un importe viejo.

## Estado

Los endpoints están arriba en `https://api.clubpay.com.ar` y NexoPOS habla
contra ellos. Lo único que hace falta es que `CLUBPAY_API_URL` apunte ahí: con
la variable vacía el POS usa el simulador, que da por escaneado el cobro solo y
dibuja un QR que la app no puede abrir.
