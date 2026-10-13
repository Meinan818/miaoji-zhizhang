-- 不用服务器时间补写旧业务记录；原有时间未知的记录保持NULL。
ALTER TABLE ledger_record ADD COLUMN business_time CHAR(5) NULL;
