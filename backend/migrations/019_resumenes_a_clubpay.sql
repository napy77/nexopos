-- Los resúmenes se le mandan a ClubPay, y se REENVÍAN.
--
-- ClubPay no puede derivar cuánto se pagó de un resumen: ve los pagos que
-- salieron por su app, no los que la persona hizo en efectivo en el mostrador,
-- que en el fiado de pueblo son la mayoría. Un resumen que dice "debés $47.300"
-- cuando ya pagó $20.000 en efectivo es peor que no mostrar nada.
--
-- Por eso no alcanza con avisar el cierre una vez: cada vez que cambia lo
-- pagado hay que volver a mandarlo. Su endpoint es idempotente por
-- statement_id justamente para esto.
ALTER TABLE account_periods ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE account_periods ADD COLUMN IF NOT EXISTS clubpay_synced_at TIMESTAMPTZ;

-- Los que están desactualizados son pocos; el índice parcial mantiene barata la
-- consulta del worker aunque la tabla crezca por años.
CREATE INDEX IF NOT EXISTS idx_periodos_por_sincronizar
  ON account_periods (updated_at)
  WHERE status <> 'abierto';
