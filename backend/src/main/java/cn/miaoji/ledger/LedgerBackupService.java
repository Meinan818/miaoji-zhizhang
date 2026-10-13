package cn.miaoji.ledger;

import cn.miaoji.common.ApiException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 账本备份：导出全部（含已删除）与导入恢复。导入只新增，不删除、不覆盖；按账单编号跳过已存在项。 */
@Service
public class LedgerBackupService {
    public static final String FORMAT = "miaoji-ledger-backup";
    public static final int FORMAT_VERSION = 1;
    public static final int MAX_RECORDS = 5000;
    private static final String UUID_TEXT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

    public record BackupRecord(String id, Long version, String type, String amount, String date, String time,
            String category, String note, String deletedAt, String createdAt, String updatedAt) {}
    public record BackupFile(String format, Integer formatVersion, String exportedAt, Integer recordCount,
            List<BackupRecord> records) {}
    public record ImportResult(int imported, int skipped, int total, String revision) {}

    private final LedgerRepository records;
    private final LedgerService ledger;
    private final LedgerAuditRepository audit;

    public LedgerBackupService(LedgerRepository records, LedgerService ledger, LedgerAuditRepository audit) {
        this.records = records;
        this.ledger = ledger;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public BackupFile export(long owner) {
        var rows = records.backupRows(owner);
        if (rows.size() > MAX_RECORDS) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "LEDGER_TOO_LARGE",
                "账本超过当前备份上限（5000笔），请保留数据并联系开发者");
        return new BackupFile(FORMAT, FORMAT_VERSION, Instant.now().toString(), rows.size(), rows);
    }

    @Transactional
    public ImportResult importBackup(long owner, BackupFile file) {
        if (file == null || !FORMAT.equals(file.format()) || file.formatVersion() == null || file.formatVersion() != FORMAT_VERSION
                || file.records() == null || file.records().isEmpty() || file.records().size() > MAX_RECORDS) {
            throw invalid("备份文件格式不正确，或账单数量超出上限（1–5000笔），请选择「导出全部账单」下载的备份文件");
        }
        var seen = new HashSet<String>();
        var prepared = new ArrayList<Prepared>(file.records().size());
        for (var row : file.records()) {
            if (row == null || row.id() == null || !row.id().matches(UUID_TEXT)
                    || !seen.add(row.id().toLowerCase(Locale.ROOT))) {
                throw invalid("备份文件包含不合法或重复的账单编号，请重新导出后再试");
            }
            if (row.version() == null || row.version() < 0) throw invalid("备份文件包含不合法账单（版本号），本次没有导入任何账单。");
            prepared.add(new Prepared(row.id().toLowerCase(Locale.ROOT), toInput(row), row.version(),
                    parseInstant(row.deletedAt()), parseInstant(row.createdAt()), parseInstant(row.updatedAt())));
        }
        // 先整体校验、再统一写入；任何一条不合法都保持原账本不变。
        var existing = records.existingRecordIds(prepared.stream().map(Prepared::id).toList());
        var fresh = prepared.stream().filter(row -> !existing.contains(row.id())).toList();
        if (!fresh.isEmpty()) {
            records.advanceRevision(owner);
            var batch = UUID.randomUUID().toString();
            var now = Timestamp.from(Instant.now());
            for (var row : fresh) {
                records.insertImported(owner, row.id(), row.input(), row.version(), row.deletedAt(),
                        row.createdAt() == null ? now : row.createdAt(), row.updatedAt() == null ? now : row.updatedAt());
                audit.append(owner, row.id(), "CREATE", null, row.version(), batch);
            }
        }
        return new ImportResult(fresh.size(), prepared.size() - fresh.size(), prepared.size(),
                Long.toString(records.revision(owner)));
    }

    private record Prepared(String id, RecordInput input, long version, Timestamp deletedAt, Timestamp createdAt, Timestamp updatedAt) {}

    private RecordInput toInput(BackupRecord row) {
        try {
            var input = new RecordInput(row.type(), row.amount(), LocalDate.parse(row.date()), row.category(), row.note(), row.time());
            ledger.validate(input);
            return input;
        } catch (ApiException | DateTimeParseException | NullPointerException | NumberFormatException error) {
            throw invalid("备份文件包含不合法账单（金额、日期、分类、时间或备注），本次没有导入任何账单。");
        }
    }

    private Timestamp parseInstant(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return Timestamp.from(Instant.parse(value.trim()));
        } catch (DateTimeParseException error) {
            throw invalid("备份文件包含不合法的时间标记，本次没有导入任何账单。");
        }
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "BACKUP_INVALID", message);
    }
}
