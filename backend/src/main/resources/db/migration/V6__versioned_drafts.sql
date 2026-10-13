CREATE TABLE ledger_draft (
    user_id BIGINT NOT NULL,
    id VARCHAR(36) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(9) NOT NULL DEFAULT 'OPEN',
    records_json TEXT NOT NULL,
    receipt_json TEXT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, id),
    CONSTRAINT fk_draft_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT ck_draft_status CHECK (status IN ('OPEN','CONFIRMED','CANCELLED')),
    CONSTRAINT ck_draft_version CHECK (version >= 0),
    CONSTRAINT ck_draft_receipt CHECK ((status='CONFIRMED' AND receipt_json IS NOT NULL)
        OR (status<>'CONFIRMED' AND receipt_json IS NULL))
);
