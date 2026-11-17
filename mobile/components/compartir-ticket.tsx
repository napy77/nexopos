import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Text, TextInput, View } from "react-native";
import qrcode from "qrcode-generator";
import { api, API_URL, mensaje } from "@/lib/api";
import { Aviso, Boton, Hoja } from "@/components/ui";
import { s } from "@/lib/tema";

/**
 * El ticket sin ticketera: un link al PDF que el backend firma
 * (`/api/sales/:id/ticket.link`), para mandarlo por WhatsApp o mostrarlo en un
 * QR que el cliente escanea con su cámara. El QR va en la pantalla del
 * mostrador y no al revés: el QR de contacto de WhatsApp no trae el número y
 * no deja mandar un mensaje armado.
 */
export function CompartirTicket({ saleId, ticketNumber, onCerrar }: {
  saleId: number | null; ticketNumber?: number; onCerrar: () => void;
}) {
  const [url, setUrl] = useState("");
  const [comercio, setComercio] = useState("");
  const [numero, setNumero] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (saleId == null) return;
    setUrl(""); setError(""); setNumero("");
    let vigente = true;
    Promise.all([
      api<{ path: string }>(`/api/sales/${saleId}/ticket.link`),
      api<{ commerce_name: string; customer_phone: string | null }>(`/api/sales/${saleId}`),
    ]).then(([link, venta]) => {
      if (!vigente) return;
      setUrl(API_URL + link.path);
      setComercio(venta.commerce_name);
      if (venta.customer_phone) setNumero(venta.customer_phone);
    }).catch((e) => vigente && setError(mensaje(e, "No se pudo armar el link del ticket")));
    return () => { vigente = false; };
  }, [saleId]);

  function mandar() {
    const wa = numeroWhatsApp(numero);
    if (!wa) {
      setError("Revisá el número: código de área sin el 0 y sin el 15, por ejemplo 351 555 1234.");
      return;
    }
    setError("");
    const texto = `Hola, te mando el ticket de tu compra${comercio ? ` en ${comercio}` : ""}: ${url}`;
    Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(texto)}`)
      .catch(() => setError("No se pudo abrir WhatsApp en este dispositivo."));
  }

  return (
    <Hoja visible={saleId != null} titulo={ticketNumber ? `Ticket #${ticketNumber}` : "Ticket"} onCerrar={onCerrar}>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!url && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {url ? (
        <>
          <View style={[s.tarjeta, { gap: 10 }]}>
            <Text style={s.subtitulo}>Mandar por WhatsApp</Text>
            <TextInput
              style={s.input}
              value={numero}
              onChangeText={setNumero}
              placeholder="Celular, ej. 351 555 1234"
              keyboardType="phone-pad"
              returnKeyType="send"
              onSubmitEditing={mandar}
            />
            <Boton onPress={mandar} desactivado={!numero.trim()}>Abrir WhatsApp</Boton>
          </View>
          <View style={[s.tarjeta, { gap: 10, alignItems: "center" }]}>
            <Text style={s.subtitulo}>O que lo escanee el cliente</Text>
            <Qr valor={url} />
            <Text style={[s.apagado, { textAlign: "center" }]}>
              Con la cámara del celular, sin instalar nada. Abre el ticket en PDF.
            </Text>
          </View>
        </>
      ) : null}
    </Hoja>
  );
}

/**
 * Celular argentino al formato de wa.me: 549 + área + número, 13 dígitos.
 * Acepta lo que tipea el cajero o lo que quedó en la ficha del cliente
 * («0351 15-555-1234», «+54 9 351…»). El 15 sólo se puede sacar cuando
 * sobra: con 10 dígitos no se sabe dónde termina el código de área.
 */
export function numeroWhatsApp(entrada: string): string | null {
  let d = entrada.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 12) {
    // área de 2 a 4 dígitos seguida de 15: el único caso en que sobran dos
    for (const area of [2, 3, 4]) {
      if (d.slice(area, area + 2) === "15") { d = d.slice(0, area) + d.slice(area + 2); break; }
    }
  }
  return d.length === 10 ? `549${d}` : null;
}

/** QR dibujado con vistas: sin módulo nativo, anda en la app ya instalada. */
function Qr({ valor, lado = 240 }: { valor: string; lado?: number }) {
  const filas = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(valor);
    qr.make();
    const n = qr.getModuleCount();
    // Tramos oscuros por fila: un View por tramo y no por módulo
    return Array.from({ length: n }, (_, r) => {
      const tramos: { desde: number; largo: number }[] = [];
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        const desde = c;
        while (c + 1 < n && qr.isDark(r, c + 1)) c++;
        tramos.push({ desde, largo: c - desde + 1 });
      }
      return tramos;
    });
  }, [valor]);
  const n = filas.length;
  const margen = 4; // la zona blanca que piden los lectores alrededor
  const modulo = lado / (n + margen * 2);
  return (
    <View style={{ width: lado, height: lado, backgroundColor: "#fff", padding: modulo * margen }}>
      {filas.map((tramos, r) => (
        <View key={r} style={{ height: modulo, flexDirection: "row" }}>
          {tramos.map((t) => (
            <View key={t.desde} style={{
              position: "absolute", left: t.desde * modulo, width: t.largo * modulo + 0.5,
              // +0.5 tapa la costura entre vistas vecinas que deja el redondeo de píxeles
              height: modulo + 0.5, backgroundColor: "#000",
            }} />
          ))}
        </View>
      ))}
    </View>
  );
}
