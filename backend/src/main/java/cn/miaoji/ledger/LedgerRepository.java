package cn.miaoji.ledger;

import java.time.LocalDate;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class LedgerRepository {
    private static final RowMapper<RecordView> MAPPER = (rs, row) -> new RecordView(
            rs.getString("id"), rs.getString("type"), rs.getBigDecimal("amount").toPlainString(),
            rs.getDate("business_date").toLocalDate(), rs.getString("category"), rs.getString("note"), rs.getLong("version"),
            rs.getString("business_time"));
    private final JdbcTemplate jdbc;
    public LedgerRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void advanceRevision(long owner) {
        if (jdbc.update("UPDATE app_user SET ledger_revision=ledger_revision+1 WHERE id=?",owner)!=1) {
            throw new org.springframework.dao.DataRetrievalFailureException("账本身份不可用");
        }
    }

    public long revision(long owner) {
        return jdbc.queryForObject("SELECT ledger_revision FROM app_user WHERE id=?",Long.class,owner);
    }

    public List<LedgerService.SnapshotRecord> snapshotPage(long owner,String after,int limit) {
        var sql="SELECT * FROM ledger_record WHERE user_id=?"+(after==null?"":" AND id>?")+" ORDER BY id LIMIT ?";
        var arguments=after==null?new Object[]{owner,limit}:new Object[]{owner,after,limit};
        return jdbc.query(sql,(rs,row) -> new LedgerService.SnapshotRecord(MAPPER.mapRow(rs,row),
                rs.getTimestamp("deleted_at")==null?null:rs.getTimestamp("deleted_at").toInstant().toString()),arguments);
    }

    public Optional<RecordView> find(long owner, String id) {
        return jdbc.query("SELECT * FROM ledger_record WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
                MAPPER, owner, id).stream().findFirst();
    }

    public List<RecordView> list(long owner, RecordFilters filters, int offset, int limit) {
        var query = where(owner, filters);
        var arguments = new ArrayList<>(query.arguments());
        arguments.add(limit);
        arguments.add(offset);
        return jdbc.query("SELECT * FROM ledger_record" + query.sql()
                + " ORDER BY business_date DESC, created_at DESC, id LIMIT ? OFFSET ?", MAPPER, arguments.toArray());
    }

    public long count(long owner, RecordFilters filters) {
        var query = where(owner, filters);
        return jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record" + query.sql(), Long.class, query.arguments().toArray());
    }

    public List<LedgerService.SnapshotRecord> snapshot(long owner) {
        return jdbc.query("SELECT * FROM ledger_record WHERE user_id = ? ORDER BY business_date DESC, created_at DESC, id LIMIT 5001",
                (rs, row) -> new LedgerService.SnapshotRecord(MAPPER.mapRow(rs, row),
                        rs.getTimestamp("deleted_at") == null ? null : rs.getTimestamp("deleted_at").toInstant().toString()), owner);
    }

    public List<LedgerBackupService.BackupRecord> backupRows(long owner) {
        return jdbc.query("SELECT * FROM ledger_record WHERE user_id = ? ORDER BY business_date DESC, created_at DESC, id LIMIT 5001",
                (rs, row) -> new LedgerBackupService.BackupRecord(rs.getString("id"), rs.getLong("version"),
                        rs.getString("type"), rs.getBigDecimal("amount").toPlainString(),
                        rs.getDate("business_date").toLocalDate().toString(), rs.getString("business_time"),
                        rs.getString("category"), rs.getString("note"),
                        rs.getTimestamp("deleted_at") == null ? null : rs.getTimestamp("deleted_at").toInstant().toString(),
                        rs.getTimestamp("created_at").toInstant().toString(),
                        rs.getTimestamp("updated_at").toInstant().toString()), owner);
    }

    /** 账单编号为全局主键：任何账号已占用的编号都视为已存在，导入时跳过而不是覆盖。 */
    public Set<String> existingRecordIds(List<String> ids) {
        var found = new HashSet<String>();
        for (var index = 0; index < ids.size(); index += 500) {
            var chunk = ids.subList(index, Math.min(ids.size(), index + 500));
            var placeholders = String.join(",", java.util.Collections.nCopies(chunk.size(), "?"));
            found.addAll(jdbc.queryForList("SELECT id FROM ledger_record WHERE id IN (" + placeholders + ")",
                    String.class, chunk.toArray()));
        }
        return found;
    }

    public void insertImported(long owner, String id, RecordInput input, long version, Timestamp deletedAt,
            Timestamp createdAt, Timestamp updatedAt) {
        jdbc.update("""
                INSERT INTO ledger_record (id, user_id, type, amount, business_date, category, note, business_time,
                version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, owner, input.type(), input.money(), input.date(), input.category(), input.note(), input.time(),
                version, deletedAt, createdAt, updatedAt);
    }

    private record Query(String sql, List<Object> arguments) {}

    private Query where(long owner, RecordFilters filters) {
        var sql = new StringBuilder(" WHERE user_id = ? AND deleted_at IS NULL AND business_date >= ? AND business_date < ?");
        var arguments = new ArrayList<Object>(List.of(owner, filters.start(), filters.end()));
        if (filters.type() != null) { sql.append(" AND type = ?"); arguments.add(filters.type()); }
        if (filters.category() != null) { sql.append(" AND category = ?"); arguments.add(filters.category()); }
        if (filters.date() != null) { sql.append(" AND business_date = ?"); arguments.add(filters.date()); }
        if (filters.query() != null) {
            // 用户输入始终作为参数；LIKE通配符按文字匹配，不能扩大检索范围。
            for (var term : filters.query().toLowerCase(java.util.Locale.ROOT).split("\\s+")) {
                var pattern = "%" + term.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
                sql.append("""
                     AND (LOWER(note) LIKE ? ESCAPE '!' OR LOWER(category) LIKE ? ESCAPE '!'
                     OR CAST(amount AS CHAR(32)) LIKE ? ESCAPE '!' OR CAST(business_date AS CHAR(10)) LIKE ? ESCAPE '!'
                     OR (CASE WHEN type = 'income' THEN '收入' ELSE '支出' END) LIKE ? ESCAPE '!'
                     OR business_time LIKE ? ESCAPE '!')
                    """);
                for (int i = 0; i < 6; i++) arguments.add(pattern);
            }
        }
        return new Query(sql.toString(), arguments);
    }

    public void insert(long owner, String id, RecordInput input) {
        jdbc.update("""
                INSERT INTO ledger_record (id, user_id, type, amount, business_date, category, note, business_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, id, owner, input.type(), input.money(), input.date(), input.category(), input.note(), input.time());
    }

    public boolean update(long owner, String id, long version, RecordInput input) {
        return jdbc.update("""
                UPDATE ledger_record SET type = ?, amount = ?, business_date = ?, category = ?, note = ?, business_time = ?,
                version = version + 1, updated_at = CURRENT_TIMESTAMP(6)
                WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL
                """, input.type(), input.money(), input.date(), input.category(), input.note(), input.time(), owner, id, version) == 1;
    }

    public boolean delete(long owner, String id, long version) {
        return jdbc.update("""
                UPDATE ledger_record SET deleted_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6),
                version = version + 1 WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL
                """, owner, id, version) == 1;
    }

    public LedgerService.MonthSummary summarize(long owner, LocalDate start, LocalDate end) {
        return jdbc.queryForObject("""
                SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense, COUNT(*) AS record_count
                FROM ledger_record WHERE user_id = ? AND deleted_at IS NULL
                AND business_date >= ? AND business_date < ?
                """, (rs, row) -> {
                    var income = rs.getBigDecimal("income").setScale(2);
                    var expense = rs.getBigDecimal("expense").setScale(2);
                    return new LedgerService.MonthSummary(income.toPlainString(), expense.toPlainString(),
                            income.subtract(expense).toPlainString(), rs.getLong("record_count"));
                }, owner, start, end);
    }

    public record CategoryTotal(String type, String category, BigDecimal amount, long count) {}

    public List<CategoryTotal> categoryTotals(long owner, LocalDate start, LocalDate end) {
        return jdbc.query("""
                SELECT type, category, SUM(amount) AS total, COUNT(*) AS record_count
                FROM ledger_record WHERE user_id = ? AND deleted_at IS NULL
                AND business_date >= ? AND business_date < ? GROUP BY type, category
                """, (rs, row) -> new CategoryTotal(rs.getString("type"), rs.getString("category"),
                rs.getBigDecimal("total").setScale(2), rs.getLong("record_count")), owner, start, end);
    }
}
