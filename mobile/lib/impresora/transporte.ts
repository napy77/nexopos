import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, State, type Device } from "react-native-ble-plx";
import TcpSocket from "react-native-tcp-socket";
import { aBase64, deBase64 } from "./bytes";
import type { ConfigImpresora } from "./config";

/** Cómo llegan los bytes a la ticketera. Todo entra y sale en base64. */

let ble: BleManager | null = null;
const manager = () => (ble ??= new BleManager());

/** Android 12+ pide los permisos de Bluetooth en tiempo de ejecución. */
export async function pedirPermisosBluetooth(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (Number(Platform.Version) < 31) {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  }
  const r = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  return Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

// ── Red ──────────────────────────────────────────────────────────────────────

function porRed(host: string, puerto: number, base64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let listo = false;
    const fin = (err?: Error) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    // Una impresora apagada no contesta nunca: sin esto el cajero espera para siempre
    const reloj = setTimeout(() => fin(new Error("La ticketera no contesta")), 8000);
    const socket = TcpSocket.createConnection({ host, port: puerto }, () => {
      socket.write(base64, "base64", (err) => {
        if (err) return fin(err);
        // Dar tiempo a que salgan los bytes antes de cortar la conexión
        setTimeout(() => fin(), 300);
      });
    });
    socket.on("error", (e) => fin(e instanceof Error ? e : new Error(String(e))));
  });
}

// ── BLE ──────────────────────────────────────────────────────────────────────

/** Busca ticketeras BLE cerca durante `segundos`, avisando cada una que aparece. */
export async function buscarBle(alEncontrar: (d: { id: string; nombre: string }) => void, segundos = 8): Promise<void> {
  if (!(await pedirPermisosBluetooth())) throw new Error("Hace falta el permiso de Bluetooth.");
  const m = manager();
  if ((await m.state()) !== State.PoweredOn) throw new Error("Prendé el Bluetooth del dispositivo.");
  const vistos = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    m.startDeviceScan(null, null, (error, device) => {
      if (error) { m.stopDeviceScan(); reject(error); return; }
      if (!device || vistos.has(device.id)) return;
      const nombre = device.name ?? device.localName;
      // Las que no se anuncian con nombre son relojes, auriculares y demás
      if (!nombre) return;
      vistos.add(device.id);
      alEncontrar({ id: device.id, nombre });
    });
    setTimeout(() => { m.stopDeviceScan(); resolve(); }, segundos * 1000);
  });
}

/** Servicios estándar de BLE que no son de la impresora */
const GENERICOS = ["1800", "1801", "180a", "180f"];

async function porBle(id: string, base64: string): Promise<void> {
  if (!(await pedirPermisosBluetooth())) throw new Error("Hace falta el permiso de Bluetooth.");
  const m = manager();
  let device: Device = (await m.isDeviceConnected(id))
    ? (await m.devices([id]))[0]
    : await m.connectToDevice(id, { timeout: 8000 });
  device = await device.discoverAllServicesAndCharacteristics();
  if (Platform.OS === "android") device = await device.requestMTU(185).catch(() => device);

  // Cada marca usa su propio servicio: se toma la primera característica que
  // acepte escritura fuera de los servicios estándar.
  let destino: { servicio: string; caracteristica: string; sinRespuesta: boolean } | null = null;
  for (const srv of await device.services()) {
    if (GENERICOS.some((g) => srv.uuid.toLowerCase().startsWith(`0000${g}`))) continue;
    const c = (await srv.characteristics()).find((x) => x.isWritableWithoutResponse || x.isWritableWithResponse);
    if (c) { destino = { servicio: srv.uuid, caracteristica: c.uuid, sinRespuesta: c.isWritableWithoutResponse }; break; }
  }
  if (!destino) throw new Error("Ese dispositivo no parece una ticketera.");

  // De a pedazos chicos: el paquete BLE es corto y la térmica tiene poco buffer
  const bytes = deBase64(base64);
  const TROZO = Math.max(20, ((device.mtu ?? 23) - 3));
  for (let i = 0; i < bytes.length; i += TROZO) {
    const parte = aBase64(bytes.slice(i, i + TROZO));
    if (destino.sinRespuesta) {
      await m.writeCharacteristicWithoutResponseForDevice(id, destino.servicio, destino.caracteristica, parte);
      await new Promise((r) => setTimeout(r, 20));
    } else {
      await m.writeCharacteristicWithResponseForDevice(id, destino.servicio, destino.caracteristica, parte);
    }
  }
}

// ── Bluetooth clásico (sólo Android) ─────────────────────────────────────────

/*
 * El módulo se carga recién al usarlo: en iOS no está enlazado (ver
 * react-native.config.js) y un import arriba del todo rompería la app al abrir.
 */
function clasico() {
  if (Platform.OS !== "android") throw new Error("El Bluetooth clásico sólo anda en Android.");
  return require("react-native-bluetooth-classic").default as typeof import("react-native-bluetooth-classic").default;
}

/** Las vinculadas desde los ajustes de Android: el clásico no se busca desde la app. */
export async function vinculadasClasico(): Promise<{ id: string; nombre: string }[]> {
  if (!(await pedirPermisosBluetooth())) throw new Error("Hace falta el permiso de Bluetooth.");
  const bt = clasico();
  if (!(await bt.isBluetoothEnabled())) throw new Error("Prendé el Bluetooth del dispositivo.");
  return (await bt.getBondedDevices()).map((d) => ({ id: d.address, nombre: d.name || d.address }));
}

async function porClasico(direccion: string, base64: string): Promise<void> {
  if (!(await pedirPermisosBluetooth())) throw new Error("Hace falta el permiso de Bluetooth.");
  const bt = clasico();
  const conectado = await bt.isDeviceConnected(direccion).catch(() => false);
  const device = conectado ? await bt.getConnectedDevice(direccion) : await bt.connectToDevice(direccion);
  await device.write(base64, "base64");
}

// ── Entrada única ────────────────────────────────────────────────────────────

export async function enviar(config: ConfigImpresora, base64: string): Promise<void> {
  try {
    switch (config.tipo) {
      case "red": return await porRed(config.host, config.puerto, base64);
      case "ble": return await porBle(config.dispositivo, base64);
      case "clasico": return await porClasico(config.dispositivo, base64);
      default: throw new Error("No hay ticketera elegida. Configurala en Ajustes.");
    }
  } catch (err) {
    // El motivo real viene en inglés y del sistema. Al cajero le sirve saber dónde se arregla.
    const detalle = err instanceof Error ? err.message : String(err);
    throw new Error(
      config.tipo === "ninguna" ? detalle
        : `No se pudo imprimir (${detalle}). Revisá que la ticketera esté prendida y elegida en Ajustes.`
    );
  }
}
