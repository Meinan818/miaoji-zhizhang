ALTER TABLE app_user ADD COLUMN email VARCHAR(254) NULL;
ALTER TABLE app_user ADD COLUMN email_verified_at TIMESTAMP(6) NULL;
CREATE UNIQUE INDEX uq_user_email ON app_user(email);

CREATE TABLE email_registration_challenge (
    email VARCHAR(254) PRIMARY KEY,
    challenge_id VARCHAR(36) NOT NULL UNIQUE,
    code_hash VARCHAR(100) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    sent_at TIMESTAMP(6) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    consumed_at TIMESTAMP(6) NULL,
    CONSTRAINT ck_email_attempts CHECK (attempts BETWEEN 0 AND 5)
);
