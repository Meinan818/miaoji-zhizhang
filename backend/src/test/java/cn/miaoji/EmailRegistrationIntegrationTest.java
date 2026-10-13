package cn.miaoji;

import cn.miaoji.auth.VerificationMailer;
import cn.miaoji.auth.EmailRegistrationService;
import cn.miaoji.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="miaoji.auth.legacy-registration=false")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class EmailRegistrationIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired EmailRegistrationService registrations;
    @MockitoBean VerificationMailer mail;
    private record Browser(MockHttpSession session,String token) {}
    private Browser anonymous() throws Exception {
        var result=mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        return new Browser((MockHttpSession)result.getRequest().getSession(),json.readTree(result.getResponse().getContentAsString()).path("token").asText());
    }
    private String email() {return "test_"+UUID.randomUUID().toString().replace("-","")+"@example.test";}
    private record Code(JsonNode receipt,String value) {}
    private Code request(Browser browser,String email) throws Exception {
        var captured=new java.util.concurrent.atomic.AtomicReference<String>();
        doAnswer(call->{captured.set(call.getArgument(1));return null;}).when(mail).send(eq(email),anyString());
        var result=mvc.perform(post("/api/auth/email/code").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("email",email))))
                .andExpect(status().isOk()).andReturn();
        var value=json.readTree(result.getResponse().getContentAsString());
        assertThat(value.has("code")).isFalse();assertThat(captured.get()).matches("[0-9]{6}");
        return new Code(value,captured.get());
    }
    private org.springframework.test.web.servlet.ResultActions register(Browser browser,String email,Code challenge,String code) throws Exception {
        return mvc.perform(post("/api/auth/email/register").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("email",email,
                        "password","SyntheticPass123!","challengeId",challenge.receipt().path("challengeId").asText(),"code",code))));
    }
    @Test void verifiedEmailCreatesIsolatedAccountAndLogsInWithoutExposingCode() throws Exception {
        var browser=anonymous();var email=email();var code=request(browser,email);
        assertThat(jdbc.queryForObject("SELECT code_hash FROM email_registration_challenge WHERE email=?",String.class,email))
                .isNotEqualTo(code.value()).startsWith("$2");
        register(browser,email,code,code.value()).andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE email=? AND email_verified_at IS NOT NULL",Long.class,email)).isEqualTo(1);
        mvc.perform(post("/api/auth/login").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                .param("username",email.toUpperCase(java.util.Locale.ROOT)).param("password","SyntheticPass123!"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").session(browser.session())).andExpect(jsonPath("$.username").value(email));
        mvc.perform(get("/api/records/snapshot/page").session(browser.session())).andExpect(jsonPath("$.records").isEmpty());
        var refreshed=mvc.perform(get("/api/auth/csrf").session(browser.session())).andReturn();
        var current=new Browser(browser.session(),json.readTree(refreshed.getResponse().getContentAsString()).path("token").asText());
        register(current,email,code,code.value()).andExpect(status().isBadRequest());
    }
    @Test void failedCodeAttemptsCommitAndExhaustAfterFive() throws Exception {
        var browser=anonymous();var email=email();var challenge=request(browser,email);
        var wrong=challenge.value().equals("000000")?"000001":"000000";
        for(int i=0;i<5;i++) register(browser,email,challenge,wrong).andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT attempts FROM email_registration_challenge WHERE email=?",Integer.class,email)).isEqualTo(5);
        register(browser,email,challenge,challenge.value()).andExpect(status().isTooManyRequests());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE email=?",Long.class,email)).isZero();
    }
    @Test void resendAndExpiryAndEmailMismatchAreEnforced() throws Exception {
        var browser=anonymous();var email=email();var challenge=request(browser,email);
        mvc.perform(post("/api/auth/email/code").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("email",email))))
                .andExpect(status().isTooManyRequests());
        register(browser,email(),challenge,challenge.value()).andExpect(status().isBadRequest());
        jdbc.update("UPDATE email_registration_challenge SET expires_at='2020-01-01 00:00:00' WHERE email=?",email);
        register(browser,email,challenge,challenge.value()).andExpect(status().isGone());
    }
    @Test void smtpFailureRollsBackChallengeAndCsrfStillRequired() throws Exception {
        var browser=anonymous();var email=email();
        doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MAIL_UNAVAILABLE","synthetic unavailable"))
                .when(mail).send(eq(email),anyString());
        mvc.perform(post("/api/auth/email/code").session(browser.session()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(java.util.Map.of("email",email)))).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/email/code").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("email",email))))
                .andExpect(status().isServiceUnavailable());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM email_registration_challenge WHERE email=?",Long.class,email)).isZero();
    }
    @Test void resendInvalidatesOldChallengeAndDuplicateEmailCannotCreateAnotherAccount() throws Exception {
        var browser=anonymous();var email=email();var old=request(browser,email);
        jdbc.update("UPDATE email_registration_challenge SET sent_at='2020-01-01 00:00:00' WHERE email=?",email);
        var current=request(browser,email);register(browser,email,old,old.value()).andExpect(status().isBadRequest());
        register(browser,email,current,current.value()).andExpect(status().isCreated());
        jdbc.update("UPDATE email_registration_challenge SET sent_at='2020-01-01 00:00:00' WHERE email=?",email);
        var next=request(browser,email);register(browser,email,next,next.value()).andExpect(status().isConflict());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE email=?",Long.class,email)).isEqualTo(1);
    }
    @Test void legacyRegistrationCannotBypassVerificationAndInvalidEmailsNeverSend() throws Exception {
        var browser=anonymous();
        mvc.perform(post("/api/auth/register").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"synthetic_legacy\",\"password\":\"SyntheticPass123!\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("EMAIL_VERIFICATION_REQUIRED"));
        for(var email:java.util.List.of("bad","x@localhost","a..b@example.test","x\r\n@example.test")) {
            mvc.perform(post("/api/auth/email/code").session(browser.session()).header("X-CSRF-TOKEN",browser.token())
                    .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("email",email))))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(mail);
        assertThatThrownBy(()->EmailRegistrationService.normalize(null)).isInstanceOf(ApiException.class);
        assertThat(EmailRegistrationService.normalize(" Test.Name+tag@Example.TEST ")).isEqualTo("test.name+tag@example.test");
    }
}
