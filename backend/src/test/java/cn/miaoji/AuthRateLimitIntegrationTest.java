package cn.miaoji;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.http.MediaType;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "miaoji.auth.attempt-limit=2")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthRateLimitIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    @Test void loginAndRegistrationShareAddressBudgetWithoutForwardedHeaderBypass() throws Exception {
        var result = mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) result.getRequest().getSession();
        var token = json.readTree(result.getResponse().getContentAsString()).path("token").asText();
        mvc.perform(post("/api/auth/login").session(session).header("X-CSRF-TOKEN",token)
                .with(req -> {req.setRemoteAddr("192.0.2.1");return req;})
                .param("username","unknown").param("password","SyntheticWrong!"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/register").session(session).header("X-CSRF-TOKEN",token)
                .with(req -> {req.setRemoteAddr("192.0.2.1");return req;})
                .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"x\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").session(session).header("X-CSRF-TOKEN",token)
                .header("X-Forwarded-For","192.0.2.2")
                .with(req -> {req.setRemoteAddr("192.0.2.1");return req;})
                .param("username","different").param("password","SyntheticWrong!"))
                .andExpect(status().isTooManyRequests()).andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"));
        mvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/login").session(session).header("X-CSRF-TOKEN",token)
                .with(req -> {req.setRemoteAddr("192.0.2.2");return req;})
                .param("username","unknown").param("password","SyntheticWrong!"))
                .andExpect(status().isUnauthorized());
    }

    @Test void failedCsrfDoesNotConsumeAuthenticationBudget() throws Exception {
        mvc.perform(post("/api/auth/login").with(req -> {req.setRemoteAddr("192.0.2.3");return req;}))
                .andExpect(status().isForbidden());
        var result = mvc.perform(get("/api/auth/csrf")).andReturn();
        var session = (MockHttpSession) result.getRequest().getSession();
        var token = json.readTree(result.getResponse().getContentAsString()).path("token").asText();
        for(int i=0;i<2;i++) mvc.perform(post("/api/auth/login").session(session).header("X-CSRF-TOKEN",token)
                .with(req -> {req.setRemoteAddr("192.0.2.3");return req;})
                .param("username","unknown").param("password","SyntheticWrong!"))
                .andExpect(status().isUnauthorized());
    }
}
