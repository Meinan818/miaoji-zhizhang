package cn.miaoji.ledger;

import cn.miaoji.common.ApiException;
import jakarta.validation.Validator;
import java.time.DateTimeException;
import java.time.YearMonth;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

@Service
public class LedgerService {
    private final LedgerRepository repository;
    private final Validator validator;
    private final LedgerAuditRepository audit;
    public LedgerService(LedgerRepository repository, Validator validator, LedgerAuditRepository audit) {
        this.repository = repository;
        this.validator = validator;
        this.audit = audit;
    }
    public record MonthSummary(String income, String expense, String balance, long count) {}
    public record RecordPage(List<RecordView> records, int page, int size, long total) {}
    public record SnapshotRecord(RecordView record, String deletedAt) {}
    public record LedgerSnapshot(List<SnapshotRecord> records) {}
    public record SnapshotPage(List<SnapshotRecord> records,String revision,String nextAfter) {}

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public SnapshotPage snapshotPage(long owner,String after,Long expectedRevision,int size) {
        if(size<1 || size>500 || (expectedRevision!=null && expectedRevision<0)
                || (after!=null && expectedRevision==null)) throw invalid();
        var revision=repository.revision(owner);
        if(expectedRevision!=null && revision!=expectedRevision) {
            throw new ApiException(HttpStatus.CONFLICT,"LEDGER_CHANGED","读取期间账本已变化，请重新读取；原账本已保留");
        }
        var values=repository.snapshotPage(owner,after,size+1);
        var more=values.size()>size;
        var page=more?List.copyOf(values.subList(0,size)):values;
        return new SnapshotPage(page,Long.toString(revision),more?page.getLast().record().id():null);
    }

    @Transactional(readOnly = true)
    public LedgerSnapshot snapshot(long owner) {
        var values = repository.snapshot(owner);
        if (values.size() > 5000) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "LEDGER_TOO_LARGE", "账本超过当前读取上限，请保留数据并联系开发者");
        return new LedgerSnapshot(values);
    }
    public record CategorySummary(String category, String amount, long count, String percent) {}
    public record MonthDetail(String month, String income, String expense, String balance, long count,
            long incomeCount, long expenseCount, Map<String, List<CategorySummary>> categories) {}

    @Transactional(readOnly = true)
    public RecordPage list(long owner, String month, int page, int size, String type, String category, LocalDate date, String query) {
        var range = month(month);
        if (page < 0 || page > 10000 || size < 1 || size > 100) throw invalid();
        if (type != null && !CategoryCatalog.OPTIONS.containsKey(type)) throw invalid();
        if (category != null && (type == null
                ? CategoryCatalog.OPTIONS.values().stream().noneMatch(options -> options.contains(category))
                : !CategoryCatalog.contains(type, category))) throw invalid();
        if (date != null && !YearMonth.from(date).equals(range)) throw invalid();
        if (query != null && query.length() > 120) throw invalid();
        var search = query == null || query.isBlank() ? null : query.trim();
        var filters = new RecordFilters(range.atDay(1), range.plusMonths(1).atDay(1), type, category, date, search);
        return new RecordPage(repository.list(owner, filters, page * size, size), page, size, repository.count(owner, filters));
    }

    public RecordView get(long owner, String id) {
        return repository.find(owner, id).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "RECORD_NOT_FOUND", "账单不存在"));
    }

    @Transactional
    public RecordView update(long owner, String id, long version, RecordInput input) {
        validate(input);
        repository.advanceRevision(owner);
        get(owner, id); // 他人/不存在账单统一404，不泄漏所属者。
        if (version < 0) throw invalid();
        if (!repository.update(owner, id, version, input)) throw conflict();
        audit.append(owner, id, "UPDATE", version, version + 1, null);
        return get(owner, id);
    }

    @Transactional
    public void delete(long owner, String id, long version) {
        repository.advanceRevision(owner);
        get(owner, id);
        if (version < 0) throw invalid();
        if (!repository.delete(owner, id, version)) throw conflict();
        audit.append(owner, id, "DELETE", version, version + 1, null);
    }

    public MonthSummary summary(long owner, String month) {
        var range = month(month);
        return repository.summarize(owner, range.atDay(1), range.plusMonths(1).atDay(1));
    }

    public MonthDetail detail(long owner, String month) {
        var range = month(month);
        var rows = repository.categoryTotals(owner, range.atDay(1), range.plusMonths(1).atDay(1));
        var income = total(rows, "income");
        var expense = total(rows, "expense");
        var incomeCount = rows.stream().filter(row -> row.type().equals("income")).mapToLong(LedgerRepository.CategoryTotal::count).sum();
        var expenseCount = rows.stream().filter(row -> row.type().equals("expense")).mapToLong(LedgerRepository.CategoryTotal::count).sum();
        return new MonthDetail(month, income.toPlainString(), expense.toPlainString(), income.subtract(expense).toPlainString(),
                incomeCount + expenseCount, incomeCount, expenseCount,
                Map.of("income", categories(rows, "income", income), "expense", categories(rows, "expense", expense)));
    }

    private BigDecimal total(List<LedgerRepository.CategoryTotal> rows, String type) {
        return rows.stream().filter(row -> row.type().equals(type)).map(LedgerRepository.CategoryTotal::amount)
                .reduce(new BigDecimal("0.00"), BigDecimal::add);
    }

    private List<CategorySummary> categories(List<LedgerRepository.CategoryTotal> rows, String type, BigDecimal total) {
        return rows.stream().filter(row -> row.type().equals(type))
                .sorted(Comparator.comparing(LedgerRepository.CategoryTotal::amount).reversed()
                        .thenComparing(LedgerRepository.CategoryTotal::category))
                .map(row -> new CategorySummary(row.category(), row.amount().toPlainString(), row.count(),
                        total.signum() == 0 ? "0.0" : row.amount().multiply(new BigDecimal("100"))
                                .divide(total, 1, RoundingMode.HALF_UP).toPlainString())).toList();
    }

    private YearMonth month(String text) {
        try {
            if (!text.matches("[0-9]{4}-(0[1-9]|1[0-2])")) throw invalid();
            var value = YearMonth.parse(text);
            if (value.getYear() < 1000 || value.getYear() > 9998) throw invalid();
            return value;
        } catch (DateTimeException error) { throw invalid(); }
    }

    void validate(RecordInput input) {
        if (input == null || !validator.validate(input).isEmpty()) throw invalid();
        if (input.money().signum() <= 0 || input.date().getYear() < 1000 || input.date().getYear() > 9998
                || !CategoryCatalog.contains(input.type(), input.category())) throw invalid();
    }
    private ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INPUT", "金额、日期或分页参数不合法"); }
    private ApiException conflict() { return new ApiException(HttpStatus.CONFLICT, "STALE_VERSION", "账单已变化，请重新读取后操作"); }
}
