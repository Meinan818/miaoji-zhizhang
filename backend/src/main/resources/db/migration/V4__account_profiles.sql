CREATE TABLE account_profile (
    user_id BIGINT PRIMARY KEY,
    nickname VARCHAR(40) NOT NULL,
    signature VARCHAR(120) NOT NULL DEFAULT '',
    avatar_kind VARCHAR(10) NOT NULL DEFAULT 'cat',
    avatar_file VARCHAR(36) NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT ck_profile_avatar CHECK (avatar_kind IN ('cat', 'paw', 'flower', 'photo')),
    CONSTRAINT ck_profile_version CHECK (version >= 0),
    CONSTRAINT ck_profile_photo CHECK ((avatar_kind = 'photo' AND avatar_file IS NOT NULL)
        OR (avatar_kind <> 'photo' AND avatar_file IS NULL))
);
-- 只用账号的默认名片，不导入任何浏览器昵称/照片。
INSERT INTO account_profile (user_id, nickname) SELECT id, LEFT(username, 20) FROM app_user;
