-- Сколько клиент фактически заплатил (amountPaid внешнего API), в копейках.
-- NULL — строка сохранена до появления колонки; заполняется повторным POST /sync.
ALTER TABLE orders ADD COLUMN paid_kop BIGINT CHECK (paid_kop >= 0 AND paid_kop <= amount_kop);
