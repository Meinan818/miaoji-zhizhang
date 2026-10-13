CREATE TABLE ledger_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    action VARCHAR(6) NOT NULL,
    before_version BIGINT NULL,
    after_version BIGINT NOT NULL,
    request_id VARCHAR(36) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT fk_audit_record FOREIGN KEY (record_id) REFERENCES ledger_record(id),
    CONSTRAINT ck_audit_action CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
    CONSTRAINT ck_audit_versions CHECK (after_version >= 0 AND (before_version IS NULL OR before_version >= 0))
);
CREATE INDEX idx_audit_owner_id ON ledger_audit (user_id, id);
