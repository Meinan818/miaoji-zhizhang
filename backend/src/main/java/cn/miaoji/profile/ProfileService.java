package cn.miaoji.profile;

import cn.miaoji.common.ApiException;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ProfileService {
    private final ProfileRepository repository;
    private final AvatarStorage files;
    private final Validator validator;
    private final TransactionTemplate transactions;
    private static final Pattern EDGE_WHITESPACE = Pattern.compile("^\\s+|\\s+$", Pattern.UNICODE_CHARACTER_CLASS);

    public ProfileService(ProfileRepository repository, AvatarStorage files, Validator validator, PlatformTransactionManager manager) {
        this.repository = repository;
        this.files = files;
        this.validator = validator;
        this.transactions = new TransactionTemplate(manager);
    }

    public record ProfileInput(@NotNull @PositiveOrZero Long version, @NotBlank @Size(max = 40) String nickname,
            @NotNull @Size(max = 120) String signature, @NotNull @jakarta.validation.constraints.Pattern(regexp = "cat|paw|flower|photo") String avatar) {}
    public record ProfileView(String nickname, String signature, String avatar, long version,
            @JsonInclude(JsonInclude.Include.NON_NULL) String avatarUrl) {}

    public ProfileView read(long owner) { return view(stored(owner)); }

    @Transactional
    public ProfileView update(long owner, ProfileInput input) {
        if (input == null || !validator.validate(input).isEmpty()) throw invalid();
        var nickname = EDGE_WHITESPACE.matcher(input.nickname()).replaceAll("");
        var signature = EDGE_WHITESPACE.matcher(input.signature()).replaceAll("");
        if (nickname.isEmpty() || nickname.codePointCount(0, nickname.length()) > 20
                || signature.codePointCount(0, signature.length()) > 60) throw invalid();
        var current = stored(owner);
        if (input.version() != current.version()) throw conflict();
        var file = "photo".equals(input.avatar()) ? current.fileId() : null;
        if ("photo".equals(input.avatar()) && file == null) throw invalid();
        if (!repository.update(owner, input.version(), nickname, signature, input.avatar(), file)) throw conflict();
        return read(owner);
    }

    public ProfileView upload(long owner, long version, MultipartFile photo) {
        var current = stored(owner);
        if (version < 0 || version != current.version()) throw conflict();
        var normalized = files.normalize(photo);
        var newFile = files.store(normalized);
        boolean committed = false;
        try {
            var result = transactions.execute(transaction -> {
                if (!repository.update(owner, version, current.nickname(), current.signature(), "photo", newFile)) throw conflict();
                return read(owner);
            });
            committed = true; // execute返回时数据库提交已经完成。
            return result;
        } finally {
            if (!committed) files.discardNewFile(newFile);
        }
    }

    public byte[] avatar(long owner) {
        var current = stored(owner);
        if (!"photo".equals(current.avatar()) || current.fileId() == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "AVATAR_NOT_FOUND", "当前账号尚无照片头像");
        }
        return files.read(current.fileId());
    }

    private ProfileRepository.StoredProfile stored(long owner) {
        return repository.find(owner).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "PROFILE_NOT_FOUND", "账号资料不存在"));
    }
    private ProfileView view(ProfileRepository.StoredProfile value) {
        return new ProfileView(value.nickname(), value.signature(), value.avatar(), value.version(),
                "photo".equals(value.avatar()) ? "/api/profile/avatar" : null);
    }
    private ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROFILE", "昵称须为1–20字，签名最多60字，照片头像须先上传"); }
    private ApiException conflict() { return new ApiException(HttpStatus.CONFLICT, "STALE_PROFILE", "资料已变化，请重新读取后操作"); }
}
