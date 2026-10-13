package cn.miaoji;

import cn.miaoji.profile.ProfileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProfileIntegrationTest {
    private static final Path STORAGE = Path.of("../.cache/backend/profile-tests", UUID.randomUUID().toString()).toAbsolutePath().normalize();
    @DynamicPropertySource static void properties(DynamicPropertyRegistry values) {
        values.add("miaoji.storage-root", STORAGE::toString);
        values.add("spring.datasource.url", () -> "jdbc:h2:mem:profile;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean ProfileRepository profiles;
    private record Browser(MockHttpSession session, String token) {}
    private Browser csrf(MockHttpSession session) throws Exception {
        var request = get("/api/auth/csrf");
        if (session != null) request.session(session);
        var result = mvc.perform(request).andExpect(status().isOk()).andReturn();
        return new Browser((MockHttpSession) result.getRequest().getSession(), json.readTree(result.getResponse().getContentAsString()).path("token").asText());
    }
    private ResultActions register(Browser b, String name) throws Exception {
        return mvc.perform(post("/api/auth/register").session(b.session()).header("X-CSRF-TOKEN", b.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("username", name, "password", "SyntheticPass123!"))));
    }
    private Browser account() throws Exception {
        var b = csrf(null);
        var name = "p_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        register(b, name).andExpect(status().isCreated());
        mvc.perform(post("/api/auth/login").session(b.session()).header("X-CSRF-TOKEN", b.token())
                .param("username", name).param("password", "SyntheticPass123!")).andExpect(status().isNoContent());
        return csrf(b.session());
    }
    private ResultActions update(Browser b, long version, String nickname, String signature, String avatar) throws Exception {
        return mvc.perform(put("/api/profile").session(b.session()).header("X-CSRF-TOKEN", b.token())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("version", version, "nickname", nickname, "signature", signature, "avatar", avatar))));
    }
    private byte[] image(String format, int width, int height) throws Exception {
        var picture = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        var output = new ByteArrayOutputStream();
        try (var stream = new MemoryCacheImageOutputStream(output)) { ImageIO.write(picture, format, stream); }
        return output.toByteArray();
    }
    private ResultActions upload(Browser b, long version, byte[] bytes, String mime) throws Exception {
        return mvc.perform(multipart("/api/profile/avatar").file(new MockMultipartFile("image", "../untrusted.jpg", mime, bytes))
                .param("version", Long.toString(version)).session(b.session()).header("X-CSRF-TOKEN", b.token()));
    }
    private byte[] avatar(Browser b) throws Exception {
        return mvc.perform(get("/api/profile/avatar").session(b.session())).andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_JPEG)).andExpect(header().string("Cache-Control", "no-store"))
                .andReturn().getResponse().getContentAsByteArray();
    }
    private long fileCount() throws Exception {
        try (var files = Files.list(STORAGE.resolve("avatars"))) { return files.count(); }
    }

    @Test void anonymousCannotAccessProfilesOrAvatars() throws Exception {
        mvc.perform(get("/api/profile")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/profile/avatar")).andExpect(status().isUnauthorized());
        var b = csrf(null);
        update(b, 0, "测试", "", "cat").andExpect(status().isUnauthorized());
        upload(b, 0, image("png", 10, 10), "image/png").andExpect(status().isUnauthorized());
    }
    @Test void profilesAreCreatedWithAccountsAndRemainIsolated() throws Exception {
        var alice = account(); var bob = account();
        update(alice, 0, "甲", "合成签名", "paw").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        mvc.perform(get("/api/profile").session(bob.session())).andExpect(status().isOk())
                .andExpect(jsonPath("$.avatar").value("cat")).andExpect(jsonPath("$.version").value(0));
        mvc.perform(get("/api/profile").session(alice.session())).andExpect(jsonPath("$.nickname").value("甲"));
    }
    @Test void codePointLimitsAndUnicodeWhitespaceAreEnforced() throws Exception {
        var b = account();
        update(b, 0, "😀".repeat(20), "😀".repeat(60), "flower").andExpect(status().isOk());
        update(b, 1, "😀".repeat(21), "", "cat").andExpect(status().isBadRequest());
        update(b, 1, "测试", "😀".repeat(61), "cat").andExpect(status().isBadRequest());
        update(b, 1, "　　", "", "cat").andExpect(status().isBadRequest());
        update(b, 1, "　猫　", "　签名　", "cat").andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value("猫")).andExpect(jsonPath("$.signature").value("签名"));
    }
    @Test void staleVersionAndPhotoWithoutUploadCannotOverwrite() throws Exception {
        var b = account();
        update(b, 0, "猫", "", "photo").andExpect(status().isBadRequest());
        update(b, 0, "新昵称", "", "cat").andExpect(status().isOk());
        update(b, 0, "旧昵称", "", "cat").andExpect(status().isConflict());
        mvc.perform(get("/api/profile").session(b.session())).andExpect(jsonPath("$.nickname").value("新昵称"));
    }
    @Test void unknownOwnerAndFileFieldsAreRejected() throws Exception {
        var b = account();
        for (var extra : new String[]{"userId", "avatar_file", "avatarUrl"}) {
            mvc.perform(put("/api/profile").session(b.session()).header("X-CSRF-TOKEN", b.token())
                    .contentType(MediaType.APPLICATION_JSON).content("{\"version\":0,\"nickname\":\"猫\",\"signature\":\"\",\"avatar\":\"cat\",\"" + extra + "\":\"../other\"}"))
                    .andExpect(status().isBadRequest());
        }
    }
    @Test void jpegAndPngBecome256JpegAndRemainAccountOwned() throws Exception {
        var alice = account(); var bob = account();
        upload(alice, 0, image("png", 500, 300), "image/png").andExpect(status().isOk())
                .andExpect(jsonPath("$.avatarUrl").value("/api/profile/avatar")).andExpect(jsonPath("$.version").value(1));
        var decoded = ImageIO.read(new ByteArrayInputStream(avatar(alice)));
        assertThat(decoded.getWidth()).isEqualTo(256); assertThat(decoded.getHeight()).isEqualTo(256);
        mvc.perform(get("/api/profile/avatar").session(bob.session())).andExpect(status().isNotFound());
        upload(alice, 1, image("jpeg", 300, 500), "image/jpeg").andExpect(status().isOk());
        assertThat(avatar(alice)[0]).isEqualTo((byte) 0xff);
    }
    @Test void invalidImagesNeverChangeOldPhoto() throws Exception {
        var b = account();
        upload(b, 0, image("jpeg", 40, 40), "image/jpeg").andExpect(status().isOk());
        var old = avatar(b); var count = fileCount();
        upload(b, 1, "<svg/>".getBytes(), "image/png").andExpect(status().isBadRequest());
        upload(b, 1, new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff}, "image/jpeg").andExpect(status().isBadRequest());
        var truncated = image("jpeg", 40, 40);
        upload(b, 1, java.util.Arrays.copyOf(truncated, truncated.length - 20), "image/jpeg").andExpect(status().isBadRequest());
        upload(b, 1, new byte[0], "image/jpeg").andExpect(status().isBadRequest());
        upload(b, 1, new byte[2 * 1024 * 1024 + 1], "image/jpeg").andExpect(status().isBadRequest());
        upload(b, 1, image("png", 2001, 2000), "image/png").andExpect(status().isBadRequest());
        upload(b, 1, image("png", 4097, 1), "image/png").andExpect(status().isBadRequest());
        upload(b, 1, image("png", 10, 10), "image/svg+xml").andExpect(status().isBadRequest());
        assertThat(avatar(b)).isEqualTo(old); assertThat(fileCount()).isEqualTo(count);
    }
    @Test void staleUploadDoesNotCreateFile() throws Exception {
        var b = account(); update(b, 0, "猫", "", "cat").andExpect(status().isOk());
        var count = fileCount();
        upload(b, 0, image("png", 10, 10), "image/png").andExpect(status().isConflict());
        assertThat(fileCount()).isEqualTo(count);
    }
    @Test void metadataFailureDiscardsOnlyNewFileAndPreservesOldAvatar() throws Exception {
        var b = account(); upload(b, 0, image("png", 10, 10), "image/png").andExpect(status().isOk());
        var old = avatar(b); var count = fileCount();
        doAnswer(invocation -> { invocation.callRealMethod(); throw new DataIntegrityViolationException("synthetic rollback"); })
                .when(profiles).update(anyLong(), eq(1L), anyString(), anyString(), eq("photo"), anyString());
        upload(b, 1, image("jpeg", 20, 20), "image/jpeg").andExpect(status().isServiceUnavailable());
        assertThat(avatar(b)).isEqualTo(old); assertThat(fileCount()).isEqualTo(count);
        mvc.perform(get("/api/profile").session(b.session())).andExpect(jsonPath("$.version").value(1));
    }
    @Test void switchingToPresetDoesNotDeletePriorFile() throws Exception {
        var b = account(); upload(b, 0, image("png", 10, 10), "image/png").andExpect(status().isOk());
        var count = fileCount(); update(b, 1, "猫", "", "paw").andExpect(status().isOk()).andExpect(jsonPath("$.avatarUrl").doesNotExist());
        assertThat(fileCount()).isEqualTo(count);
        mvc.perform(get("/api/profile/avatar").session(b.session())).andExpect(status().isNotFound());
    }
    @Test void csrfRequiredForProfileAndAvatarWrites() throws Exception {
        var b = account();
        mvc.perform(put("/api/profile").session(b.session()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(multipart("/api/profile/avatar").file(new MockMultipartFile("image", image("png", 10, 10)))
                .session(b.session()).param("version", "0")).andExpect(status().isForbidden());
    }
    @Test void accountRegistrationRollsBackIfProfileInsertFails() throws Exception {
        jdbc.execute("ALTER TABLE account_profile ADD CONSTRAINT synthetic_profile_failure CHECK (nickname <> 'rollback_profile')");
        try {
            register(csrf(null), "rollback_profile").andExpect(status().isServiceUnavailable());
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE username='rollback_profile'", Long.class)).isZero();
        } finally { jdbc.execute("ALTER TABLE account_profile DROP CONSTRAINT synthetic_profile_failure"); }
    }
}
