package cn.miaoji.auth;

import cn.miaoji.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth/email")
public class EmailRegistrationController {
    public record CodeRequest(@NotNull @Size(max=254) String email) {}
    public record RegisterRequest(@NotNull @Size(max=254) String email,
            @NotNull @Pattern(regexp="[\\x21-\\x7E]{12,64}") String password,
            @NotNull UUID challengeId,@NotNull @Pattern(regexp="[0-9]{6}") String code) {}
    private final EmailRegistrationService registrations;
    public EmailRegistrationController(EmailRegistrationService registrations) {this.registrations=registrations;}
    @PostMapping("/code")
    public EmailRegistrationService.Challenge request(@Valid @RequestBody CodeRequest input) {
        return registrations.request(input.email());
    }
    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public void register(@Valid @RequestBody RegisterRequest input) {
        var result=registrations.register(input.email(),input.password(),input.challengeId(),input.code());
        switch(result) {
            case CREATED -> {}
            case INVALID -> throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_CODE","验证码无效，请核对邮箱与验证码");
            case EXPIRED -> throw new ApiException(HttpStatus.GONE,"CODE_EXPIRED","验证码已过期，请重新申请");
            case EXHAUSTED -> throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"CODE_ATTEMPTS_EXHAUSTED","验证码尝试次数已用完，请重新申请");
            case UNAVAILABLE -> throw new ApiException(HttpStatus.CONFLICT,"EMAIL_UNAVAILABLE","此邮箱暂不可用于注册，请尝试登录");
        }
    }
}
