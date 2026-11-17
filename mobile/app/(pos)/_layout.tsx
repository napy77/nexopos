import { Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import { usePedidos } from "@/lib/pedidos";
import { color } from "@/lib/tema";

function icono(emoji: string) {
  return function Icono() {
    return <Text style={{ fontSize: 20 }}>{emoji}</Text>;
  };
}

function BotonAjustes() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.navigate("/ajustes")} hitSlop={12} style={{ paddingHorizontal: 16 }} accessibilityLabel="Ajustes">
      <Text style={{ fontSize: 20 }}>⚙️</Text>
    </Pressable>
  );
}

/**
 * Lo del día a día, los pedidos de la tienda, stock y compras. Márgenes,
 * campañas y configuración siguen en nexopos.app.
 *
 * Ajustes va arriba y no como pestaña: con ocho, en un celular no entra el
 * nombre de cada una, y la ticketera se configura una vez.
 */
export default function PosLayout() {
  const cargarPedidos = usePedidos((p) => p.cargar);
  const sinAceptar = usePedidos((p) => p.pedidos.filter((x) => x.status === "recibido").length);

  // Cada 20 segundos, como la web: un pedido de la tienda tiene que aparecer
  // solo, aunque el cajero esté en otra pestaña
  useEffect(() => {
    cargarPedidos();
    const t = setInterval(cargarPedidos, 20_000);
    return () => clearInterval(t);
  }, [cargarPedidos]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: color.primario,
        headerStyle: { backgroundColor: "#fff" },
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => <BotonAjustes />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Vender", tabBarIcon: icono("🛒") }} />
      <Tabs.Screen name="pedidos" options={{
        title: "Pedidos", tabBarIcon: icono("🛍️"),
        tabBarBadge: sinAceptar || undefined,
        headerTitle: "Pedidos de la tienda",
      }} />
      <Tabs.Screen name="caja" options={{ title: "Caja", tabBarIcon: icono("💰") }} />
      <Tabs.Screen name="ventas" options={{ title: "Ventas", tabBarIcon: icono("🧾") }} />
      <Tabs.Screen name="clientes" options={{ title: "Clientes", tabBarIcon: icono("👤") }} />
      {/* Con siete pestañas «Productos» no entra en un celular: abajo dice Stock */}
      <Tabs.Screen name="productos" options={{ title: "Productos", tabBarLabel: "Stock", tabBarIcon: icono("📦") }} />
      <Tabs.Screen name="compras" options={{ title: "Compras", tabBarIcon: icono("🚚") }} />
      <Tabs.Screen name="ajustes" options={{ title: "Ajustes", href: null, headerRight: () => null }} />
    </Tabs>
  );
}
