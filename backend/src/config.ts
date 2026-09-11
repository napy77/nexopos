import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://nexopos:nexopos@localhost:5433/nexopos",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  nexob2b: {
    apiUrl: process.env.NEXOB2B_API_URL || null, // null → modo mock
    publishableKey: process.env.NEXOB2B_PUBLISHABLE_KEY ?? "",
    /**
     * Dominio con el que se arman las URLs de logos e imágenes. Va separado
     * de apiUrl porque quien descarga esas imágenes es el navegador del
     * comercio, no este servidor: si algún día el backend hablara con
     * NexoB2B por una IP interna, las imágenes tienen que seguir apuntando
     * al dominio público.
     */
    publicUrl:
      process.env.NEXOB2B_PUBLIC_URL || process.env.NEXOB2B_API_URL || "https://nexob2b.app",
  },
  /**
   * Clave que usan los otros sistemas de Nexo para hablarnos servidor a
   * servidor. Hoy la usa el admin de B2B para verificar si un slug está libre
   * antes de crear una región.
   *
   * Vacía deja los endpoints de plataforma cerrados: es preferible que B2B no
   * pueda verificar —y no guarde la región— a que cualquiera pueda.
   */
  platformKey: process.env.NEXOPOS_PLATFORM_KEY || "",

  clubpay: {
    // Vacío → modo mock, con socios de prueba para el mostrador
    apiUrl: process.env.CLUBPAY_API_URL || "",
    /**
     * Los resúmenes de cuenta corriente arrancan retenidos, y se sueltan
     * poniendo esto en "on".
     *
     * No es prudencia genérica: hasta que ClubPay despliegue la adjudicación de
     * movimientos a su resumen, la misma compra queda contada dos veces —una en
     * el saldo y otra en el pendiente del resumen— y al cliente le aparece el
     * doble. Es preferible que no lleguen a que lleguen mal.
     *
     * Se sueltan cuando ellos confirmen. Mientras tanto se acumulan en la
     * cola: nada se pierde, sale todo junto en la primera vuelta.
     */
    enviarResumenes: (process.env.CLUBPAY_STATEMENTS || "").toLowerCase() === "on",
  },
};
