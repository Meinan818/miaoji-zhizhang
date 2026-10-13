package cn.miaoji.ledger;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LedgerWriteRepository {
    private final JdbcTemplate jdbc;
    public LedgerWriteRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public record StoredRequest(String hash, String response) {}

    public void claim(long owner, String requestId, String hash) {
        jdbc.update("INSERT INTO ledger_write_request (user_id, request_id, request_hash) VALUES (?, ?, ?)",
                owner, requestId, hash);
    }

    public StoredRequest find(long owner, String requestId) {
        return jdbc.queryForObject("SELECT request_hash, response_json FROM ledger_write_request WHERE user_id = ? AND request_id = ?",
                (rs, row) -> new StoredRequest(rs.getString("request_hash"), rs.getString("response_json")), owner, requestId);
    }

    public void complete(long owner, String requestId, String response) {
        if (jdbc.update("UPDATE ledger_write_request SET response_json = ? WHERE user_id = ? AND request_id = ?",
                response, owner, requestId) != 1) {
            throw new org.springframework.dao.DataRetrievalFailureException("入账请求状态不可用");
        }
    }
}
