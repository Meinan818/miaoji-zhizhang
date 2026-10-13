CREATE TABLE app_user (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE TABLE ledger_record (
    id VARCHAR(36) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type VARCHAR(7) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    business_date DATE NOT NULL,
    category VARCHAR(32) NOT NULL,
    note VARCHAR(200) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP(6) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_record_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT ck_record_type CHECK (type IN ('income', 'expense')),
    CONSTRAINT ck_record_amount CHECK (amount > 0),
    CONSTRAINT ck_record_version CHECK (version >= 0)
);
CREATE INDEX idx_record_owner_date ON ledger_record (user_id, business_date, deleted_at);
