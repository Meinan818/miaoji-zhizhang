package cn.miaoji.ledger;

import cn.miaoji.common.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DraftService {
    public record DraftView(String id, long version, String status, List<RecordInput> records, Instant expiresAt) {}
    private final DraftRepository drafts;
    private final LedgerService ledger;
    private final LedgerWriteService writes;
    private final ObjectMapper json;
    public DraftService(DraftRepository drafts, LedgerService ledger, LedgerWriteService writes, ObjectMapper json) {
        this.drafts=drafts;this.ledger=ledger;this.writes=writes;this.json=json;
    }

    public DraftView get(long owner, UUID id) { return view(load(owner,id,false)); }

    @Transactional
    public DraftView save(long owner, UUID id, Long version, List<RecordInput> inputs) {
        if (inputs==null || inputs.isEmpty() || inputs.size()>5 || (version!=null && version<0)) throw invalid();
        inputs.forEach(ledger::validate);
        var canonical=inputs.stream().map(input -> new RecordInput(input.type(),input.money().toPlainString(),
                input.date(),input.category(),input.note(),input.time())).toList();
        var payload=encode(canonical);
        if (version==null) {
            try { drafts.create(owner,id.toString(),payload,Instant.now().plus(24,ChronoUnit.HOURS)); }
            catch (DuplicateKeyException duplicate) {
                var existing=load(owner,id,false);
                if (!existing.records().equals(payload)) throw stale();
                // 已确认草稿允许相同内容重试；过期的未确认草稿仍不能继续确认。
                if (existing.status().equals("OPEN")) unexpired(existing);
            }
            return view(load(owner,id,false));
        }
        var existing=load(owner,id,true);
        sameVersion(existing,version);
        open(existing);unexpired(existing);
        if (!drafts.update(owner,id.toString(),version,payload)) throw stale();
        return view(load(owner,id,true));
    }

    @Transactional
    public LedgerWriteService.WriteReceipt confirm(long owner, UUID id, long version, UUID requestId) {
        if (!id.equals(requestId)) throw invalid();
        var existing=load(owner,id,true);
        sameVersion(existing,version);
        if (existing.status().equals("CONFIRMED")) {
            return new LedgerWriteService.WriteReceipt(decodeReceipt(existing.receipt()),true);
        }
        open(existing);unexpired(existing);
        // 行锁、版本及确认状态与防重入账/审计/回执共享同一事务。
        var receipt=writes.batch(owner,requestId,decodeInputs(existing.records()));
        if (!drafts.finish(owner,id.toString(),version,"CONFIRMED",encode(receipt.records()))) throw stale();
        return receipt;
    }

    @Transactional
    public DraftView cancel(long owner, UUID id, long version) {
        var existing=load(owner,id,true);sameVersion(existing,version);
        if (existing.status().equals("CANCELLED")) return view(existing);
        open(existing);
        if (!drafts.finish(owner,id.toString(),version,"CANCELLED",null)) throw stale();
        return view(load(owner,id,true));
    }

    private DraftRepository.StoredDraft load(long owner,UUID id,boolean lock) {
        return drafts.find(owner,id.toString(),lock).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND,"DRAFT_NOT_FOUND","草稿不存在"));
    }
    private void sameVersion(DraftRepository.StoredDraft draft,long version) {
        if (version<0 || draft.version()!=version) throw stale();
    }
    private void open(DraftRepository.StoredDraft draft) {
        if (!draft.status().equals("OPEN")) throw new ApiException(HttpStatus.CONFLICT,"DRAFT_CLOSED","草稿已确认或取消，请核对当前状态");
    }
    private void unexpired(DraftRepository.StoredDraft draft) {
        if (!Instant.now().isBefore(draft.expiresAt())) throw new ApiException(HttpStatus.GONE,"DRAFT_EXPIRED","草稿已过期，请重新核对内容后建立新草稿");
    }
    private DraftView view(DraftRepository.StoredDraft draft) {
        return new DraftView(draft.id(),draft.version(),draft.status(),decodeInputs(draft.records()),draft.expiresAt());
    }
    private List<RecordInput> decodeInputs(String value) {
        try { return json.readValue(value,new TypeReference<List<RecordInput>>(){}); }
        catch (JsonProcessingException error) { throw new DataRetrievalFailureException("草稿内容无法读取",error); }
    }
    private List<RecordView> decodeReceipt(String value) {
        if (value==null) throw new DataRetrievalFailureException("草稿回执不可用");
        try { return json.readValue(value,new TypeReference<List<RecordView>>(){}); }
        catch (JsonProcessingException error) { throw new DataRetrievalFailureException("草稿回执无法读取",error); }
    }
    private String encode(Object value) {
        try { return json.writeValueAsString(value); }
        catch (JsonProcessingException error) { throw new DataRetrievalFailureException("草稿无法保存",error); }
    }
    private ApiException stale() { return new ApiException(HttpStatus.CONFLICT,"STALE_DRAFT","草稿已变化，请重新核对当前版本"); }
    private ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","草稿内容、版本或确认标识不合法"); }
}
