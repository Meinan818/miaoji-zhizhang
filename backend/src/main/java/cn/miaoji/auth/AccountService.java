package cn.miaoji.auth;

import cn.miaoji.common.ApiException;
import java.util.Locale;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService implements UserDetailsService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;

    public AccountService(JdbcTemplate jdbc, PasswordEncoder passwords) {
        this.jdbc = jdbc;
        this.passwords = passwords;
    }

    @Transactional
    public void register(String username, String password) {
        try {
            jdbc.update("INSERT INTO app_user (username, password_hash) VALUES (?, ?)",
                    normalize(username), passwords.encode(password));
            var owner = jdbc.queryForObject("SELECT id FROM app_user WHERE username = ?", Long.class, normalize(username));
            jdbc.update("INSERT INTO account_profile (user_id, nickname) VALUES (?, ?)", owner,
                    normalize(username).substring(0, Math.min(20, username.length())));
        } catch (DuplicateKeyException error) {
            throw new ApiException(HttpStatus.CONFLICT, "USERNAME_UNAVAILABLE", "此用户名不可用");
        }
    }

    @Override
    public UserDetails loadUserByUsername(String username) {
        var accounts = jdbc.query("SELECT id, username, email, password_hash FROM app_user WHERE username = ? OR email = ?",
                (rs, row) -> new AccountPrincipal(rs.getLong("id"),
                        rs.getString("email")==null?rs.getString("username"):rs.getString("email"),rs.getString("password_hash")),
                normalize(username.trim()),normalize(username.trim()));
        if (accounts.isEmpty()) throw new UsernameNotFoundException("账号或密码错误");
        return accounts.getFirst();
    }

    private String normalize(String username) { return username.toLowerCase(Locale.ROOT); }
}
