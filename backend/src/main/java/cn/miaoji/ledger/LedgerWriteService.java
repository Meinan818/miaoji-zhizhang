package cn.miaoji.ledger;

import cn.miaoji.common.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LedgerWriteService {
    private final LedgerService ledger;
    private final LedgerRepository records;
    private final LedgerWriteRepository requests;
    private final ObjectMapper json;
    private final LedgerAuditRepository audit;

    public LedgerWriteService(LedgerService ledger, LedgerRepository records, LedgerWriteRepository requests, ObjectMapper json,
            LedgerAuditRepository audit) {
        this.ledger = ledger;
        this.records = records;
        this.requests = requests;
        this.json = json;
        this.audit = audit;
    }

    public record WriteReceipt(List<RecordView> records, boolean replayed) {}

    @Transactional
    public WriteReceipt single(long owner, UUID requestId, RecordInput input) {
        return write(owner, requestId, "single-v1", List.of(input));
    }

    @Transactional
    public WriteReceipt batch(long owner, UUID requestId, List<RecordInput> inputs) {
        return write(owner, requestId, "batch-v1", inputs);
    }

    private WriteReceipt write(long owner, UUID requestId, String operation, List<RecordInput> inputs) {
        if (requestId == null || inputs == null || inputs.isEmpty() || inputs.size() > 5) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INPUT", "每组只能确认1至5笔账单");
        }
        // 写任何一笔前完成整组校验；金额规范化，使1和1.00代表同一请求内容。
        inputs.forEach(ledger::validate);
        var canonical = inputs.stream().map(input -> new RecordInput(input.type(), input.money().toPlainString(),
                input.date(), input.category(), input.note(), input.time())).toList();
        var id = requestId.toString();
        var hash = fingerprint(operation, canonical);
        try {
            // 唯一约束在数据库中串行化同账号同键的并发请求；不使用进程内锁。
            requests.claim(owner, id, hash);
        } catch (DuplicateKeyException duplicate) {
            var saved = requests.find(owner, id);
            if (!hash.equals(saved.hash())) {
                throw new ApiException(HttpStatus.CONFLICT, "REQUEST_KEY_REUSED", "请求标识已用于其他内容，请核对后使用新标识");
            }
            if (saved.response() == null) throw new DataRetrievalFailureException("入账回执不可用");
            try {
                // 回放原始入账回执，绝不再插入或恢复随后修改/删除的账单。
                return new WriteReceipt(json.readValue(saved.response(), new TypeReference<List<RecordView>>() {}), true);
            } catch (JsonProcessingException error) {
                throw new DataRetrievalFailureException("入账回执不可用", error);
            }
        }

        // 同账号写入取得版本行锁；回放在此之前返回，不增加读取版本。
        records.advanceRevision(owner);
        var created = new ArrayList<RecordView>();
        for (var input : canonical) {
            var recordId = UUID.randomUUID().toString();
            records.insert(owner, recordId, input);
            audit.append(owner, recordId, "CREATE", null, 0, id);
            created.add(ledger.get(owner, recordId));
        }
        try {
            // 请求键、所有账单和回执在同一事务提交；任何失败一起回退。
            requests.complete(owner, id, json.writeValueAsString(created));
        } catch (JsonProcessingException error) {
            throw new DataRetrievalFailureException("入账回执无法保存", error);
        }
        return new WriteReceipt(List.copyOf(created), false);
    }

    private String fingerprint(String operation, List<RecordInput> canonical) {
        try {
            var payload = operation + "\n" + json.writeValueAsString(canonical);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (JsonProcessingException | NoSuchAlgorithmException error) {
            throw new DataRetrievalFailureException("入账请求无法处理", error);
        }
    }
}
