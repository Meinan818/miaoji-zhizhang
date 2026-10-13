package cn.miaoji.ledger;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 只记录操作及版本；不复制金额、备注、照片或认证信息。 */
@Repository
public class LedgerAuditRepository {
    private final JdbcTemplate jdbc;
    public LedgerAuditRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void append(long owner, String recordId, String action, Long beforeVersion,
            long afterVersion, String requestId) {
        jdbc.update("""
                INSERT INTO ledger_audit (user_id, record_id, action, before_version, after_version, request_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """, owner, recordId, action, beforeVersion, afterVersion, requestId);
    }
}
