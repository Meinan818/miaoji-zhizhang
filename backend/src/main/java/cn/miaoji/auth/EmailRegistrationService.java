package cn.miaoji.auth;

import cn.miaoji.common.ApiException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmailRegistrationService {
    public record Challenge(String challengeId,int expiresIn,int resendAfter) {}
    public enum Result { CREATED, INVALID, EXPIRED, EXHAUSTED, UNAVAILABLE }
    private record Stored(String id,String hash,int attempts,Instant sentAt,Instant expiresAt,boolean consumed) {}
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final VerificationMailer mail;
    private final SecureRandom random=new SecureRandom();
    public EmailRegistrationService(JdbcTemplate jdbc,PasswordEncoder passwords,VerificationMailer mail) {
        this.jdbc=jdbc;this.passwords=passwords;this.mail=mail;
    }
    public static String normalize(String raw) {
        if(raw==null) throw invalidEmail();
        var email=raw.trim().toLowerCase(Locale.ROOT);
        if(email.length()>254 || !email.matches("[a-z0-9][a-z0-9._%+\\-]{0,63}@[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?)+")) throw invalidEmail();
        for(var part:email.substring(email.indexOf('@')+1).split("\\.")) if(part.length()>63) throw invalidEmail();
        if(email.substring(0,email.indexOf('@')).contains("..")) throw invalidEmail();
        return email;
    }
    private static ApiException invalidEmail() {return new ApiException(HttpStatus.BAD_REQUEST,"INVALID_EMAIL","请输入有效邮箱地址");}
    private Stored find(String email) {
        return jdbc.query("SELECT * FROM email_registration_challenge WHERE email=? FOR UPDATE",
                (rs,row)->new Stored(rs.getString("challenge_id"),rs.getString("code_hash"),rs.getInt("attempts"),
                        rs.getTimestamp("sent_at").toInstant(),rs.getTimestamp("expires_at").toInstant(),rs.getTimestamp("consumed_at")!=null),email)
                .stream().findFirst().orElse(null);
    }
    @Transactional
    public Challenge request(String rawEmail) {
        var email=normalize(rawEmail);var existing=find(email);var now=Instant.now();
        if(existing!=null && now.isBefore(existing.sentAt().plusSeconds(60))) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"CODE_RESEND_LIMITED","请稍等60秒后再申请验证码");
        }
        var id=UUID.randomUUID().toString();var code=String.format(Locale.ROOT,"%06d",random.nextInt(1_000_000));
        var hash=passwords.encode(code);var expiry=now.plusSeconds(300);
        if(existing==null) {
            try { jdbc.update("INSERT INTO email_registration_challenge (email,challenge_id,code_hash,sent_at,expires_at) VALUES (?,?,?,?,?)",
                    email,id,hash,Timestamp.from(now),Timestamp.from(expiry)); }
            catch(DuplicateKeyException duplicate) { throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"CODE_RESEND_LIMITED","验证码申请正在处理，请稍后再试"); }
        } else jdbc.update("UPDATE email_registration_challenge SET challenge_id=?,code_hash=?,attempts=0,sent_at=?,expires_at=?,consumed_at=NULL WHERE email=?",
                id,hash,Timestamp.from(now),Timestamp.from(expiry),email);
        mail.send(email,code); // 失败回退挑战记录，不宣称已发出；不返回/打印验证码。
        return new Challenge(id,300,60);
    }
    @Transactional
    public Result register(String rawEmail,String password,UUID challengeId,String code) {
        var email=normalize(rawEmail);
        if(password==null || !password.matches("[\\x21-\\x7E]{12,64}") || code==null || !code.matches("[0-9]{6}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","密码或验证码格式不合法");
        }
        var challenge=find(email);
        if(challenge==null || challengeId==null || !challenge.id().equals(challengeId.toString()) || challenge.consumed()) return Result.INVALID;
        if(!Instant.now().isBefore(challenge.expiresAt())) return Result.EXPIRED;
        if(challenge.attempts()>=5) return Result.EXHAUSTED;
        if(!passwords.matches(code,challenge.hash())) {
            jdbc.update("UPDATE email_registration_challenge SET attempts=attempts+1 WHERE email=?",email);
            return Result.INVALID; // 返回结果提交失败计数，Controller之后才抛错，不能事务回退绕过次数。
        }
        if(jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE email=?",Long.class,email)>0) return Result.UNAVAILABLE;
        var username="mail_"+UUID.randomUUID().toString().replace("-","").substring(0,24);
        try {jdbc.update("INSERT INTO app_user (username,password_hash,email,email_verified_at) VALUES (?,?,?,CURRENT_TIMESTAMP(6))",
                username,passwords.encode(password),email);}
        catch(DuplicateKeyException duplicate) {throw new ApiException(HttpStatus.CONFLICT,"EMAIL_UNAVAILABLE","此邮箱暂不可用于注册，请尝试登录");}
        var owner=jdbc.queryForObject("SELECT id FROM app_user WHERE email=?",Long.class,email);
        jdbc.update("INSERT INTO account_profile (user_id,nickname) VALUES (?,?)",owner,"新来的猫友");
        jdbc.update("UPDATE email_registration_challenge SET consumed_at=CURRENT_TIMESTAMP(6) WHERE email=?",email);
        return Result.CREATED;
    }
}
