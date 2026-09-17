# Vincular escaneando un QR en el mostrador

Un pedido chico con un argumento que no es el que parece.

## Lo que hay hoy

`POST /pos/customers` recibe un DNI y propone la vinculación. La persona la
acepta desde la app. Funciona.

## Lo que pedimos

Que se pueda **iniciar una vinculación desde un QR** que el comerciante muestra
en su pantalla, y que la app confirme escaneándolo.

Algo así, y la forma la definen ustedes:

```
NexoPOS pide el QR        POST /pos/customers/vinculo-qr   { external_id }
                          → { qr_payload, expira_at }

el comerciante lo muestra en su pantalla
la persona lo escanea con la app de ClubPay
la app confirma contra ustedes

ustedes nos avisan        POST /api/clubpay/webhook/vinculacion   (el que ya existe)
                          { external_id, status: "vinculada", account_id }
```

El aviso de vuelta ya existe y anda: es el mismo webhook que usan hoy cuando
alguien acepta una propuesta. No hace falta nada nuevo de ese lado.

## Por qué, y no es por comodidad

El argumento obvio es que escanear es más rápido que tipear un documento. Ese no
es el motivo.

**El QR no ata un DNI a una persona: ata una ficha a una persona.**

Hoy la vinculación va por documento, y el documento puede estar mal escrito. En
la pantalla de clientes de un comercio real hay dos fichas del mismo señor:

```
documento 2698535     teléfono 0351155630140    saldo $850,00
documento 26098535    teléfono 3515630140       saldo $27.519,20
```

Es el mismo documento con un dígito comido y el mismo teléfono escrito de dos
formas. Son el día uno de este sistema, con el nombre del fundador. Un almacén
con seiscientos clientes cargados a mano durante quince años va a tener decenas.

Vinculando por DNI, acá hay que elegir entre mostrarle a esa persona una cuenta
de $850 o una de $27.519,20, y las dos opciones son incorrectas.

Con el QR no hay nada que elegir: **el comerciante tiene abierta la ficha de
$27.519,20 y muestra el QR de esa ficha.** La persona escanea y queda vinculada a
ésa. El `external_id` viaja en el QR, no el documento, así que el dato mal
escrito deja de participar.

Para todos los clientes nuevos el problema desaparece, sin resolver un solo
duplicado viejo.

## Y es el único momento donde la identidad está verificada por alguien

El QR se muestra justo cuando el comerciante termina de dar de alta la cuenta
corriente: el cliente está parado ahí, hay un documento sobre la mesa y hay dos
personas mirándose. Es el único instante de todo el sistema donde la identidad
la verificó un humano que responde por ella.

Hoy ese momento se desaprovecha: se crea la cuenta, y en algún otro momento y
por otro camino la persona "vincula desde ClubPay". Entre esos dos momentos hay
un hueco que se llena adivinando.

## Lo que ponemos nosotros

La pantalla. La maquinaria de QR ya la tenemos del cobro por QR del mostrador,
así que en cuanto exista el `qr_payload` lo mostramos al terminar el alta y en
la ficha del cliente.

## Una pregunta

¿La app puede escanear un QR y confirmarle a su backend que ese pedido de
vínculo es suyo? Si hoy la cámara sólo sirve para cobrar, esto es más trabajo del
que parece y preferimos saberlo antes que pedirlo.
