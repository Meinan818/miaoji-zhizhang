CREATE TABLE ledger_write_request (
    user_id BIGINT NOT NULL,
    request_id VARCHAR(36) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_json TEXT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, request_id),
    CONSTRAINT fk_write_request_user FOREIGN KEY (user_id) REFERENCES app_user(id)
);
