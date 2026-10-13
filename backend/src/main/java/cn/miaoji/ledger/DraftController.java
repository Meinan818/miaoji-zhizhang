package cn.miaoji.ledger;

import cn.miaoji.auth.AccountPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/drafts")
public class DraftController {
    public record SaveRequest(Long version, @NotNull @Size(min=1,max=5) List<@NotNull @Valid RecordInput> records) {}
    public record VersionRequest(@NotNull Long version) {}
    private final DraftService drafts;
    public DraftController(DraftService drafts) { this.drafts=drafts; }

    @GetMapping("/{id}")
    public DraftService.DraftView get(@AuthenticationPrincipal AccountPrincipal user,@PathVariable UUID id) {
        return drafts.get(user.id(),id);
    }
    @PutMapping("/{id}")
    public DraftService.DraftView save(@AuthenticationPrincipal AccountPrincipal user,@PathVariable UUID id,
            @Valid @RequestBody SaveRequest input) {
        return drafts.save(user.id(),id,input.version(),input.records());
    }
    @PostMapping("/{id}/confirm")
    public ResponseEntity<LedgerController.BatchResponse> confirm(@AuthenticationPrincipal AccountPrincipal user,
            @PathVariable UUID id,@RequestHeader("Idempotency-Key") UUID requestId,
            @Valid @RequestBody VersionRequest input) {
        var receipt=drafts.confirm(user.id(),id,input.version(),requestId);
        return ResponseEntity.status(receipt.replayed()?HttpStatus.OK:HttpStatus.CREATED)
                .header("Idempotency-Replayed",Boolean.toString(receipt.replayed()))
                .body(new LedgerController.BatchResponse(receipt.records()));
    }
    @PostMapping("/{id}/cancel")
    public DraftService.DraftView cancel(@AuthenticationPrincipal AccountPrincipal user,@PathVariable UUID id,
            @Valid @RequestBody VersionRequest input) {
        return drafts.cancel(user.id(),id,input.version());
    }
}
