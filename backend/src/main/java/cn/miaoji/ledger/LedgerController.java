package cn.miaoji.ledger;

import cn.miaoji.auth.AccountPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class LedgerController {
    private final LedgerService ledger;
    private final LedgerWriteService writes;
    private final LedgerBackupService backup;
    public LedgerController(LedgerService ledger, LedgerWriteService writes, LedgerBackupService backup) {
        this.ledger = ledger;
        this.writes = writes;
        this.backup = backup;
    }
    public record UpdateRequest(@NotNull Long version, @NotNull @Valid RecordInput record) {}
    public record BatchRequest(@NotNull @Size(min = 1, max = 5) List<@NotNull @Valid RecordInput> records) {}
    public record BatchResponse(List<RecordView> records) {}

    @GetMapping("/records/snapshot")
    public LedgerService.LedgerSnapshot snapshot(@AuthenticationPrincipal AccountPrincipal user) {
        return ledger.snapshot(user.id());
    }

    @GetMapping("/records/export")
    public LedgerBackupService.BackupFile export(@AuthenticationPrincipal AccountPrincipal user) {
        return backup.export(user.id());
    }

    @PostMapping("/records/import")
    public LedgerBackupService.ImportResult importBackup(@AuthenticationPrincipal AccountPrincipal user,
            @RequestBody LedgerBackupService.BackupFile file) {
        return backup.importBackup(user.id(), file);
    }

    @GetMapping("/records/snapshot/page")
    public LedgerService.SnapshotPage snapshotPage(@AuthenticationPrincipal AccountPrincipal user,
            @RequestParam(required=false) UUID after,@RequestParam(required=false) Long revision,
            @RequestParam(defaultValue="500") int size) {
        return ledger.snapshotPage(user.id(),after==null?null:after.toString(),revision,size);
    }

    @GetMapping("/records")
    public LedgerService.RecordPage list(@AuthenticationPrincipal AccountPrincipal user,
            @RequestParam String month, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size, @RequestParam(required = false) String type,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(name = "q", required = false) String query) {
        return ledger.list(user.id(), month, page, size, type, category, date, query);
    }

    @GetMapping("/categories")
    public Map<String, List<String>> categories() {
        return CategoryCatalog.OPTIONS;
    }

    @PostMapping("/records")
    public ResponseEntity<RecordView> create(@AuthenticationPrincipal AccountPrincipal user,
            @RequestHeader("Idempotency-Key") UUID requestId, @Valid @RequestBody RecordInput input) {
        var receipt = writes.single(user.id(), requestId, input);
        return ResponseEntity.status(receipt.replayed() ? HttpStatus.OK : HttpStatus.CREATED)
                .header("Idempotency-Replayed", Boolean.toString(receipt.replayed())).body(receipt.records().getFirst());
    }

    @PostMapping("/records/batch")
    public ResponseEntity<BatchResponse> batch(@AuthenticationPrincipal AccountPrincipal user,
            @RequestHeader("Idempotency-Key") UUID requestId, @Valid @RequestBody BatchRequest input) {
        var receipt = writes.batch(user.id(), requestId, input.records());
        return ResponseEntity.status(receipt.replayed() ? HttpStatus.OK : HttpStatus.CREATED)
                .header("Idempotency-Replayed", Boolean.toString(receipt.replayed())).body(new BatchResponse(receipt.records()));
    }

    @GetMapping("/records/{id}")
    public RecordView get(@AuthenticationPrincipal AccountPrincipal user, @PathVariable UUID id) {
        return ledger.get(user.id(), id.toString());
    }

    @PutMapping("/records/{id}")
    public RecordView update(@AuthenticationPrincipal AccountPrincipal user, @PathVariable UUID id,
            @Valid @RequestBody UpdateRequest input) {
        return ledger.update(user.id(), id.toString(), input.version(), input.record());
    }

    @DeleteMapping("/records/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AccountPrincipal user, @PathVariable UUID id, @RequestParam long version) {
        ledger.delete(user.id(), id.toString(), version);
    }

    @GetMapping("/statistics/month")
    public LedgerService.MonthSummary summary(@AuthenticationPrincipal AccountPrincipal user, @RequestParam String month) {
        return ledger.summary(user.id(), month);
    }

    @GetMapping("/statistics/month/detail")
    public LedgerService.MonthDetail detail(@AuthenticationPrincipal AccountPrincipal user, @RequestParam String month) {
        return ledger.detail(user.id(), month);
    }
}
