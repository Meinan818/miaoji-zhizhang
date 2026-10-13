package cn.miaoji;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import cn.miaoji.ledger.LedgerRepository;
import cn.miaoji.ledger.LedgerWriteRepository;
import cn.miaoji.ledger.LedgerWriteService;
import cn.miaoji.ledger.RecordInput;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.http.MediaType;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AccountLedgerIntegrationTest {
    // 仅合成测试凭据，与本机数据库及任何真实账号无关。
    private static final String PASSWORD = "SyntheticPass123!";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired LedgerWriteService writes;
    @MockitoSpyBean LedgerRepository records;
    @MockitoSpyBean LedgerWriteRepository requests;
    @MockitoSpyBean cn.miaoji.ledger.LedgerAuditRepository audit;
    @MockitoSpyBean cn.miaoji.ledger.DraftRepository drafts;
    @Autowired cn.miaoji.ledger.DraftService draftService;

    private record Browser(MockHttpSession session, String token) {}

    private Browser anonymous() throws Exception {
        var result = mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        return new Browser((MockHttpSession) result.getRequest().getSession(),
                json.readTree(result.getResponse().getContentAsString()).path("token").asText());
    }

    private Browser refresh(MockHttpSession session) throws Exception {
        var result = mvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk()).andReturn();
        return new Browser(session, json.readTree(result.getResponse().getContentAsString()).path("token").asText());
    }

    private String username() { return "test_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20); }

    private Browser account() throws Exception {
        var browser = anonymous();
        var name = username();
        register(browser, name, PASSWORD).andExpect(status().isCreated());
        mvc.perform(post("/api/auth/login").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("username", name).param("password", PASSWORD)).andExpect(status().isNoContent());
        return refresh(browser.session());
    }

    private ResultActions register(Browser browser, String name, String password) throws Exception {
        return mvc.perform(post("/api/auth/register").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(java.util.Map.of("username", name, "password", password))));
    }

    private String input(String amount) {
        return "{\"type\":\"expense\",\"amount\":\"" + amount
                + "\",\"date\":\"2026-10-03\",\"category\":\"餐饮\",\"note\":\"测试午饭\"}";
    }

    private JsonNode create(Browser browser, String amount) throws Exception {
        var result = mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input(amount))).andExpect(status().isCreated()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }

    @Test void pagedSnapshotRejectsMixedVersionsAndPreservesDeletionFacts() throws Exception {
        var alice=account();var bob=account();var one=create(alice,"1.00");create(alice,"2.00");create(bob,"99.00");
        mvc.perform(get("/api/records/snapshot/page")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/records/snapshot/page").session(alice.session()).param("size","501")).andExpect(status().isBadRequest());
        var first=mvc.perform(get("/api/records/snapshot/page").session(alice.session()).param("size","1"))
                .andExpect(status().isOk()).andReturn();
        var page=json.readTree(first.getResponse().getContentAsString());var revision=page.path("revision").asText();
        var after=page.path("nextAfter").asText();
        mvc.perform(get("/api/records/snapshot/page").session(alice.session()).param("after",after))
                .andExpect(status().isBadRequest());
        var last=mvc.perform(get("/api/records/snapshot/page").session(alice.session()).param("size","1")
                .param("after",after).param("revision",revision)).andExpect(status().isOk()).andReturn();
        var lastPage=json.readTree(last.getResponse().getContentAsString());
        assertThat(lastPage.path("records").size()).isEqualTo(1);assertThat(lastPage.path("nextAfter").isNull()).isTrue();
        assertThat(lastPage.path("records").get(0).path("record").path("id").asText())
                .isNotEqualTo(page.path("records").get(0).path("record").path("id").asText());
        mvc.perform(delete("/api/records/"+one.path("id").asText()).session(alice.session())
                .header("X-CSRF-TOKEN",alice.token()).param("version","0")).andExpect(status().isNoContent());
        mvc.perform(get("/api/records/snapshot/page").session(alice.session()).param("after",after).param("revision",revision))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LEDGER_CHANGED"));
        var refreshed=mvc.perform(get("/api/records/snapshot/page").session(alice.session())).andReturn();
        var rows=json.readTree(refreshed.getResponse().getContentAsString()).path("records");
        assertThat(rows.size()).isEqualTo(2);assertThat(rows.findValues("deletedAt").stream().filter(JsonNode::isTextual)).hasSize(1);
    }

    @Test void pagedSnapshotReadsLargeLedgerWithoutTruncatingAndRollbackDoesNotAdvanceRevision() throws Exception {
        var alice=account();var record=create(alice,"1.00");
        var owner=jdbc.queryForObject("SELECT user_id FROM ledger_record WHERE id=?",Long.class,record.path("id").asText());
        var entries=new java.util.ArrayList<Object[]>();
        for(int i=0;i<5001;i++) entries.add(new Object[]{UUID.randomUUID().toString(),owner});
        jdbc.batchUpdate("INSERT INTO ledger_record (id,user_id,type,amount,business_date,category,note) VALUES (?,?,'expense',1.00,'2026-10-03','餐饮','synthetic page')",entries);
        String after=null,revision=null;var ids=new java.util.HashSet<String>();
        do {
            var request=get("/api/records/snapshot/page").session(alice.session()).param("size","500");
            if(after!=null) request.param("after",after).param("revision",revision);
            var result=mvc.perform(request).andExpect(status().isOk()).andReturn();
            var page=json.readTree(result.getResponse().getContentAsString());revision=page.path("revision").asText();
            for(var row:page.path("records")) assertThat(ids.add(row.path("record").path("id").asText())).isTrue();
            after=page.path("nextAfter").isNull()?null:page.path("nextAfter").asText();
        } while(after!=null);
        assertThat(ids).hasSize(5002);
        mvc.perform(put("/api/records/"+record.path("id").asText()).session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":1,\"record\":"+input("2.00")+"}"))
                .andExpect(status().isConflict());
        assertThat(jdbc.queryForObject("SELECT ledger_revision FROM app_user WHERE id=?",Long.class,owner).toString()).isEqualTo(revision);
    }

    @Test void draftsRequireOwnershipAndLatestVersionAndDoNotWriteBeforeConfirmation() throws Exception {
        var alice=account();var bob=account();var id=UUID.randomUUID();
        mvc.perform(get("/api/drafts/"+id)).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/drafts/"+id).session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"records\":["+input("1.00")+"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(0)).andExpect(jsonPath("$.status").value("OPEN"));
        mvc.perform(get("/api/records").session(alice.session()).param("month","2026-10")).andExpect(jsonPath("$.total").value(0));
        mvc.perform(get("/api/drafts/"+id).session(bob.session())).andExpect(status().isNotFound());
        mvc.perform(post("/api/drafts/"+id+"/confirm").session(bob.session()).header("X-CSRF-TOKEN",bob.token())
                .header("Idempotency-Key",id).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/drafts/"+id).session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"records\":["+input("2.00")+"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        mvc.perform(put("/api/drafts/"+id).session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"records\":["+input("3.00")+"]}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/drafts/"+id+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",id).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("STALE_DRAFT"));
        mvc.perform(post("/api/drafts/"+id+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",id).contentType(MediaType.APPLICATION_JSON).content("{\"version\":1}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.records[0].amount").value("2.00"));
        mvc.perform(post("/api/drafts/"+id+"/cancel").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":1}"))
                .andExpect(status().isConflict());
    }

    @Test void confirmedDraftReplaysOriginalReceiptWithoutRestoringDeletedRecord() throws Exception {
        var alice=account();var me=mvc.perform(get("/api/auth/me").session(alice.session())).andReturn();
        long owner=json.readTree(me.getResponse().getContentAsString()).path("id").asLong();var id=UUID.randomUUID();
        var values=List.of(new RecordInput("expense","1.00",java.time.LocalDate.of(2026,10,3),"餐饮","合成"));
        draftService.save(owner,id,null,values);draftService.save(owner,id,null,values);
        var receipt=draftService.confirm(owner,id,0,id);var record=receipt.records().getFirst();
        mvc.perform(delete("/api/records/"+record.id()).param("version","0").session(alice.session())
                .header("X-CSRF-TOKEN",alice.token())).andExpect(status().isNoContent());
        jdbc.update("UPDATE ledger_draft SET expires_at='2020-01-01 00:00:00' WHERE user_id=? AND id=?",owner,id.toString());
        var replay=draftService.confirm(owner,id,0,id);
        assertThat(replay.replayed()).isTrue();assertThat(replay.records()).isEqualTo(receipt.records());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=? AND deleted_at IS NULL",Long.class,owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE record_id=?",Long.class,record.id())).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"edit", "delete", "mixed", "allDeleted"})
    void multiDraftReplaysOriginalOrderWhileSnapshotKeepsLaterEditsAndDeletion(String scenario) throws Exception {
        var browser = account(); var owner = owner(browser); var draftId = UUID.randomUUID();
        var date = java.time.LocalDate.of(2026, 10, 3);
        var inputs = List.of(new RecordInput("expense", "16", date, "餐饮", "合成午饭"),
                new RecordInput("expense", "18.00", date, "餐饮", "合成咖啡", "00:00"));
        draftService.save(owner, draftId, null, inputs);
        var original = mvc.perform(post("/api/drafts/" + draftId + "/confirm").session(browser.session())
                .header("X-CSRF-TOKEN", browser.token()).header("Idempotency-Key", draftId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isCreated()).andExpect(header().string("Idempotency-Replayed", "false"))
                .andExpect(jsonPath("$.records[0].amount").value("16.00"))
                .andExpect(jsonPath("$.records[0].note").value("合成午饭"))
                .andExpect(jsonPath("$.records[0].time").doesNotExist())
                .andExpect(jsonPath("$.records[1].amount").value("18.00"))
                .andExpect(jsonPath("$.records[1].note").value("合成咖啡"))
                .andExpect(jsonPath("$.records[1].time").value("00:00")).andReturn();
        var receipt = json.readTree(original.getResponse().getContentAsString()).path("records");
        var lunchId = receipt.get(0).path("id").asText(); var coffeeId = receipt.get(1).path("id").asText();
        assertThat(lunchId).isNotEqualTo(coffeeId);
        assertThat(receipt.get(0).path("version").asLong()).isZero();
        assertThat(receipt.get(1).path("version").asLong()).isZero();
        boolean edited = scenario.equals("edit") || scenario.equals("mixed");
        boolean lunchDeleted = scenario.equals("delete") || scenario.equals("allDeleted");
        boolean coffeeDeleted = scenario.equals("mixed") || scenario.equals("allDeleted");
        int changes = 0;
        if (edited) {
            mvc.perform(put("/api/records/" + lunchId).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                    .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"record\":" +
                            input("19.00").replace("测试午饭", "合成午饭已编辑") + "}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
            changes++;
        }
        for (var id : List.of(lunchDeleted ? lunchId : "", coffeeDeleted ? coffeeId : "")) {
            if (id.isEmpty()) continue;
            mvc.perform(delete("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                    .param("version", "0")).andExpect(status().isNoContent()); changes++;
        }
        var revision = jdbc.queryForObject("SELECT ledger_revision FROM app_user WHERE id=?", Long.class, owner);
        assertThat(revision).isEqualTo(1L + changes);
        // 持久化草稿的相同内容PUT与确认重放都不重写当前账单、不增加审计或revision。
        var savedDraft = draftService.save(owner, draftId, null, inputs);
        assertThat(savedDraft.status()).isEqualTo("CONFIRMED"); assertThat(savedDraft.version()).isZero();
        for (int attempt = 0; attempt < 2; attempt++) {
            mvc.perform(post("/api/drafts/" + draftId + "/confirm").session(browser.session())
                    .header("X-CSRF-TOKEN", browser.token()).header("Idempotency-Key", draftId)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                    .andExpect(status().isOk()).andExpect(header().string("Idempotency-Replayed", "true"))
                    .andExpect(content().string(original.getResponse().getContentAsString()));
        }
        var snapshot = mvc.perform(get("/api/records/snapshot/page").session(browser.session()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(revision.toString()))
                .andExpect(jsonPath("$.nextAfter").isEmpty()).andReturn();
        var rows = json.readTree(snapshot.getResponse().getContentAsString()).path("records");
        assertThat(rows.size()).isEqualTo(2);
        var byId = new java.util.HashMap<String, JsonNode>();
        for (var row : rows) byId.put(row.path("record").path("id").asText(), row);
        assertThat(byId.keySet()).containsExactlyInAnyOrder(lunchId, coffeeId);
        var lunch = byId.get(lunchId); var coffee = byId.get(coffeeId);
        assertThat(lunch.path("record").path("amount").asText()).isEqualTo(edited ? "19.00" : "16.00");
        assertThat(lunch.path("record").path("version").asLong()).isEqualTo(edited || lunchDeleted ? 1 : 0);
        assertThat(lunch.path("deletedAt").isTextual()).isEqualTo(lunchDeleted);
        assertThat(coffee.path("record").path("time").asText()).isEqualTo("00:00");
        assertThat(coffee.path("record").path("version").asLong()).isEqualTo(coffeeDeleted ? 1 : 0);
        assertThat(coffee.path("deletedAt").isTextual()).isEqualTo(coffeeDeleted);
        mvc.perform(get("/api/statistics/month").session(browser.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.expense").value(scenario.equals("edit") ? "37.00" : scenario.equals("delete") ? "18.00" : scenario.equals("mixed") ? "19.00" : "0.00"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=?", Long.class, owner)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_write_request WHERE user_id=?", Long.class, owner)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE user_id=?", Long.class, owner)).isEqualTo(2L + changes);
        assertThat(jdbc.queryForObject("SELECT ledger_revision FROM app_user WHERE id=?", Long.class, owner)).isEqualTo(revision);
    }

    @Test void cancelledExpiredAndInvalidDraftsCannotConfirm() throws Exception {
        var alice=account();var me=mvc.perform(get("/api/auth/me").session(alice.session())).andReturn();
        long owner=json.readTree(me.getResponse().getContentAsString()).path("id").asLong();var id=UUID.randomUUID();
        var values=List.of(new RecordInput("expense","1.00",java.time.LocalDate.of(2026,10,3),"餐饮","合成"));
        draftService.save(owner,id,null,values);draftService.cancel(owner,id,0);draftService.cancel(owner,id,0);
        mvc.perform(post("/api/drafts/"+id+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",id).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DRAFT_CLOSED"));
        var expired=UUID.randomUUID();draftService.save(owner,expired,null,values);
        jdbc.update("UPDATE ledger_draft SET expires_at='2020-01-01 00:00:00' WHERE user_id=? AND id=?",owner,expired.toString());
        mvc.perform(post("/api/drafts/"+expired+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",expired).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isGone());
        mvc.perform(post("/api/drafts/"+expired+"/cancel").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(post("/api/drafts/"+expired+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",expired).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DRAFT_CLOSED"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=?",Long.class,owner)).isZero();
        mvc.perform(put("/api/drafts/"+UUID.randomUUID()).session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"records\":["+input("0.00")+"]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/drafts/"+id+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=?",Long.class,owner)).isZero();
    }

    @Test void draftFinalizationFailureRollsBackLedgerRequestAndAuditAndCanRetry() throws Exception {
        var alice=account();var me=mvc.perform(get("/api/auth/me").session(alice.session())).andReturn();
        long owner=json.readTree(me.getResponse().getContentAsString()).path("id").asLong();var id=UUID.randomUUID();
        draftService.save(owner,id,null,List.of(new RecordInput("expense","1.00",java.time.LocalDate.of(2026,10,3),"餐饮","合成")));
        doThrow(new DataIntegrityViolationException("synthetic draft finish failure")).when(drafts)
                .finish(eq(owner),eq(id.toString()),eq(0L),eq("CONFIRMED"),anyString());
        mvc.perform(post("/api/drafts/"+id+"/confirm").session(alice.session()).header("X-CSRF-TOKEN",alice.token())
                .header("Idempotency-Key",id).contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(draftService.get(owner,id).status()).isEqualTo("OPEN");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=?",Long.class,owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_write_request WHERE user_id=?",Long.class,owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE user_id=?",Long.class,owner)).isZero();
        reset(drafts);assertThat(draftService.confirm(owner,id,0,id).records()).hasSize(1);
    }

    @Test void concurrentDraftConfirmationCreatesOnlyOneBatchAndAudit() throws Exception {
        var alice=account();var me=mvc.perform(get("/api/auth/me").session(alice.session())).andReturn();
        long owner=json.readTree(me.getResponse().getContentAsString()).path("id").asLong();var id=UUID.randomUUID();
        draftService.save(owner,id,null,List.of(new RecordInput("expense","1.00",java.time.LocalDate.of(2026,10,3),"餐饮","合成")));
        var barrier=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(6)) {
            var tasks=new java.util.ArrayList<java.util.concurrent.Future<cn.miaoji.ledger.LedgerWriteService.WriteReceipt>>();
            for(int i=0;i<6;i++) tasks.add(pool.submit(() -> {barrier.await();return draftService.confirm(owner,id,0,id);}));
            barrier.countDown();int first=0;
            for(var result:tasks) {var receipt=result.get(20,TimeUnit.SECONDS);if(!receipt.replayed()) first++;}
            assertThat(first).isEqualTo(1);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=?",Long.class,owner)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE user_id=?",Long.class,owner)).isEqualTo(1);
    }

    @Test void auditTracksCommittedVersionsAndNeverDuplicatesReplaysOrRejectedChanges() throws Exception {
        var alice = account(); var bob = account(); var key = UUID.randomUUID().toString();
        var result = mvc.perform(post("/api/records").session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(input("1.00")))
                .andExpect(status().isCreated()).andReturn();
        var id = json.readTree(result.getResponse().getContentAsString()).path("id").asText();
        mvc.perform(post("/api/records").session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(input("1.00")))
                .andExpect(status().isOk());
        mvc.perform(put("/api/records/" + id).session(bob.session()).header("X-CSRF-TOKEN", bob.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"record\":" + input("2.00") + "}"))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/records/" + id).session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"record\":" + input("2.00") + "}"))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/records/" + id).param("version", "0").session(alice.session())
                .header("X-CSRF-TOKEN", alice.token())).andExpect(status().isConflict());
        mvc.perform(delete("/api/records/" + id).param("version", "1").session(alice.session())
                .header("X-CSRF-TOKEN", alice.token())).andExpect(status().isNoContent());
        var rows = jdbc.queryForList("SELECT action,before_version,after_version,request_id,user_id FROM ledger_audit WHERE record_id=? ORDER BY id", id);
        assertThat(rows).hasSize(3);
        assertThat(rows.stream().map(row -> row.get("action"))).containsExactly("CREATE", "UPDATE", "DELETE");
        assertThat(rows.get(0).get("before_version")).isNull();
        assertThat(rows.get(0).get("request_id")).isEqualTo(key);
        assertThat(rows.stream().map(row -> row.get("after_version"))).containsExactly(0L, 1L, 2L);
        assertThat(rows.get(1).get("before_version")).isEqualTo(0L);
        assertThat(rows.get(2).get("before_version")).isEqualTo(1L);
        assertThat(rows.stream().map(row -> row.get("user_id")).distinct()).hasSize(1);
    }

    @Test void failedAuditRollsBackBatchRequestAndAllCreatedRecords() throws Exception {
        var alice = account(); var key = UUID.randomUUID().toString();
        var me = mvc.perform(get("/api/auth/me").session(alice.session())).andExpect(status().isOk()).andReturn();
        var owner = json.readTree(me.getResponse().getContentAsString()).path("id").asLong();
        doCallRealMethod().doThrow(new DataIntegrityViolationException("synthetic audit failure"))
                .when(audit).append(eq(owner), anyString(), eq("CREATE"), isNull(), eq(0L), eq(key));
        var body = "{\"records\":[" + input("1.00") + "," + input("2.00") + "]}";
        mvc.perform(post("/api/records/batch").session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isServiceUnavailable());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id=?", Long.class, owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE user_id=?", Long.class, owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_write_request WHERE user_id=?", Long.class, owner)).isZero();
        reset(audit);
        mvc.perform(post("/api/records/batch").session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE user_id=?", Long.class, owner)).isEqualTo(2);
    }

    @Test void failedAuditRollsBackUpdatesAndLogicalDeletion() throws Exception {
        var alice = account(); var record = create(alice, "1.00"); var id = record.path("id").asText();
        doThrow(new DataIntegrityViolationException("synthetic audit failure")).when(audit)
                .append(anyLong(), eq(id), eq("UPDATE"), eq(0L), eq(1L), isNull());
        mvc.perform(put("/api/records/" + id).session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"record\":" + input("2.00") + "}"))
                .andExpect(status().isServiceUnavailable());
        mvc.perform(get("/api/records/" + id).session(alice.session())).andExpect(jsonPath("$.amount").value("1.00"))
                .andExpect(jsonPath("$.version").value(0));
        doThrow(new DataIntegrityViolationException("synthetic audit failure")).when(audit)
                .append(anyLong(), eq(id), eq("DELETE"), eq(0L), eq(1L), isNull());
        mvc.perform(delete("/api/records/" + id).param("version", "0").session(alice.session())
                .header("X-CSRF-TOKEN", alice.token())).andExpect(status().isServiceUnavailable());
        mvc.perform(get("/api/records/" + id).session(alice.session())).andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(0));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE record_id=?", Long.class, id)).isEqualTo(1);
    }

    @Test void snapshotIncludesOwnedHistoryAndDeletionFactsButNeverOtherAccount() throws Exception {
        mvc.perform(get("/api/records/snapshot")).andExpect(status().isUnauthorized());
        var alice = account(); var bob = account();
        var removed = create(alice, "1.00");
        create(bob, "99.00");
        mvc.perform(delete("/api/records/" + removed.path("id").asText()).param("version", "0")
                .session(alice.session()).header("X-CSRF-TOKEN", alice.token())).andExpect(status().isNoContent());
        var result = mvc.perform(get("/api/records/snapshot").session(alice.session())).andExpect(status().isOk()).andReturn();
        var entries = json.readTree(result.getResponse().getContentAsString()).path("records");
        assertThat(entries.size()).isEqualTo(1);
        assertThat(entries.get(0).path("record").path("id").asText()).isEqualTo(removed.path("id").asText());
        assertThat(entries.get(0).path("deletedAt").isTextual()).isTrue();
        mvc.perform(get("/api/records").session(alice.session()).param("month", "2026-10")).andExpect(jsonPath("$.total").value(0));
    }

    @Test void stalePageAccountAssertionCannotReadWriteOrLogoutAnotherSession() throws Exception {
        var alice = account(); var bob = account();
        var aliceRecord = create(alice, "1.00");
        var owner = jdbc.queryForObject("SELECT user_id FROM ledger_record WHERE id = ?", Long.class, aliceRecord.path("id").asText());
        mvc.perform(get("/api/records/snapshot").session(bob.session()).header("X-Expected-Account", owner.toString()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ACCOUNT_CHANGED"));
        mvc.perform(get("/api/profile/avatar").session(bob.session()).param("expectedAccount", owner.toString()))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/records").session(bob.session()).header("X-Expected-Account", owner.toString())
                .header("Idempotency-Key", UUID.randomUUID().toString()).header("X-CSRF-TOKEN", alice.token())
                .contentType(MediaType.APPLICATION_JSON).content(input("99.00"))).andExpect(status().isConflict());
        mvc.perform(post("/api/auth/logout").session(bob.session()).header("X-Expected-Account", owner.toString()))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/auth/me").session(bob.session())).andExpect(status().isOk());
        mvc.perform(get("/api/records").session(bob.session()).param("month", "2026-10")).andExpect(jsonPath("$.total").value(0));
    }

    @Test void snapshotRefusesToSilentlyTruncateLargeLedger() throws Exception {
        var alice = account(); var record = create(alice, "1.00");
        var owner = jdbc.queryForObject("SELECT user_id FROM ledger_record WHERE id = ?", Long.class, record.path("id").asText());
        var entries = new java.util.ArrayList<Object[]>();
        for (int i = 0; i < 5000; i++) entries.add(new Object[]{UUID.randomUUID().toString(), owner});
        jdbc.batchUpdate("INSERT INTO ledger_record (id,user_id,type,amount,business_date,category,note) VALUES (?,?,'expense',1.00,'2026-10-03','餐饮','synthetic limit')", entries);
        mvc.perform(get("/api/records/snapshot").session(alice.session())).andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("LEDGER_TOO_LARGE"));
    }

    @Test void anonymousCannotReadWriteOrSummarize() throws Exception {
        mvc.perform(get("/api/records").param("month", "2026-10")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/statistics/month").param("month", "2026-10")).andExpect(status().isUnauthorized());
        var browser = anonymous();
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input("1.00"))).andExpect(status().isUnauthorized());
    }

    @Test void passwordIsHashedAndWrongPasswordNeverAuthenticates() throws Exception {
        var browser = anonymous();
        var name = username();
        register(browser, name, PASSWORD).andExpect(status().isCreated());
        var hash = jdbc.queryForObject("SELECT password_hash FROM app_user WHERE username = ?", String.class, name);
        assertThat(hash).isNotEqualTo(PASSWORD);
        assertThat(encoder.matches(PASSWORD, hash)).isTrue();
        mvc.perform(post("/api/auth/login").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("username", name).param("password", "wrong")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").session(browser.session())).andExpect(status().isUnauthorized());
    }

    @Test void normalizedUsernameHasUniqueConstraint() throws Exception {
        var browser = anonymous();
        var name = username();
        register(browser, name, PASSWORD).andExpect(status().isCreated());
        register(browser, name.toUpperCase(java.util.Locale.ROOT), PASSWORD).andExpect(status().isConflict());
    }

    @Test void loginChangesSessionIdAndNeverReturnsPasswordHash() throws Exception {
        var browser = anonymous();
        var name = username();
        register(browser, name, PASSWORD).andExpect(status().isCreated());
        var oldId = browser.session().getId();
        mvc.perform(post("/api/auth/login").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("username", name).param("password", PASSWORD)).andExpect(status().isNoContent());
        assertThat(browser.session().getId()).isNotEqualTo(oldId);
        mvc.perform(get("/api/auth/me").session(browser.session())).andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(name)).andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    @Test void csrfRequiredForRegisterLoginWriteAndLogout() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"example\",\"password\":\"SyntheticPass123!\"}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/login").param("username", "example").param("password", PASSWORD))
                .andExpect(status().isForbidden());
        var browser = account();
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).contentType(MediaType.APPLICATION_JSON)
                .content(input("1.00"))).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout").session(browser.session())).andExpect(status().isForbidden());
    }

    @Test void otherAccountCannotReadUpdateDeleteOrSummarizeRecord() throws Exception {
        var alice = account();
        var bob = account();
        var record = create(alice, "25.10");
        var id = record.path("id").asText();
        mvc.perform(get("/api/records/" + id).session(bob.session())).andExpect(status().isNotFound());
        mvc.perform(put("/api/records/" + id).session(bob.session()).header("X-CSRF-TOKEN", bob.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"record\":" + input("9.00") + "}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/records/" + id).session(bob.session()).header("X-CSRF-TOKEN", bob.token())
                .param("version", "0")).andExpect(status().isNotFound());
        mvc.perform(get("/api/records").session(bob.session()).param("month", "2026-10").param("user_id", "1"))
                .andExpect(jsonPath("$.records").isEmpty());
        mvc.perform(get("/api/statistics/month").session(bob.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.expense").value("0.00")).andExpect(jsonPath("$.count").value(0));
        mvc.perform(get("/api/records/" + id).session(alice.session())).andExpect(jsonPath("$.amount").value("25.10"));
    }

    @Test void unknownOwnerFieldsAreRejectedRatherThanTrusted() throws Exception {
        var browser = account();
        var body = input("1.00").replace("}", ",\"user_id\":123}");
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
    }

    @Test void updateRequiresCurrentVersionAndDeletedRecordCannotBeRestored() throws Exception {
        var browser = account();
        var id = create(browser, "0.10").path("id").asText();
        var update = "{\"version\":0,\"record\":" + input("0.20") + "}";
        mvc.perform(put("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        mvc.perform(put("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isConflict());
        mvc.perform(delete("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("version", "0")).andExpect(status().isConflict());
        mvc.perform(delete("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("version", "1")).andExpect(status().isNoContent());
        mvc.perform(get("/api/records/" + id).session(browser.session())).andExpect(status().isNotFound());
        mvc.perform(put("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isNotFound());
        mvc.perform(get("/api/statistics/month").session(browser.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.count").value(0));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE id = ? AND deleted_at IS NOT NULL", Long.class, id)).isEqualTo(1);
    }

    @Test void decimalStatisticsUseBusinessMonthAndNotFloatOrDeletedData() throws Exception {
        var browser = account();
        create(browser, "0.10");
        create(browser, "0.20");
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input("100.00").replace("expense", "income").replace("餐饮", "工资")))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input("10.00").replace("2026-10-03", "2026-11-01")))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/statistics/month").session(browser.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.expense").value("0.30")).andExpect(jsonPath("$.income").value("100.00"))
                .andExpect(jsonPath("$.balance").value("99.70")).andExpect(jsonPath("$.count").value(3));
    }

    @ParameterizedTest @ValueSource(strings = {"0", "-1", "1.001", "1e3", "NaN", "1000000000", "01.00"})
    void invalidMoneyCannotBeWritten(String amount) throws Exception {
        var browser = account();
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input(amount))).andExpect(status().isBadRequest());
    }

    @Test void invalidDatesCategoriesAndPagingAreRejected() throws Exception {
        var browser = account();
        for (var body : java.util.List.of(input("1").replace("2026-10-03", "2026-02-30"),
                input("1").replace("餐饮", "工资"), input("1").replace("2026-10-03", "0001-01-01"))) {
            mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                    .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-13")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("size", "101"))
                .andExpect(status().isBadRequest());
    }

    @Test void logoutAndInvalidSessionCannotReadPersistedLedger() throws Exception {
        var browser = account();
        var id = create(browser, "12.00").path("id").asText();
        mvc.perform(post("/api/auth/logout").session(browser.session()).header("X-CSRF-TOKEN", browser.token()))
                .andExpect(status().isNoContent());
        assertThat(browser.session().isInvalid()).isTrue();
        mvc.perform(get("/api/records/" + id).cookie(new jakarta.servlet.http.Cookie("MIAOJI_SESSION", browser.session().getId())))
                .andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE id = ?", Long.class, id)).isEqualTo(1);
    }

    @Test void invalidPasswordNeverAppearsInErrorResponse() throws Exception {
        var browser = anonymous();
        var result = register(browser, username(), "shortSecret").andExpect(status().isBadRequest()).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("shortSecret", "password_hash", "INSERT");
    }

    @Test void moneyMustBeJsonStringAndMissingInputsNeverWrite() throws Exception {
        var browser = account();
        for (var body : java.util.List.of(input("1.20").replace("\"1.20\"", "1.20"),
                input("1.20").replace("\"amount\":\"1.20\",", ""))) {
            mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                    .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/statistics/month").session(browser.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.count").value(0));
        mvc.perform(get("/api/records").session(browser.session())).andExpect(status().isBadRequest());
    }

    @Test void loginInvalidatesPreLoginCsrfTokenAndPagingDoesNotMixAccounts() throws Exception {
        var browser = anonymous();
        var name = username();
        register(browser, name, PASSWORD).andExpect(status().isCreated());
        mvc.perform(post("/api/auth/login").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("username", name).param("password", PASSWORD)).andExpect(status().isNoContent());
        mvc.perform(post("/api/records").header("Idempotency-Key", UUID.randomUUID().toString()).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input("1.00"))).andExpect(status().isForbidden());
        var authenticated = refresh(browser.session());
        var first = create(authenticated, "1.00").path("id").asText();
        var second = create(authenticated, "2.00").path("id").asText();
        create(account(), "99.00");
        var page0 = mvc.perform(get("/api/records").session(authenticated.session())
                .param("month", "2026-10").param("size", "1")).andExpect(status().isOk()).andReturn();
        var page1 = mvc.perform(get("/api/records").session(authenticated.session())
                .param("month", "2026-10").param("size", "1").param("page", "1"))
                .andExpect(status().isOk()).andReturn();
        var id0 = json.readTree(page0.getResponse().getContentAsString()).path("records").get(0).path("id").asText();
        var id1 = json.readTree(page1.getResponse().getContentAsString()).path("records").get(0).path("id").asText();
        assertThat(java.util.Set.of(id0, id1)).containsExactlyInAnyOrder(first, second);
    }

    private long owner(Browser browser) throws Exception {
        var result = mvc.perform(get("/api/auth/me").session(browser.session())).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).path("id").asLong();
    }

    private ResultActions write(Browser browser, UUID key, String body, boolean batch) throws Exception {
        return mvc.perform(post(batch ? "/api/records/batch" : "/api/records").session(browser.session())
                .header("X-CSRF-TOKEN", browser.token()).header("Idempotency-Key", key.toString())
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private String batch(String... amounts) {
        return "{\"records\":[" + String.join(",", java.util.Arrays.stream(amounts).map(this::input).toList()) + "]}";
    }

    private void noWrites(long owner) {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_write_request WHERE user_id = ?", Long.class, owner)).isZero();
    }

    @Test void sameKeySameMeaningReplaysAndOtherPayloadOrEndpointConflicts() throws Exception {
        var browser = account();
        var key = UUID.randomUUID();
        var original = write(browser, key, input("1"), false).andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "false")).andReturn();
        var replay = write(browser, key, input("1.00"), false).andExpect(status().isOk())
                .andExpect(header().string("Idempotency-Replayed", "true")).andReturn();
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(original.getResponse().getContentAsString());
        write(browser, key, input("2.00"), false).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_KEY_REUSED"));
        write(browser, key, batch("1.00"), true).andExpect(status().isConflict());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner(browser))).isEqualTo(1);
    }

    @Test void requestKeysAreScopedToAccountAndDeletedRecordIsNeverRecreatedByRetry() throws Exception {
        var alice = account();
        var bob = account();
        var key = UUID.randomUUID();
        var original = write(alice, key, input("2.00"), false).andExpect(status().isCreated()).andReturn();
        var id = json.readTree(original.getResponse().getContentAsString()).path("id").asText();
        var other = write(bob, key, input("9.00"), false).andExpect(status().isCreated()).andReturn();
        assertThat(json.readTree(other.getResponse().getContentAsString()).path("id").asText()).isNotEqualTo(id);
        mvc.perform(delete("/api/records/" + id).session(alice.session()).header("X-CSRF-TOKEN", alice.token())
                .param("version", "0")).andExpect(status().isNoContent());
        write(alice, key, input("2.00"), false).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        mvc.perform(get("/api/records/" + id).session(alice.session())).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner(alice))).isEqualTo(1);
    }

    @Test void mixedBatchCommitsOnceAndSemanticOrStructuralErrorsCommitNothing() throws Exception {
        var browser = account();
        var key = UUID.randomUUID();
        var invalid = batch("1.00", "2.00").replace("2.00", "0.00");
        write(browser, key, invalid, true).andExpect(status().isBadRequest());
        for (var invalidBody : List.of(batch(), batch("1", "2", "3", "4", "5", "6"),
                "{\"records\":[null]}", batch("1").replace("餐饮", "工资"))) {
            write(browser, key, invalidBody, true).andExpect(status().isBadRequest());
        }
        noWrites(owner(browser));
        var body = "{\"records\":[" + input("0.10") + "," + input("100.00").replace("expense", "income").replace("餐饮", "工资") + "]}";
        var original = write(browser, key, body, true).andExpect(status().isCreated())
                .andExpect(jsonPath("$.records.length()").value(2)).andReturn();
        var replay = write(browser, key, body, true).andExpect(status().isOk()).andReturn();
        assertThat(replay.getResponse().getContentAsString()).isEqualTo(original.getResponse().getContentAsString());
        mvc.perform(get("/api/statistics/month").session(browser.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.income").value("100.00")).andExpect(jsonPath("$.expense").value("0.10"))
                .andExpect(jsonPath("$.count").value(2));
    }

    @Test void storageFailureAfterSecondInsertRollsBackWholeBatchAndAllowsSameKeyRetry() throws Exception {
        var browser = account();
        var owner = owner(browser);
        var key = UUID.randomUUID();
        var count = new AtomicInteger();
        doAnswer(invocation -> {
            invocation.callRealMethod();
            if (count.incrementAndGet() == 2) throw new DataIntegrityViolationException("synthetic storage fault");
            return null;
        }).when(records).insert(eq(owner), anyString(), any(RecordInput.class));
        write(browser, key, batch("0.10", "0.20"), true).andExpect(status().isServiceUnavailable());
        noWrites(owner);
        reset(records);
        write(browser, key, batch("0.10", "0.20"), true).andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner)).isEqualTo(2);
    }

    @Test void receiptFailureRollsBackRecordAndRequestKeyTogether() throws Exception {
        var browser = account();
        var owner = owner(browser);
        var key = UUID.randomUUID();
        doThrow(new DataIntegrityViolationException("synthetic receipt fault"))
                .when(requests).complete(eq(owner), anyString(), anyString());
        write(browser, key, input("1.00"), false).andExpect(status().isServiceUnavailable());
        noWrites(owner);
        reset(requests);
        write(browser, key, input("1.00"), false).andExpect(status().isCreated());
    }

    @Test void concurrentIdenticalRequestsOnlyCreateOneRecord() throws Exception {
        var browser = account();
        var owner = owner(browser);
        var key = UUID.randomUUID();
        var start = new CountDownLatch(1);
        var input = new RecordInput("expense", "1.20", java.time.LocalDate.of(2026, 10, 3), "餐饮", "合成并发测试");
        try (var executor = Executors.newFixedThreadPool(6)) {
            var futures = java.util.stream.IntStream.range(0, 6).mapToObj(index -> executor.submit(() -> {
                start.await();
                return writes.single(owner, key, input);
            })).toList();
            start.countDown();
            var receipts = new java.util.ArrayList<LedgerWriteService.WriteReceipt>();
            for (var future : futures) receipts.add(future.get(15, TimeUnit.SECONDS));
            assertThat(receipts.stream().filter(receipt -> !receipt.replayed()).count()).isEqualTo(1);
            assertThat(receipts.stream().map(receipt -> receipt.records().getFirst().id()).distinct().count()).isEqualTo(1);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner)).isEqualTo(1);
    }

    @Test void missingAndInvalidRequestKeysCannotWrite() throws Exception {
        var browser = account();
        mvc.perform(post("/api/records").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(input("1.00"))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/records/batch").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .header("Idempotency-Key", "invalid-key").contentType(MediaType.APPLICATION_JSON).content(batch("1.00")))
                .andExpect(status().isBadRequest());
        noWrites(owner(browser));
    }

    @Test void categoryCatalogRequiresLoginAndSeparatesIncomeOtherFromExpenseOther() throws Exception {
        mvc.perform(get("/api/categories")).andExpect(status().isUnauthorized());
        var browser = account();
        mvc.perform(get("/api/categories").session(browser.session())).andExpect(status().isOk())
                .andExpect(jsonPath("$.expense.length()").value(8)).andExpect(jsonPath("$.income.length()").value(6))
                .andExpect(jsonPath("$.expense[7]").value("其他")).andExpect(jsonPath("$.income[5]").value("其他"));
    }

    @Test void combinedFiltersUseSameAccountAndFilteredPageTotalWithoutChangingMonthStatistics() throws Exception {
        var browser = account();
        write(browser, UUID.randomUUID(), input("10.10").replace("餐饮", "其他").replace("测试午饭", "note 10%_ABC!"), false)
                .andExpect(status().isCreated());
        write(browser, UUID.randomUUID(), input("20.20").replace("expense", "income").replace("餐饮", "其他"), false)
                .andExpect(status().isCreated());
        create(browser, "0.10");
        create(account(), "99.00");
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("category", "其他"))
                .andExpect(jsonPath("$.total").value(2)).andExpect(jsonPath("$.records.length()").value(2));
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10")
                .param("category", "其他").param("type", "expense").param("date", "2026-10-03").param("q", "abc"))
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.records[0].amount").value("10.10"));
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10")
                .param("q", "其他 abc 10.10 支出 2026-10"))
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.records[0].amount").value("10.10"));
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("size", "1").param("page", "2"))
                .andExpect(jsonPath("$.total").value(3)).andExpect(jsonPath("$.records.length()").value(1));
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("size", "1").param("page", "3"))
                .andExpect(jsonPath("$.total").value(3)).andExpect(jsonPath("$.records").isEmpty());
        mvc.perform(get("/api/statistics/month").session(browser.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.count").value(3)).andExpect(jsonPath("$.expense").value("10.20"))
                .andExpect(jsonPath("$.income").value("20.20"));
    }

    @Test void searchTreatsWildcardsAndSqlTextAsLiteralAndRejectsInvalidFilterCombination() throws Exception {
        var browser = account();
        write(browser, UUID.randomUUID(), input("10.00").replace("测试午饭", "10%_SALE!"), false).andExpect(status().isCreated());
        create(browser, "20.00");
        for (var query : List.of("%", "_", "!", "sale", "10.00")) {
            mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("q", query))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1));
        }
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("q", "' OR 1=1 --"))
                .andExpect(jsonPath("$.total").value(0));
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("type", "expense").param("category", "工资"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("type", "unknown"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("date", "2026-11-01"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("q", "x".repeat(121)))
                .andExpect(status().isBadRequest());
    }

    @Test void detailedStatisticsMatchLedgerAndExcludeOtherAccountsOtherMonthsAndDeletedRecords() throws Exception {
        var browser = account();
        create(browser, "0.10");
        write(browser, UUID.randomUUID(), input("0.20").replace("餐饮", "其他"), false).andExpect(status().isCreated());
        write(browser, UUID.randomUUID(), input("0.50").replace("expense", "income").replace("餐饮", "其他"), false)
                .andExpect(status().isCreated());
        write(browser, UUID.randomUUID(), input("100.00").replace("2026-10-03", "2026-11-01"), false).andExpect(status().isCreated());
        var deletedId = create(browser, "10.00").path("id").asText();
        mvc.perform(delete("/api/records/" + deletedId).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .param("version", "0")).andExpect(status().isNoContent());
        create(account(), "99.00");
        mvc.perform(get("/api/statistics/month/detail").session(browser.session()).param("month", "2026-10"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.income").value("0.50"))
                .andExpect(jsonPath("$.expense").value("0.30")).andExpect(jsonPath("$.balance").value("0.20"))
                .andExpect(jsonPath("$.count").value(3)).andExpect(jsonPath("$.incomeCount").value(1))
                .andExpect(jsonPath("$.expenseCount").value(2)).andExpect(jsonPath("$.categories.expense[0].category").value("其他"))
                .andExpect(jsonPath("$.categories.expense[0].percent").value("66.7"))
                .andExpect(jsonPath("$.categories.expense[1].percent").value("33.3"))
                .andExpect(jsonPath("$.categories.income[0].category").value("其他"));
        mvc.perform(get("/api/statistics/month/detail").session(browser.session()).param("month", "2026-12"))
                .andExpect(jsonPath("$.income").value("0.00")).andExpect(jsonPath("$.count").value(0))
                .andExpect(jsonPath("$.categories.expense").isEmpty()).andExpect(jsonPath("$.categories.income").isEmpty());
    }

    @Test void businessTimeIsValidatedPersistedSearchableAndPartOfRequestIdentity() throws Exception {
        var browser = account();
        var key = UUID.randomUUID();
        var body = input("1.00").replace("}", ",\"time\":\"21:15\"}");
        var original = write(browser, key, body, false).andExpect(status().isCreated())
                .andExpect(jsonPath("$.time").value("21:15")).andReturn();
        var id = json.readTree(original.getResponse().getContentAsString()).path("id").asText();
        write(browser, key, body, false).andExpect(status().isOk()).andExpect(jsonPath("$.time").value("21:15"));
        write(browser, key, body.replace("21:15", "21:16"), false).andExpect(status().isConflict());
        for (var invalid : List.of("24:00", "9:30", "12:60", "")) {
            write(browser, UUID.randomUUID(), body.replace("21:15", invalid), false).andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/records").session(browser.session()).param("month", "2026-10").param("q", "21:15"))
                .andExpect(jsonPath("$.total").value(1));
        mvc.perform(put("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"record\":" + body.replace("21:15", "22:05") + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.time").value("22:05"));
        // 省略time代表最新时间未知，更新及snapshot不能沿用旧22:05。
        mvc.perform(put("/api/records/" + id).session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"version\":1,\"record\":" + input("1.25") + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.amount").value("1.25")).andExpect(jsonPath("$.time").doesNotExist());
        assertThat(jdbc.queryForObject("SELECT business_time FROM ledger_record WHERE id=?", String.class, id)).isNull();
        mvc.perform(get("/api/records/snapshot/page").session(browser.session()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.records[0].record.id").value(id))
                .andExpect(jsonPath("$.records[0].record.version").value(2))
                .andExpect(jsonPath("$.records[0].record.time").doesNotExist());
        write(browser, key, body, false).andExpect(status().isOk())
                .andExpect(content().string(original.getResponse().getContentAsString()));
        mvc.perform(get("/api/records/" + id).session(browser.session())).andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value("1.25")).andExpect(jsonPath("$.time").doesNotExist());
    }

    private record LegacyInput(String type, String amount, java.time.LocalDate date, String category, String note) {}
    private record LegacyView(String id, String type, String amount, java.time.LocalDate date, String category, String note, long version) {}

    @Test void storedV2RequestWithoutTimeStillReplaysAfterAddingOptionalTime() throws Exception {
        var browser = account();
        var owner = owner(browser);
        var key = UUID.randomUUID();
        var id = UUID.randomUUID().toString();
        var oldInput = new LegacyInput("expense", "1.20", java.time.LocalDate.of(2026, 10, 3), "餐饮", "测试午饭");
        var oldPayload = "single-v1\n" + json.writeValueAsString(List.of(oldInput));
        var hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                .digest(oldPayload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        records.insert(owner, id, new RecordInput(oldInput.type(), oldInput.amount(), oldInput.date(), oldInput.category(), oldInput.note()));
        requests.claim(owner, key.toString(), hash);
        requests.complete(owner, key.toString(), json.writeValueAsString(List.of(new LegacyView(id, "expense", "1.20",
                oldInput.date(), "餐饮", "测试午饭", 0))));
        write(browser, key, input("1.20"), false).andExpect(status().isOk())
                .andExpect(header().string("Idempotency-Replayed", "true")).andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.time").doesNotExist());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner)).isEqualTo(1);
    }

    private String backupFile(String id1, String id2, String deletedAt) {
        var deleted = deletedAt == null ? "null" : "\"" + deletedAt + "\"";
        return """
                {"format":"miaoji-ledger-backup","formatVersion":1,"exportedAt":"2026-10-12T06:00:00Z","recordCount":2,
                 "records":[
                  {"id":"%s","version":0,"type":"expense","amount":"25.00","date":"2026-10-03","time":"12:30","category":"餐饮","note":"恢复午饭","deletedAt":null,"createdAt":"2026-10-03T04:30:00Z","updatedAt":"2026-10-03T04:30:00Z"},
                  {"id":"%s","version":2,"type":"income","amount":"100.00","date":"2026-10-03","category":"工资","note":"恢复工资","deletedAt":%s,"createdAt":"2026-10-03T04:30:00Z","updatedAt":"2026-10-03T04:30:00Z"}
                 ]}
                """.formatted(id1, id2, deleted);
    }

    @Test void backupExportCoversAllFieldsAndDeletionFactsForOwnerOnly() throws Exception {
        var alice = account(); var bob = account();
        var one = create(alice, "1.00"); create(alice, "2.50");
        mvc.perform(delete("/api/records/" + one.path("id").asText()).session(alice.session())
                .header("X-CSRF-TOKEN", alice.token()).param("version", "0")).andExpect(status().isNoContent());
        mvc.perform(get("/api/records/export")).andExpect(status().isUnauthorized());
        var exported = json.readTree(mvc.perform(get("/api/records/export").session(alice.session()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(exported.path("format").asText()).isEqualTo("miaoji-ledger-backup");
        assertThat(exported.path("formatVersion").asInt()).isEqualTo(1);
        assertThat(exported.path("recordCount").asInt()).isEqualTo(2);
        var rows = exported.path("records");
        assertThat(rows.size()).isEqualTo(2);
        assertThat(rows.findValues("deletedAt").stream().filter(JsonNode::isTextual)).hasSize(1);
        JsonNode live = null;
        for (var row : rows) if (row.path("deletedAt").isNull()) live = row;
        assertThat(live).isNotNull();
        assertThat(live.path("amount").asText()).isEqualTo("2.50");
        assertThat(live.path("date").asText()).isEqualTo("2026-10-03");
        assertThat(live.path("category").asText()).isEqualTo("餐饮");
        assertThat(live.path("note").asText()).isEqualTo("测试午饭");
        assertThat(live.path("version").asLong()).isZero();
        assertThat(live.path("createdAt").isTextual()).isTrue();
        assertThat(live.path("updatedAt").isTextual()).isTrue();
        var bobExported = json.readTree(mvc.perform(get("/api/records/export").session(bob.session()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(bobExported.path("recordCount").asInt()).isZero();
    }

    @Test void backupImportRestoresRecordsIdempotentlyAndNeverTouchesExistingLedgers() throws Exception {
        var alice = account(); var bob = account();
        var bobRecord = create(bob, "77.00");
        var id1 = UUID.randomUUID().toString(); var id2 = UUID.randomUUID().toString();
        var file = backupFile(id1, id2, "2026-10-11T02:00:00Z");
        // 未登录的写入型请求先被CSRF拦截（403），不会进入导入逻辑。
        mvc.perform(post("/api/records/import")).andExpect(status().isForbidden());
        var first = json.readTree(mvc.perform(post("/api/records/import").session(alice.session())
                .header("X-CSRF-TOKEN", alice.token()).contentType(MediaType.APPLICATION_JSON).content(file))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(first.path("imported").asInt()).isEqualTo(2);
        assertThat(first.path("skipped").asInt()).isZero();
        assertThat(first.path("total").asInt()).isEqualTo(2);
        // 恢复的数据进入读取与统计；已删除记录保留标记且不计入统计。
        var snapshot = json.readTree(mvc.perform(get("/api/records/snapshot").session(alice.session()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(snapshot.path("records").size()).isEqualTo(2);
        mvc.perform(get("/api/statistics/month").session(alice.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.expense").value("25.00")).andExpect(jsonPath("$.income").value("0.00"))
                .andExpect(jsonPath("$.count").value(1));
        // 版本、时间与删除标记原样保留。
        var reexported = json.readTree(mvc.perform(get("/api/records/export").session(alice.session()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        JsonNode restoredLive = null, restoredDeleted = null;
        for (var row : reexported.path("records")) {
            if (row.path("id").asText().equals(id1)) restoredLive = row;
            if (row.path("id").asText().equals(id2)) restoredDeleted = row;
        }
        assertThat(restoredLive.path("version").asLong()).isZero();
        assertThat(restoredLive.path("time").asText()).isEqualTo("12:30");
        assertThat(restoredLive.path("amount").asText()).isEqualTo("25.00");
        assertThat(restoredDeleted.path("version").asLong()).isEqualTo(2);
        assertThat(restoredDeleted.path("deletedAt").isTextual()).isTrue();
        // 重复导入全部跳过且不推进读取版本。
        var second = json.readTree(mvc.perform(post("/api/records/import").session(alice.session())
                .header("X-CSRF-TOKEN", alice.token()).contentType(MediaType.APPLICATION_JSON).content(file))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(second.path("imported").asInt()).isZero();
        assertThat(second.path("skipped").asInt()).isEqualTo(2);
        assertThat(second.path("revision").asText()).isEqualTo(first.path("revision").asText());
        // 其他账号已占用的编号同样跳过，且该账号账本不被改动。
        var intoBob = json.readTree(mvc.perform(post("/api/records/import").session(bob.session())
                .header("X-CSRF-TOKEN", bob.token()).contentType(MediaType.APPLICATION_JSON).content(file))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(intoBob.path("imported").asInt()).isZero();
        assertThat(intoBob.path("skipped").asInt()).isEqualTo(2);
        mvc.perform(get("/api/records").session(bob.session()).param("month", "2026-10"))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.records[0].id").value(bobRecord.path("id").asText()));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_audit WHERE record_id = ?", Long.class, id1)).isEqualTo(1);
    }

    @Test void backupImportRejectsInvalidFilesWithoutTouchingLedger() throws Exception {
        var browser = account();
        var owner = owner(browser);
        var revision = jdbc.queryForObject("SELECT ledger_revision FROM app_user WHERE id = ?", Long.class, owner);
        var d1 = UUID.randomUUID().toString(); var d2 = UUID.randomUUID().toString();
        var valid = backupFile(d1, d2, "2026-10-11T02:00:00Z");
        var bad = List.of(
                "{\"format\":\"other-app\",\"formatVersion\":1,\"records\":[{\"id\":\"" + d1 + "\",\"version\":0,\"type\":\"expense\",\"amount\":\"1.00\",\"date\":\"2026-10-03\",\"category\":\"餐饮\",\"note\":\"x\"}]}",
                valid.replace("\"formatVersion\":1", "\"formatVersion\":2"),
                "{\"format\":\"miaoji-ledger-backup\",\"formatVersion\":1,\"records\":[]}",
                valid.replace("\"amount\":\"25.00\"", "\"amount\":\"1,000\""),
                valid.replace("\"category\":\"餐饮\"", "\"category\":\"虚构\""),
                valid.replace("\"date\":\"2026-10-03\",\"time\":\"12:30\"", "\"date\":\"2026-02-30\""),
                valid.replace("\"time\":\"12:30\"", "\"time\":\"24:00\""),
                valid.replace("\"version\":0", "\"version\":-1"),
                valid.replace("\"deletedAt\":\"2026-10-11T02:00:00Z\"", "\"deletedAt\":\"nonsense\""),
                valid.replace("\"note\":\"恢复工资\"", "\"note\":\"恢复工资\",\"extra\":1"),
                backupFile(d1, d1, null));
        for (var body : bad) {
            mvc.perform(post("/api/records/import").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                    .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/records/import").session(browser.session()).header("X-CSRF-TOKEN", browser.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"format\":\"other-app\",\"formatVersion\":1,\"records\":[]}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("BACKUP_INVALID"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ledger_record WHERE user_id = ?", Long.class, owner)).isZero();
        assertThat(jdbc.queryForObject("SELECT ledger_revision FROM app_user WHERE id = ?", Long.class, owner)).isEqualTo(revision);
    }
}
