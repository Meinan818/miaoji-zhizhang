package cn.miaoji.ledger;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DraftRepository {
    public record StoredDraft(String id, long version, String status, String records, String receipt, Instant expiresAt) {}
    private final JdbcTemplate jdbc;
    public DraftRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void create(long owner, String id, String records, Instant expiresAt) {
        jdbc.update("INSERT INTO ledger_draft (user_id,id,records_json,expires_at) VALUES (?,?,?,?)",
                owner, id, records, Timestamp.from(expiresAt));
    }

    public Optional<StoredDraft> find(long owner, String id, boolean lock) {
        return jdbc.query("SELECT * FROM ledger_draft WHERE user_id=? AND id=?" + (lock ? " FOR UPDATE" : ""),
                (rs,row) -> new StoredDraft(rs.getString("id"), rs.getLong("version"), rs.getString("status"),
                        rs.getString("records_json"),rs.getString("receipt_json"),rs.getTimestamp("expires_at").toInstant()),
                owner,id).stream().findFirst();
    }

    public boolean update(long owner, String id, long version, String records) {
        return jdbc.update("""
                UPDATE ledger_draft SET records_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP(6)
                WHERE user_id=? AND id=? AND version=? AND status='OPEN'
                """,records,owner,id,version)==1;
    }

    public boolean finish(long owner, String id, long version, String status, String receipt) {
        return jdbc.update("""
                UPDATE ledger_draft SET status=?,receipt_json=?,updated_at=CURRENT_TIMESTAMP(6)
                WHERE user_id=? AND id=? AND version=? AND status='OPEN'
                """,status,receipt,owner,id,version)==1;
    }
}
