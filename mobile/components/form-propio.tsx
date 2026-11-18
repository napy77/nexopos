import { useState } from "react";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";
import { api, leerNumero, mensaje } from "@/lib/api";
import { useTaxonomia } from "@/lib/taxonomia";
import { color, s } from "@/lib/tema";
import type { StockItem } from "@/lib/tipos";
import { CampoBusqueda } from "@/components/escaner";
import { Aviso, Boton, Chip } from "./ui";

/**
 * Alta o edición de un producto que no está en el catálogo de NexoB2B:
 * fraccionados, elaboración propia, mercadería comprada por fuera.
 * Al editar sólo se toca la ficha; precio y stock van por la pantalla del
 * producto, igual que en la web.
 */
export function FormPropio({ inicial, eanInicial, onListo }: {
  inicial?: StockItem;
  eanInicial?: string;
  onListo: (mensaje: string) => void;
}) {
  const tax = useTaxonomia();
  const editando = !!inicial;
  const [nombre, setNombre] = useState(inicial?.name ?? "");
  const [marca, setMarca] = useState(inicial?.brand ?? "");
  const [ean, setEan] = useState(inicial?.ean ?? eanInicial ?? "");
  const [plu, setPlu] = useState(inicial?.plu ?? "");
  const [porPeso, setPorPeso] = useState(inicial?.venta_por_peso ?? false);
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [pasilloId, setPasilloId] = useState(inicial?.pasillo_id ?? "");
  const [rubroId, setRubroId] = useState(inicial?.rubro_id ?? "");
  const [subrubroId, setSubrubroId] = useState(inicial?.subrubro_id ?? "");
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [minimo, setMinimo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rubros = (tax?.rubros ?? []).filter((r) => r.pasillo_id === pasilloId);
  const subrubros = (tax?.subrubros ?? []).filter((x) => x.rubro_id === rubroId);

  async function guardar() {
    setError("");
    if (!nombre.trim()) { setError("Falta el nombre."); return; }
    const salePrice = leerNumero(precio);
    if (!editando && !(salePrice && salePrice > 0)) {
      setError("Falta el precio de venta: sin precio no se puede vender en el mostrador.");
      return;
    }
    const ficha = {
      nombre: nombre.trim(),
      marca: marca.trim() || undefined,
      ean: ean.trim() || undefined,
      plu: plu.trim() || undefined,
      ventaPorPeso: porPeso,
      descripcion: descripcion.trim() || undefined,
      pasilloId: pasilloId || undefined,
      pasilloNombre: tax?.pasillos.find((p) => p.id === pasilloId)?.nombre,
      rubroId: rubroId || undefined,
      rubroNombre: tax?.rubros.find((r) => r.id === rubroId)?.nombre,
      subrubroId: subrubroId || undefined,
      subrubroNombre: tax?.subrubros.find((x) => x.id === subrubroId)?.nombre,
    };
    setBusy(true);
    try {
      if (editando) {
        await api(`/api/stock/producto-propio/${inicial.product_id}`, { method: "PUT", body: ficha });
        onListo("Producto actualizado.");
      } else {
        await api("/api/stock/producto-propio", {
          body: {
            ...ficha,
            quantity: leerNumero(cantidad) ?? 0,
            cost: leerNumero(costo) ?? undefined,
            salePrice,
            minStock: leerNumero(minimo) ?? undefined,
          },
        });
        onListo(`«${ficha.nombre}» creado y cargado en tu stock.`);
      }
    } catch (e) {
      setError(mensaje(e, "No se pudo guardar el producto"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Campo etiqueta="Nombre *">
        <TextInput style={s.input} value={nombre} onChangeText={setNombre} placeholder="Ej. Jamón cocido feteado" />
      </Campo>
      <Campo etiqueta="Marca">
        <TextInput style={s.input} value={marca} onChangeText={setMarca} />
      </Campo>
      <View style={[s.fila, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1 }}>
          <Campo etiqueta="Código de barras">
            <CampoBusqueda value={ean} onChangeText={setEan} onEscaneo={setEan} keyboardType="number-pad" />
          </Campo>
        </View>
        <View style={{ flex: 1 }}>
          <Campo etiqueta="Código de balanza">
            <TextInput style={s.input} value={plu} onChangeText={setPlu} keyboardType="number-pad" />
          </Campo>
        </View>
      </View>
      <View style={[s.entre, s.tarjeta, { padding: 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.texto}>Se vende por peso</Text>
          <Text style={s.apagado}>El precio es por kilo; la cantidad la pone la balanza.</Text>
        </View>
        <Switch value={porPeso} onValueChange={setPorPeso} trackColor={{ true: color.primario }} />
      </View>

      {tax && (
        <Campo etiqueta="Pasillo">
          <Chips>
            {tax.pasillos.map((p) => (
              <Chip key={p.id} activo={pasilloId === p.id}
                onPress={() => { setPasilloId(pasilloId === p.id ? "" : p.id); setRubroId(""); setSubrubroId(""); }}>
                {p.nombre}
              </Chip>
            ))}
          </Chips>
        </Campo>
      )}
      {rubros.length > 0 && (
        <Campo etiqueta="Rubro">
          <Chips>
            {rubros.map((r) => (
              <Chip key={r.id} activo={rubroId === r.id}
                onPress={() => { setRubroId(rubroId === r.id ? "" : r.id); setSubrubroId(""); }}>
                {r.nombre}
              </Chip>
            ))}
          </Chips>
        </Campo>
      )}
      {subrubros.length > 0 && (
        <Campo etiqueta="Subrubro">
          <Chips>
            {subrubros.map((x) => (
              <Chip key={x.id} activo={subrubroId === x.id} onPress={() => setSubrubroId(subrubroId === x.id ? "" : x.id)}>
                {x.nombre}
              </Chip>
            ))}
          </Chips>
        </Campo>
      )}

      <Campo etiqueta="Descripción">
        <TextInput style={[s.input, { minHeight: 70 }]} value={descripcion} onChangeText={setDescripcion} multiline />
      </Campo>

      {!editando && (
        <>
          <View style={s.fila}>
            <View style={{ flex: 1 }}>
              <Campo etiqueta={porPeso ? "Precio por kg *" : "Precio de venta *"}>
                <TextInput style={s.input} value={precio} onChangeText={setPrecio} keyboardType="decimal-pad" />
              </Campo>
            </View>
            <View style={{ flex: 1 }}>
              <Campo etiqueta="Costo">
                <TextInput style={s.input} value={costo} onChangeText={setCosto} keyboardType="decimal-pad" />
              </Campo>
            </View>
          </View>
          <View style={s.fila}>
            <View style={{ flex: 1 }}>
              <Campo etiqueta="Cantidad que tenés">
                <TextInput style={s.input} value={cantidad} onChangeText={setCantidad} keyboardType="decimal-pad" placeholder="0" />
              </Campo>
            </View>
            <View style={{ flex: 1 }}>
              <Campo etiqueta="Stock mínimo">
                <TextInput style={s.input} value={minimo} onChangeText={setMinimo} keyboardType="decimal-pad" placeholder="0" />
              </Campo>
            </View>
          </View>
        </>
      )}

      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      <Boton grande cargando={busy} onPress={guardar}>{editando ? "Guardar ficha" : "Crear producto"}</Boton>
    </View>
  );
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.apagado}>{etiqueta}</Text>
      {children}
    </View>
  );
}

function Chips({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}
