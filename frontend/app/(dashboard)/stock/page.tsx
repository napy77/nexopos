import { redirect } from "next/navigation";

/** La pantalla pasó a llamarse Productos: se mantiene el link viejo. */
export default function StockRedirect() {
  redirect("/productos");
}
