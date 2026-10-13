package cn.miaoji;

import cn.miaoji.ledger.GlmDraftParser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import cn.miaoji.auth.AccountPrincipal;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import java.util.List;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GlmDraftIntegrationTest {
    @Autowired MockMvc mvc;
    private final String input="{\"message\":\"午饭25元\",\"date\":\"2026-10-04\",\"context\":[]}";
    private org.springframework.test.web.servlet.request.RequestPostProcessor identity() {
        return authentication(new UsernamePasswordAuthenticationToken(new AccountPrincipal(123,"synthetic-ai","synthetic-hash"),null,List.of()));
    }
    @Test void anonymousAndMissingCsrfCannotParse() throws Exception {
        mvc.perform(post("/api/ai/parse").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(input)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/ai/parse").with(identity()).contentType(MediaType.APPLICATION_JSON).content(input)).andExpect(status().isForbidden());
    }
    @Test void disabledProviderHasExplicitUnavailableError() throws Exception {
        mvc.perform(post("/api/ai/parse").with(identity()).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(input))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("AI_UNAVAILABLE"));
    }
    @Test void accountMismatchDoesNotDispatchParser() throws Exception {
        mvc.perform(post("/api/ai/parse").with(identity()).with(csrf()).header("X-Expected-Account","124")
                .contentType(MediaType.APPLICATION_JSON).content(input)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ACCOUNT_CHANGED"));
    }
    @Test void invalidBodyFailsBeforeDisabledProvider() throws Exception {
        mvc.perform(post("/api/ai/parse").with(identity()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"message\":\"\",\"date\":\"2026-10-04\",\"context\":[]}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INPUT"));
    }
}
