package cn.miaoji.ledger;

import cn.miaoji.common.ApiException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class GlmDraftParserTest {
    private final ObjectMapper json=new ObjectMapper().findAndRegisterModules()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    private final LedgerService ledger=new LedgerService(mock(LedgerRepository.class),
            Validation.buildDefaultValidatorFactory().getValidator(),mock(LedgerAuditRepository.class));
    private final GlmDraftParser.Input input=new GlmDraftParser.Input("午饭25元",LocalDate.of(2026,10,4),List.of());
    private final Map<String,Object> row=Map.of("type","expense","amount","25.00","date","2026-10-04","category","餐饮","note","午饭");
    private GlmDraftParser parser(GlmDraftParser.Exchange exchange) {return new GlmDraftParser(json,ledger,true,"synthetic-key",exchange);}
    private GlmDraftParser.Reply reply(String content) throws Exception {
        return new GlmDraftParser.Reply(200,json.writeValueAsBytes(Map.of("choices",List.of(Map.of("finish_reason","stop","message",Map.of("content",content))))));
    }
    private void code(Runnable call,String expected) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.code()).isEqualTo(expected));
    }
    @Test void readyProposalIsValidatedWithoutAnyWriteAndUsesFixedModel() throws Exception {
        var response=reply(json.writeValueAsString(Map.of("records",List.of(row),"question","")));
        var service=parser(request->{
            assertThat(request.uri().toString()).isEqualTo("https://open.bigmodel.cn/api/paas/v4/chat/completions");
            assertThat(request.timeout().orElseThrow()).isEqualTo(java.time.Duration.ofSeconds(60));
            assertThat(request.headers().firstValue("Authorization")).contains("Bearer synthetic-key");
            return response;
        });
        var proposal=service.parse(1,input);
        assertThat(proposal.model()).isEqualTo("glm-4-flash-250414");assertThat(proposal.status()).isEqualTo("ready");
        assertThat(proposal.records()).hasSize(1);assertThat(proposal.records().get(0).amount()).isEqualTo("25.00");
    }
    @Test void clarificationReturnsNoBill() throws Exception {
        var response=reply("{\"records\":[],\"question\":\"午饭花了多少钱？\"}");
        var proposal=parser(r->response).parse(2,input);
        assertThat(proposal.status()).isEqualTo("needs_input");assertThat(proposal.records()).isEmpty();
    }
    @Test void completeGroupCannotSilentlyDropExistingCandidates() throws Exception {
        var response=reply(json.writeValueAsString(Map.of("records",List.of(row),"question","")));
        var existing=new RecordInput("expense","25.00",input.date(),"餐饮","午饭");
        code(()->parser(r->response).parse(1,new GlmDraftParser.Input("追加地铁3元",input.date(),List.of(existing,existing))),"AI_INVALID_RESPONSE");
    }
    @Test void malformedJsonAndDuplicateFieldsAndTrailingTokensAreUpstreamErrors() throws Exception {
        for(var content:List.of("not json","null","{\"records\":[],\"question\":\"a\",\"question\":\"b\"}",
                "{\"records\":[],\"question\":\"a\"} {}")) {
            var response=reply(content);code(()->parser(r->response).parse(1,input),"AI_INVALID_RESPONSE");
        }
    }
    @Test void outputRejectsNumericMoneyInvalidCategoryAndMixedQuestion() throws Exception {
        for(var field:List.of("amount","category","note","extra")) {
            var value=new java.util.HashMap<String,Object>(row);
            value.put(field,field.equals("category")?"虚构分类":25);
            var response=reply(json.writeValueAsString(Map.of("records",List.of(value),"question","")));
            code(()->parser(r->response).parse(1,input),"AI_INVALID_RESPONSE");
        }
        var response=reply(json.writeValueAsString(Map.of("records",List.of(row),"question","混合输出")));
        code(()->parser(r->response).parse(1,input),"AI_INVALID_RESPONSE");
    }
    @Test void disabledAndInvalidInputsNeverCallProvider() {
        var calls=new AtomicInteger();var service=new GlmDraftParser(json,ledger,false,"synthetic-key",r->{calls.incrementAndGet();return null;});
        code(()->service.parse(1,input),"AI_UNAVAILABLE");
        code(()->service.parse(1,new GlmDraftParser.Input("x".repeat(1001),input.date(),List.of())),"INVALID_INPUT");
        code(()->service.parse(1,new GlmDraftParser.Input("hello",input.date(),java.util.Arrays.asList((RecordInput)null))),"INVALID_INPUT");
        assertThat(calls.get()).isZero();
    }
    @Test void ownerLimitAndFailuresReleaseSlots() {
        var calls=new AtomicInteger();var service=parser(r->{calls.incrementAndGet();throw new java.net.http.HttpTimeoutException("synthetic timeout");});
        for(int i=0;i<6;i++) code(()->service.parse(1,input),"AI_TIMEOUT");
        code(()->service.parse(1,input),"AI_RATE_LIMITED");code(()->service.parse(2,input),"AI_TIMEOUT");
        assertThat(calls.get()).isEqualTo(7);
    }
    @Test void onlyTwoRequestsRunConcurrentlyAndSlotReturnsAfterFailure() throws Exception {
        var entered=new CountDownLatch(2);var release=new CountDownLatch(1);
        var service=parser(r->{entered.countDown();release.await(3,TimeUnit.SECONDS);throw new java.io.IOException("synthetic");});
        try(var pool=Executors.newFixedThreadPool(2)) {
            var first=pool.submit(()->code(()->service.parse(1,input),"AI_UNAVAILABLE"));
            var second=pool.submit(()->code(()->service.parse(2,input),"AI_UNAVAILABLE"));
            try {assertThat(entered.await(3,TimeUnit.SECONDS)).isTrue();code(()->service.parse(3,input),"AI_BUSY");}
            finally {release.countDown();}
            first.get(3,TimeUnit.SECONDS);second.get(3,TimeUnit.SECONDS);
        }
        code(()->service.parse(4,input),"AI_UNAVAILABLE");
    }
    @Test void responseSubscriberCancelsBeforeBufferingOversizeBody() {
        var subscriber=new GlmDraftParser.LimitedBody();var subscription=mock(java.util.concurrent.Flow.Subscription.class);
        subscriber.onSubscribe(subscription);subscriber.onNext(List.of(ByteBuffer.wrap(new byte[65537])));
        verify(subscription).cancel();assertThat(subscriber.getBody().toCompletableFuture()).isCompletedExceptionally();
        var exact=new GlmDraftParser.LimitedBody();exact.onSubscribe(mock(java.util.concurrent.Flow.Subscription.class));
        exact.onNext(List.of(ByteBuffer.wrap(new byte[65536])));exact.onComplete();
        assertThat(exact.getBody().toCompletableFuture().join()).hasSize(65536);
    }
    @Test void providerConcurrencyAndAuthenticationErrorsAreDistinctAndDoNotExposeBody() {
        code(()->parser(r->new GlmDraftParser.Reply(429,"synthetic sensitive error".getBytes())).parse(1,input),"AI_PROVIDER_BUSY");
        code(()->parser(r->new GlmDraftParser.Reply(401,"synthetic sensitive error".getBytes())).parse(1,input),"AI_UNAVAILABLE");
        code(()->parser(r->new GlmDraftParser.Reply(200,new byte[0])).parse(1,input),"AI_INVALID_RESPONSE");
    }
    @Test void transportDeadlineCoversBodyThatStallsAfterHeaders() throws Exception {
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        var headers=new CountDownLatch(1);var release=new CountDownLatch(1);
        server.createContext("/",exchange->{
            try {exchange.sendResponseHeaders(200,100);exchange.getResponseBody().write('x');exchange.getResponseBody().flush();
                headers.countDown();release.await(3,TimeUnit.SECONDS);
            } catch(InterruptedException interrupted) {Thread.currentThread().interrupt();}
            finally {exchange.close();}
        });
        server.start();
        try {
            var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/"))
                    .timeout(java.time.Duration.ofSeconds(2)).GET().build();
            var exchange=GlmDraftParser.httpExchange(java.net.http.HttpClient.newHttpClient(),java.time.Duration.ofMillis(300));
            assertThatThrownBy(()->exchange.send(request)).isInstanceOf(TimeoutException.class);
            assertThat(headers.await(1,TimeUnit.SECONDS)).isTrue();
        } finally {release.countDown();server.stop(0);}
    }
}
