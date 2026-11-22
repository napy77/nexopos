import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

/**
 * Ingreso con huella o Face ID. El JWT dura 12 h y no hay token de
 * renovación, así que lo que se guarda son el email y la contraseña de
 * NexoB2B, en el Keychain / Keystore atados a la biometría del teléfono: sin
 * la huella no se pueden leer, ni siquiera desde la app. Al ingresar se hace
 * el mismo login de siempre con esos datos.
 */

const K_DATOS = "nexopos_bio_datos";
// El email sin protección: dice si hay datos guardados sin pedir la huella
const K_EMAIL = "nexopos_bio_email";
// Para no volver a ofrecerlo en cada login después de un "Ahora no"
const K_NO = "nexopos_bio_no";

export interface Biometria { disponible: boolean; nombre: string }

/** Qué tiene el teléfono, para el texto del botón. Sin huella cargada, no hay. */
export async function biometria(): Promise<Biometria> {
  const [hay, cargada, tipos] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const cara = tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const nombre = Platform.OS === "ios" ? (cara ? "Face ID" : "Touch ID") : "huella";
  return { disponible: hay && cargada && SecureStore.canUseBiometricAuthentication(), nombre };
}

export const emailGuardado = () => SecureStore.getItemAsync(K_EMAIL);
export const rechazado = async () => (await SecureStore.getItemAsync(K_NO)) === "1";
export const rechazar = () => SecureStore.setItemAsync(K_NO, "1");

/** En Android pide la huella también para guardar: la llave nace atada a ella. */
export async function guardar(email: string, password: string, nombre: string): Promise<void> {
  await SecureStore.setItemAsync(K_DATOS, JSON.stringify({ email, password }), {
    requireAuthentication: true,
    authenticationPrompt: `Confirmá con ${nombre} para activarlo`,
  });
  await SecureStore.setItemAsync(K_EMAIL, email);
  await SecureStore.deleteItemAsync(K_NO);
}

/**
 * Pide la huella y devuelve los datos. `null` es que ya no sirven (cambiaron
 * las huellas del teléfono y el sistema invalidó la llave): se borran y hay
 * que volver a la contraseña. Si el cajero cancela, tira error.
 */
export async function leer(nombre: string): Promise<{ email: string; password: string } | null> {
  const datos = await SecureStore.getItemAsync(K_DATOS, {
    requireAuthentication: true,
    authenticationPrompt: `Ingresar a NexoPOS con ${nombre}`,
  });
  if (!datos) {
    await olvidar();
    return null;
  }
  try {
    return JSON.parse(datos);
  } catch {
    await olvidar();
    return null;
  }
}

export async function olvidar(): Promise<void> {
  await SecureStore.deleteItemAsync(K_DATOS);
  await SecureStore.deleteItemAsync(K_EMAIL);
}
