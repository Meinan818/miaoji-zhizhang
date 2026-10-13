package cn.miaoji.profile;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProfileRepository {
    private final JdbcTemplate jdbc;
    public ProfileRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public record StoredProfile(String nickname, String signature, String avatar, String fileId, long version) {}

    public Optional<StoredProfile> find(long owner) {
        return jdbc.query("SELECT nickname, signature, avatar_kind, avatar_file, version FROM account_profile WHERE user_id = ?",
                (rs, row) -> new StoredProfile(rs.getString("nickname"), rs.getString("signature"),
                        rs.getString("avatar_kind"), rs.getString("avatar_file"), rs.getLong("version")), owner).stream().findFirst();
    }

    public boolean update(long owner, long version, String nickname, String signature, String avatar, String fileId) {
        return jdbc.update("""
                UPDATE account_profile SET nickname = ?, signature = ?, avatar_kind = ?, avatar_file = ?,
                version = version + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND version = ?
                """, nickname, signature, avatar, fileId, owner, version) == 1;
    }
}
