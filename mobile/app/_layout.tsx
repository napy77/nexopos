import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSesion } from "@/lib/sesion";
import { useImpresora } from "@/lib/impresora";
import { color } from "@/lib/tema";

export default function RootLayout() {
  const { cargada, token, cargar } = useSesion();
  const cargarImpresora = useImpresora((e) => e.cargar);

  useEffect(() => {
    cargar();
    cargarImpresora();
  }, [cargar, cargarImpresora]);

  if (!cargada) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.fondo }}>
        <ActivityIndicator size="large" color={color.primario} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Sin sesión sólo existe el login; con sesión, la caja. El 401 de la API borra el token y esto vuelve solo al login. */}
        <Stack.Protected guard={!!token}>
          <Stack.Screen name="(pos)" />
        </Stack.Protected>
        <Stack.Protected guard={!token}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
